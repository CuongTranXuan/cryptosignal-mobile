from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable
from pathlib import Path

from alembic import command
from alembic.config import Config

from cryptosignal_copilot.config import load_database_url
from cryptosignal_copilot.db.errors import DB_UNAVAILABLE_ERRORS
from cryptosignal_copilot.env_parse import env_flag


def alembic_config(database_url: str | None = None) -> Config:
    root = Path(__file__).resolve().parents[3]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    url = database_url or load_database_url()
    cfg.set_main_option("sqlalchemy.url", url)
    # In-process upgrades must not reconfigure logging (see alembic/env.py).
    cfg.attributes["configure_logger"] = False
    return cfg


logger = logging.getLogger(__name__)

DEFAULT_STARTUP_RETRIES = 5
_MAX_BACKOFF_S = 10.0


def run_db_migrations(database_url: str | None = None, *, force: bool = False) -> None:
    if not force and not env_flag("COPILOT_RUN_DB_MIGRATIONS"):
        return
    command.upgrade(alembic_config(database_url), "head")


def run_db_migrations_with_retry(
    *,
    migrate: Callable[[], None] = run_db_migrations,
    sleep: Callable[[float], None] = time.sleep,
) -> bool:
    """Startup migrations with exponential backoff (1, 2, 4… s, capped at 10 s) while the
    database is unreachable. Gives up after `COPILOT_DB_STARTUP_RETRIES` attempts
    (default 5) without raising, so the app still starts and answers 503 `db_unavailable`.
    """
    raw = os.environ.get("COPILOT_DB_STARTUP_RETRIES", "").strip()
    attempts = max(1, int(raw)) if raw else DEFAULT_STARTUP_RETRIES
    for attempt in range(attempts):
        try:
            migrate()
            return True
        except DB_UNAVAILABLE_ERRORS as exc:
            if attempt == attempts - 1:
                logger.error("db: migrations failed after %d attempts: %s", attempts, exc)
                return False
            delay = min(2.0**attempt, _MAX_BACKOFF_S)
            logger.warning("db: unavailable at startup (%s); retrying in %.0fs", exc, delay)
            sleep(delay)
    return False
