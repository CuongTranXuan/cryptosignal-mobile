from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config

from cryptosignal_copilot.config import load_database_url
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


def run_db_migrations(database_url: str | None = None, *, force: bool = False) -> None:
    if not force and not env_flag("COPILOT_RUN_DB_MIGRATIONS"):
        return
    command.upgrade(alembic_config(database_url), "head")
