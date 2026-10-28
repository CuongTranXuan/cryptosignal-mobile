"""The anthropic SDK loads only for LLM_API_STYLE=anthropic (1 GB VPS: ~22 MB RSS saved)."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from cryptosignal_copilot.config import LlmConfig, LlmConfigError
from cryptosignal_copilot.model_factory import build_model

ROOT = Path(__file__).resolve().parents[1]

_PROBE = """
import json, sys
import cryptosignal_copilot.app  # noqa: F401
print(json.dumps(sorted(m for m in sys.modules
                        if m == "anthropic" or m.startswith(("anthropic.", "pydantic_ai.models.anthropic",
                                                             "pydantic_ai.providers.anthropic")))))
"""


def test_importing_the_app_does_not_import_anthropic():
    env = {
        "PATH": "/usr/bin:/bin",
        "LLM_API_STYLE": "openai",
        "LLM_BASE_URL": "http://127.0.0.1:9/v1",
        "LLM_API_KEY": "test",
        "LLM_MODEL": "m",
    }
    proc = subprocess.run(
        [sys.executable, "-c", _PROBE],
        cwd=ROOT,
        env={**env, "PYTHONPATH": str(ROOT / "src")},
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert json.loads(proc.stdout.strip().splitlines()[-1]) == []


def _anthropic_cfg() -> LlmConfig:
    return LlmConfig(
        style="anthropic",
        base_url="https://api.anthropic.com",
        api_key="sk-test",
        model="claude-sonnet-4-5",
        timeout_s=30.0,
    )


def test_anthropic_style_still_builds_an_anthropic_model():
    pytest.importorskip("anthropic")
    from pydantic_ai.models.anthropic import AnthropicModel

    assert isinstance(build_model(_anthropic_cfg()), AnthropicModel)


def test_anthropic_style_without_the_extra_is_a_config_error(monkeypatch):
    monkeypatch.setitem(sys.modules, "anthropic", None)
    monkeypatch.setitem(sys.modules, "pydantic_ai.models.anthropic", None)
    with pytest.raises(LlmConfigError, match=r"cryptosignal-copilot\[anthropic\]"):
        build_model(_anthropic_cfg())
