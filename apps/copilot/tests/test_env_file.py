"""`apps/copilot/.env` is loaded at startup without overriding the real environment."""

from __future__ import annotations

import subprocess
import sys
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
