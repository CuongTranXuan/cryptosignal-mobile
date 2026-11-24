"""`apps/copilot/.env` is loaded at startup without overriding the real environment."""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import pytest

from cryptosignal_copilot.env_file import DEFAULT_ENV_FILE, load_env_file

KEYS = ("CSM_T_REAL", "CSM_T_FILL", "COPILOT_ENV")


@pytest.fixture
def env_file(tmp_path, monkeypatch) -> Path:
    for key in KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.delenv("COPILOT_DOTENV", raising=False)
    path = tmp_path / ".env"
    path.write_text("CSM_T_REAL=from-file\nCSM_T_FILL=from-file\n")
    return path


def test_real_env_wins_and_file_fills_missing(env_file, monkeypatch):
    import os

    monkeypatch.setenv("CSM_T_REAL", "from-process")
    assert load_env_file(env_file) == env_file
    assert os.environ["CSM_T_REAL"] == "from-process"
    assert os.environ["CSM_T_FILL"] == "from-file"
    monkeypatch.delenv("CSM_T_FILL")


def test_skipped_in_production(env_file, monkeypatch):
    import os

    monkeypatch.setenv("COPILOT_ENV", "production")
    assert load_env_file(env_file) is None
    assert "CSM_T_FILL" not in os.environ


def test_opt_out_and_missing_file(env_file, monkeypatch, tmp_path):
    import os

    assert load_env_file(tmp_path / "nope.env") is None
    monkeypatch.setenv("COPILOT_DOTENV", "0")
    assert load_env_file(env_file) is None
    assert "CSM_T_FILL" not in os.environ


def test_default_path_is_the_copilot_app_dir():
    assert DEFAULT_ENV_FILE == Path(__file__).resolve().parents[1] / ".env"


def test_app_import_loads_the_file_before_the_llm_check(tmp_path):
    """End to end: a fresh interpreter importing the app sees LLM_* from the file."""
    script = (
        "import os, cryptosignal_copilot.env_file as ef\n"
        f"ef.DEFAULT_ENV_FILE = __import__('pathlib').Path({str(tmp_path / '.env')!r})\n"
        "import cryptosignal_copilot.app\n"
        "print(os.environ.get('LLM_MODEL'), os.environ.get('LLM_API_STYLE'))\n"
    )
    (tmp_path / ".env").write_text("LLM_MODEL=file-model\nLLM_API_STYLE=file-style\n")
    env = {
        "PATH": "/usr/bin:/bin",
        "LLM_API_STYLE": "openai",
        "DATABASE_URL": f"sqlite:///{tmp_path / 'db.sqlite3'}",
        "HOME": str(tmp_path),
    }
    out = subprocess.run(
        [sys.executable, "-c", script], env=env, capture_output=True, text=True, check=True
    )
    assert out.stdout.split() == ["file-model", "openai"]


@pytest.mark.parametrize("cache_location", ["explicit", "data_dir"])
def test_app_import_uses_dotenv_cache_settings(tmp_path, cache_location):
    """The first cache consumers honor file settings despite app's module imports."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    cache_path = (
        tmp_path / "ticks.json" if cache_location == "explicit" else data_dir / "symbol_ticks.json"
    )
    now = time.time()
    cache_path.write_text(
        json.dumps(
            {
                "version": 1,
                "symbols": {
                    "DOTENVSTALEUSDT": {"tick_size": 0.5, "fetched_at": now - 2000},
                    "DOTENVRECENTUSDT": {"tick_size": 0.25, "fetched_at": now - 600},
                },
            }
        )
    )
    location = (
        f"COPILOT_TICK_CACHE_PATH={cache_path}\n"
        if cache_location == "explicit"
        else f"COPILOT_DATA_DIR={data_dir}\n"
    )
    (tmp_path / ".env").write_text(
        location
        + "COPILOT_TICK_FETCH=false\n"
        + "COPILOT_TICK_CACHE_TTL_S=1234\n"
        + "COPILOT_MODEL_NEGATIVE_CACHE_TTL_S=7200\n"
    )
    script = (
        "import asyncio, json, time, cryptosignal_copilot.env_file as ef\n"
        f"ef.DEFAULT_ENV_FILE = __import__('pathlib').Path({str(tmp_path / '.env')!r})\n"
        "import cryptosignal_copilot.app\n"
        "from cryptosignal_copilot.symbol_tick import get_tick_cache, tick_size_for_symbol\n"
        "from cryptosignal_copilot.model_negative_cache import get_model_negative_cache\n"
        "cache = get_tick_cache()\n"
        "tick = tick_size_for_symbol('DOTENVSTALEUSDT', reference_price=1.2345)\n"
        "async def scheduled():\n"
        "    disabled = cache.schedule('DOTENVMISSINGUSDT')\n"
        "    if disabled is not None: disabled.cancel()\n"
        "    cache.enabled = True\n"
        "    stale = cache.schedule('DOTENVSTALEUSDT')\n"
        "    recent = cache.schedule('DOTENVRECENTUSDT')\n"
        "    for task in (stale, recent):\n"
        "        if task is not None: task.cancel()\n"
        "    return disabled is None, stale is not None, recent is not None\n"
        "disabled, stale, recent = asyncio.run(scheduled())\n"
        "negative = get_model_negative_cache()\n"
        "negative.mark('dotenv-model')\n"
        "now = time.time()\n"
        "print(json.dumps({'tick': tick, 'disabled': disabled, 'stale_due': stale,\n"
        "    'recent_due': recent, 'blocked_before_expiry': negative.is_blocked('dotenv-model', now=now+7100),\n"
        "    'blocked_after_expiry': negative.is_blocked('dotenv-model', now=now+7300)}))\n"
    )
    out = subprocess.run(
        [sys.executable, "-c", script],
        env={
            "PATH": "/usr/bin:/bin",
            "DATABASE_URL": f"sqlite:///{tmp_path / 'db.sqlite3'}",
            "COPILOT_RUN_DB_MIGRATIONS": "false",
        },
        capture_output=True,
        text=True,
        check=True,
    )
    assert json.loads(out.stdout) == {
        "tick": 0.5,
        "disabled": True,
        "stale_due": True,
        "recent_due": False,
        "blocked_before_expiry": True,
        "blocked_after_expiry": False,
    }
