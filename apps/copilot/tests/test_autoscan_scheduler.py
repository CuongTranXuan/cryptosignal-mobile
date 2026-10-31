"""Auto-analysis scheduler hook: lifecycle only, off unless AUTOSCAN_ENABLED=1."""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from cryptosignal_copilot.app import create_app
from cryptosignal_copilot.autoscan.scheduler import AutoScanScheduler, scheduler_from_env


def test_disabled_by_default(monkeypatch):
    monkeypatch.delenv("AUTOSCAN_ENABLED", raising=False)
    assert scheduler_from_env().enabled is False


@pytest.mark.parametrize(("raw", "seconds"), [("1h", 3600), ("2h", 7200), ("", 3600)])
def test_every_parses_the_spec_values(monkeypatch, raw, seconds):
    monkeypatch.setenv("AUTOSCAN_EVERY", raw)
    assert scheduler_from_env().every_s == seconds


def test_invalid_every_falls_back_to_1h(monkeypatch):
    monkeypatch.setenv("AUTOSCAN_EVERY", "5m")
    assert scheduler_from_env().every_s == 3600


def test_app_lifespan_does_not_start_it_by_default(monkeypatch):
    monkeypatch.delenv("AUTOSCAN_ENABLED", raising=False)
    app = create_app()
    with TestClient(app):
        assert app.state.autoscan.running is False
    assert app.state.autoscan.running is False


def test_app_lifespan_starts_and_stops_it_when_enabled(monkeypatch):
    monkeypatch.setenv("AUTOSCAN_ENABLED", "1")
    app = create_app()
    with TestClient(app):
        assert app.state.autoscan.running is True
    assert app.state.autoscan.running is False


async def test_ticks_on_the_interval_and_stops_cleanly():
    ticks: list[int] = []

    async def on_tick() -> None:
        ticks.append(1)

    sched = AutoScanScheduler(enabled=True, every_s=0.01, on_tick=on_tick)
    sched.start()
    sched.start()  # idempotent
    await asyncio.sleep(0.08)
    await sched.stop()
    assert sched.running is False
    assert len(ticks) >= 2
    await sched.stop()  # idempotent


async def test_a_failing_tick_does_not_kill_the_loop():
    calls: list[int] = []

    async def on_tick() -> None:
        calls.append(1)
        raise RuntimeError("boom")

    sched = AutoScanScheduler(enabled=True, every_s=0.01, on_tick=on_tick)
    sched.start()
    await asyncio.sleep(0.06)
    assert sched.running is True
    await sched.stop()
    assert len(calls) >= 2
