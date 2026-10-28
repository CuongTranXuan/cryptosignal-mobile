"""In-process auto-analysis scheduler hook (lifecycle only; no scan logic yet).

The 1 GB VPS runs the engine inside the copilot process (no second ~165 MB Python
service). The FastAPI lifespan starts this task when `AUTOSCAN_ENABLED=1` and cancels
it on shutdown. `on_tick` is the seam for the future `run_scan` jobs; by default it
does nothing.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from collections.abc import Awaitable, Callable

logger = logging.getLogger(__name__)

_EVERY_S = {"1h": 3600, "2h": 7200}
DEFAULT_EVERY_S = 3600


async def _noop_tick() -> None:
    return None


class AutoScanScheduler:
    def __init__(
        self,
        *,
        enabled: bool,
        every_s: float = DEFAULT_EVERY_S,
        on_tick: Callable[[], Awaitable[None]] = _noop_tick,
    ) -> None:
        self.enabled = enabled
        self.every_s = every_s
        self._on_tick = on_tick
        self._task: asyncio.Task[None] | None = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def start(self) -> None:
        if not self.enabled or self.running:
            return
        self._task = asyncio.create_task(self._loop(), name="autoscan-scheduler")
        logger.info("autoscan scheduler started (every %ss)", self.every_s)

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is None:
            return
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        logger.info("autoscan scheduler stopped")

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(self.every_s)
            try:
                await self._on_tick()
            except Exception:
                logger.exception("autoscan tick failed")


def scheduler_from_env() -> AutoScanScheduler:
    enabled = os.environ.get("AUTOSCAN_ENABLED", "").strip().lower() in {"1", "true", "yes"}
    raw = os.environ.get("AUTOSCAN_EVERY", "").strip().lower()
    every_s = _EVERY_S.get(raw)
    if every_s is None:
        if raw:
            logger.warning("ignoring AUTOSCAN_EVERY=%r (expected 1h or 2h)", raw)
        every_s = DEFAULT_EVERY_S
    return AutoScanScheduler(enabled=enabled, every_s=every_s)
