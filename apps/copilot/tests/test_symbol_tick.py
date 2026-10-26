"""N25: slim persisted tick cache, per-symbol async refresh, never on the request path."""

from __future__ import annotations

import asyncio
import json
import time

import httpx
import pytest

from cryptosignal_copilot import symbol_tick
from cryptosignal_copilot.candidates import build_candidate_catalog
from cryptosignal_copilot.market_price import format_market_price
from cryptosignal_copilot.symbol_tick import (
    TickSizeCache,
    set_tick_cache_for_tests,
    tick_from_magnitude,
    tick_size_for_symbol,
)
from tests.eval.test_chart_replay import _load_fixture


def _info(symbol: str, tick: str) -> dict:
    return {
        "symbols": [
            {
                "symbol": symbol,
                "filters": [
                    {"filterType": "LOT_SIZE", "stepSize": "0.001"},
                    {"filterType": "PRICE_FILTER", "tickSize": tick},
                ],
            }
        ]
    }


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_magnitude_fallback_matches_binance_usdt_ticks():
    assert tick_from_magnitude(87_299.13) == 0.01
    assert tick_from_magnitude(150.2) == 0.01
    assert tick_from_magnitude(0.12345) == pytest.approx(1e-5)
    assert tick_from_magnitude(0.00001234) == pytest.approx(1e-8)
    assert tick_from_magnitude(0.0) == 0.01


def test_sync_lookup_without_loop_never_fetches():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json=_info("BTCUSDT", "0.01"))

    set_tick_cache_for_tests(TickSizeCache(transport=httpx.MockTransport(handler)))
    assert tick_size_for_symbol("BTCUSDT", reference_price=87_000.0) == 0.01
    assert calls == []


async def test_per_symbol_background_fetch_then_cached():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_info("PEPEUSDT", "0.00000001"))

    cache = set_tick_cache_for_tests(TickSizeCache(transport=httpx.MockTransport(handler)))
    # First lookup: magnitude fallback, fetch scheduled in the background.
    assert tick_size_for_symbol("PEPEUSDT", reference_price=0.0000123) == pytest.approx(1e-8)
    task = cache.schedule("PEPEUSDT")
    assert task is not None
    await task
    assert tick_size_for_symbol("PEPEUSDT", reference_price=0.0000123) == pytest.approx(1e-8)
    assert cache.cached("PEPEUSDT") == pytest.approx(1e-8)
    assert len(seen) == 1
    assert seen[0].url.host == "data-api.binance.vision"
    assert seen[0].url.params["symbol"] == "PEPEUSDT"
    # Cached: no further fetches.
    tick_size_for_symbol("PEPEUSDT")
    await asyncio.sleep(0)
    assert len(seen) == 1


async def test_failure_backs_off_then_retries():
    clock = Clock()
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise httpx.ConnectError("offline")
        if attempts["n"] == 2:
            return httpx.Response(503, text="busy")
        return httpx.Response(200, json=_info("DOGEUSDT", "0.00001"))

    cache = set_tick_cache_for_tests(
        TickSizeCache(transport=httpx.MockTransport(handler), clock=clock)
    )
    first = cache.schedule("DOGEUSDT")
    assert first is not None and await first is None
    assert cache.schedule("DOGEUSDT") is None  # backing off (30 s)
    clock.now += 31
    second = cache.schedule("DOGEUSDT")
    assert second is not None and await second is None
    clock.now += 31
    assert cache.schedule("DOGEUSDT") is None  # backoff doubled to 60 s
    clock.now += 30
    third = cache.schedule("DOGEUSDT")
    assert third is not None and await third == pytest.approx(1e-5)
    assert attempts["n"] == 3
    assert cache.cached("DOGEUSDT") == pytest.approx(1e-5)


async def test_concurrent_lookups_share_one_fetch():
    gate = asyncio.Event()
    calls = {"n": 0}

    class Slow(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            await gate.wait()
            return httpx.Response(200, json=_info("ETHUSDT", "0.01"))

    cache = set_tick_cache_for_tests(TickSizeCache(transport=Slow()))
    for _ in range(5):
        tick_size_for_symbol("ETHUSDT", reference_price=3000.0)
    task = cache.schedule("ETHUSDT")
    await asyncio.sleep(0)
    gate.set()
    assert task is not None
    await task
    assert calls["n"] == 1


async def test_catalog_build_never_waits_on_slow_network():
    """Network mocked at 5 s per request: the catalog build must not wait for it."""
    started = asyncio.Event()

    class VerySlow(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            started.set()
            await asyncio.sleep(5)
            return httpx.Response(200, json=_info("BTCUSDT", "0.01"))

    cache = set_tick_cache_for_tests(TickSizeCache(transport=VerySlow()))
    symbol, interval, candles = _load_fixture("btcusdt_1h_200.json")
    t0 = time.perf_counter()
    catalog = build_candidate_catalog(candles, symbol=symbol, interval=interval)  # type: ignore[arg-type]
    text = format_market_price(87_299.1349, symbol)
    elapsed = time.perf_counter() - t0
    assert catalog.candidates
    assert text == "87,299.13"
    assert elapsed < 1.0, f"catalog build waited on the network: {elapsed:.2f}s"
    await asyncio.wait_for(started.wait(), timeout=1)
    cache.clear()


def test_disabled_cache_never_schedules(monkeypatch):
    assert symbol_tick.get_tick_cache().enabled is False
    assert symbol_tick.get_tick_cache().schedule("BTCUSDT") is None


async def test_persisted_cache_loads_at_startup_and_serves_stale_while_refreshing(tmp_path):
    path = tmp_path / "data" / "symbol_ticks.json"
    clock = Clock()
    clock.now = 1_800_000_000.0
    fetched: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        fetched.append(request.url.params["symbol"])
        return httpx.Response(200, json=_info("BTCUSDT", "0.1"))

    first = TickSizeCache(transport=httpx.MockTransport(handler), clock=clock, path=path)
    first.set("ETHUSDT", 0.01, 0.0001)
    task = first.schedule("BTCUSDT")
    assert task is not None and await task == pytest.approx(0.1)
    on_disk = json.loads(path.read_text())
    assert on_disk["version"] == 1
    assert on_disk["symbols"]["BTCUSDT"] == {
        "tick_size": 0.1,
        "step_size": 0.001,
        "fetched_at": 1_800_000_000,
    }
    assert set(on_disk["symbols"]["BTCUSDT"]) == {"tick_size", "step_size", "fetched_at"}

    # "Restart": a new cache reads the file without any network.
    def offline(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline")

    clock.now += 2 * 24 * 3600  # past TTL → stale
    second = set_tick_cache_for_tests(
        TickSizeCache(transport=httpx.MockTransport(offline), clock=clock, path=path)
    )
    assert second.load() == 2
    assert second.cached_step("BTCUSDT") == pytest.approx(0.001)
    # Stale tick served immediately; refresh scheduled in the background and fails softly.
    assert tick_size_for_symbol("BTCUSDT", reference_price=87_000.0) == pytest.approx(0.1)
    refresh = second.schedule("BTCUSDT")  # joins the task the lookup started
    assert refresh is not None and await refresh is None  # offline → backoff, stale kept
    assert tick_size_for_symbol("BTCUSDT", reference_price=87_000.0) == pytest.approx(0.1)


def test_corrupt_or_missing_file_starts_empty(tmp_path):
    missing = TickSizeCache(path=tmp_path / "nope.json", enabled=False)
    assert missing.load() == 0
    bad = tmp_path / "bad.json"
    bad.write_text("{not json")
    cache = TickSizeCache(path=bad, enabled=False)
    assert cache.load() == 0
    set_tick_cache_for_tests(cache)
    assert tick_size_for_symbol("BTCUSDT", reference_price=87_000.0) == 0.01


def test_default_cache_path_env(monkeypatch, tmp_path):
    monkeypatch.delenv("COPILOT_TICK_CACHE_PATH", raising=False)
    monkeypatch.setenv("COPILOT_DATA_DIR", str(tmp_path))
    assert symbol_tick.default_cache_path() == tmp_path / "symbol_ticks.json"
    monkeypatch.setenv("COPILOT_TICK_CACHE_PATH", str(tmp_path / "x.json"))
    assert symbol_tick.default_cache_path() == tmp_path / "x.json"
    monkeypatch.delenv("COPILOT_TICK_CACHE_PATH")
    monkeypatch.delenv("COPILOT_DATA_DIR")
    assert symbol_tick.default_cache_path().parts[-3:] == ("copilot", "data", "symbol_ticks.json")


async def test_cold_first_lookup_is_fast_without_cache(tmp_path):
    """Cold start, empty disk cache, network mocked at 5 s: first lookup is instant."""

    class VerySlow(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            await asyncio.sleep(5)
            return httpx.Response(200, json=_info("BTCUSDT", "0.01"))

    cache = set_tick_cache_for_tests(
        TickSizeCache(transport=VerySlow(), path=tmp_path / "symbol_ticks.json")
    )
    t0 = time.perf_counter()
    assert format_market_price(87_299.1349, "BTCUSDT") == "87,299.13"
    assert time.perf_counter() - t0 < 0.05
    cache.clear()


async def test_pepe_magnitude_fallback_then_recovers_after_failed_fetch():
    """One failure must not disable lookups until restart (old `_FETCHED_ALL` bug)."""
    clock = Clock()
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise httpx.ConnectError("offline")
        return httpx.Response(200, json=_info("PEPEUSDT", "0.00000001"))

    cache = set_tick_cache_for_tests(
        TickSizeCache(transport=httpx.MockTransport(handler), clock=clock)
    )
    price = 0.00001234
    assert tick_size_for_symbol("PEPEUSDT", reference_price=price) == pytest.approx(1e-8)
    first = next(iter(cache._tasks.values()))
    assert await first is None  # network down
    assert tick_size_for_symbol("PEPEUSDT", reference_price=price) == pytest.approx(1e-8)
    assert format_market_price(price, "PEPEUSDT") == "0.00001234"
    clock.now += 31  # backoff elapsed, network back
    tick_size_for_symbol("PEPEUSDT", reference_price=price)
    retry = next(iter(cache._tasks.values()))
    assert await retry == pytest.approx(1e-8)
    assert cache.cached("PEPEUSDT") == pytest.approx(1e-8)
    assert attempts["n"] == 2
    # Other symbols were never blocked by the PEPE failure.
    assert tick_size_for_symbol("BTCUSDT", reference_price=87_000.0) == 0.01
    cache.clear()
