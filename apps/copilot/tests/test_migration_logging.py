"""In-process alembic upgrades must not silence uvicorn/app loggers (tracebacks were lost)."""

from __future__ import annotations

import logging

from cryptosignal_copilot.config import sqlite_url_for_path
from cryptosignal_copilot.db.migrate import alembic_config, run_db_migrations


def test_run_db_migrations_keeps_existing_loggers_enabled(tmp_path):
    names = ("uvicorn.error", "uvicorn.access", "cryptosignal_copilot.app")
    loggers = [logging.getLogger(n) for n in names]
    for lg in loggers:
        lg.disabled = False
    handlers_before = list(logging.getLogger().handlers)

    run_db_migrations(sqlite_url_for_path(tmp_path / "m.sqlite3"), force=True)

    assert [lg.disabled for lg in loggers] == [False, False, False]
    assert logging.getLogger().handlers == handlers_before


def test_alembic_config_opts_out_of_file_logging(tmp_path):
    cfg = alembic_config(sqlite_url_for_path(tmp_path / "m.sqlite3"))
    assert cfg.attributes["configure_logger"] is False
