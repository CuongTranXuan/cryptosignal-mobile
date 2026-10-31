from __future__ import annotations

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from cryptosignal_copilot.config import load_database_url  # noqa: E402
from cryptosignal_copilot.db.models import Base  # noqa: E402

config = context.config
# Only the alembic CLI configures logging from alembic.ini. In-process upgrades
# (app startup, tests) pass configure_logger=False: fileConfig's default
# disable_existing_loggers=True silenced uvicorn.error and every app logger, so
# request tracebacks never reached the log. Even the CLI keeps existing loggers.
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def get_url() -> str:
    configured = config.get_main_option("sqlalchemy.url")
    if configured and configured.strip():
        return configured.strip()
    return load_database_url()


def run_migrations_offline() -> None:
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = get_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
