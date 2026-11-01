"""Load `apps/copilot/.env` for local runs, so plain `uvicorn …` picks up `LLM_*`.

Values already in the process environment always win (`override=False`). Skipped when
`COPILOT_ENV=production` (systemd/Docker pass the env explicitly) or `COPILOT_DOTENV=0`.
"""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

from cryptosignal_copilot.config import is_production
from cryptosignal_copilot.env_parse import env_flag

DEFAULT_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


def load_env_file(path: Path | None = None) -> Path | None:
    """The file that was loaded, or None when skipped or absent."""
    target = path if path is not None else DEFAULT_ENV_FILE
    if is_production() or not env_flag("COPILOT_DOTENV", default=True):
        return None
    if not target.is_file():
        return None
    load_dotenv(target, override=False)
    return target
