from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

VALID_LLM_STYLES = frozenset({"openai", "anthropic"})
DEFAULT_MODELS_CACHE_TTL_S = 600.0
DEFAULT_MODELS_FETCH_TIMEOUT_S = 10.0
DEFAULT_CANDLE_COUNT = 100


class LlmConfigError(Exception):
    pass


@dataclass(frozen=True)
class LlmConfig:
    style: str
    base_url: str
    api_key: str
    model: str
    timeout_s: float


def validate_llm_env_on_startup() -> None:
    """Raise if LLM_API_STYLE is set to an unknown value. Missing env is allowed (health 503)."""
    style = os.environ.get("LLM_API_STYLE", "").strip().lower()
    if not style:
        return
    if style not in VALID_LLM_STYLES:
        raise SystemExit(f"unknown LLM_API_STYLE: {style}")


def load_llm_config() -> LlmConfig:
    style = os.environ.get("LLM_API_STYLE", "").strip().lower()
    base_url = os.environ.get("LLM_BASE_URL", "").strip().rstrip("/")
    api_key = os.environ.get("LLM_API_KEY", "").strip()
    model = os.environ.get("LLM_MODEL", "").strip()
    timeout_s = float(os.environ.get("LLM_TIMEOUT_S", "60"))
    missing = [
        n
        for n, v in [
            ("LLM_API_STYLE", style),
            ("LLM_BASE_URL", base_url),
            ("LLM_API_KEY", api_key),
            ("LLM_MODEL", model),
        ]
        if not v
    ]
    if missing:
        raise LlmConfigError(f"LLM config missing: {', '.join(missing)}")
    if style not in VALID_LLM_STYLES:
        raise LlmConfigError(f"unknown LLM_API_STYLE: {style}")
    return LlmConfig(
        style=style,
        base_url=base_url,
        api_key=api_key,
        model=model,
        timeout_s=timeout_s,
    )


def health_payload(cfg: LlmConfig) -> dict:
    host = urlparse(cfg.base_url).hostname or ""
    return {"ok": True, "style": cfg.style, "model": cfg.model, "baseHost": host}


def load_models_cache_ttl_s() -> float:
    raw = os.environ.get("COPILOT_MODELS_CACHE_TTL_S", "").strip()
    if not raw:
        return DEFAULT_MODELS_CACHE_TTL_S
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_MODELS_CACHE_TTL_S
    return max(1.0, value)


def load_models_fetch_timeout_s() -> float:
    raw = os.environ.get("COPILOT_MODELS_FETCH_TIMEOUT_S", "").strip()
    if not raw:
        return DEFAULT_MODELS_FETCH_TIMEOUT_S
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_MODELS_FETCH_TIMEOUT_S
    return max(1.0, value)


def load_default_candle_count() -> int:
    raw = os.environ.get("COPILOT_DEFAULT_CANDLE_COUNT", "").strip()
    if not raw:
        return DEFAULT_CANDLE_COUNT
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_CANDLE_COUNT
    return max(1, value)


def default_sessions_sqlite_path() -> Path:
    data_dir = os.environ.get("COPILOT_DATA_DIR", "").strip()
    if data_dir:
        return Path(data_dir).expanduser() / "sessions.sqlite3"
    return Path(os.environ.get("TMPDIR", "/tmp")) / "cryptosignal-copilot-sessions.sqlite3"


def load_sessions_db_path() -> Path:
    """Filesystem path for the default SQLite sessions file (legacy helpers)."""
    raw = os.environ.get("COPILOT_SESSIONS_DB", "").strip()
    if raw:
        return Path(raw).expanduser()
    return default_sessions_sqlite_path()


def sqlite_url_for_path(path: Path) -> str:
    path = path.expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{path.as_posix()}"


def load_database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        return url
    legacy = os.environ.get("COPILOT_SESSIONS_DB", "").strip()
    if legacy:
        return sqlite_url_for_path(Path(legacy))
    return sqlite_url_for_path(default_sessions_sqlite_path())
