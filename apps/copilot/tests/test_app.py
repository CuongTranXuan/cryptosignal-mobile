import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from cryptosignal_copilot.app import create_app
from cryptosignal_copilot.schema import PatternShape, filter_preview_shapes


class FakeRunner:
    async def run(self, request):
        yield "text", {"delta": "hello "}
        yield "text", {"delta": "world"}
        shape = PatternShape(
            id="s1",
            symbol=request.symbol,
            interval=request.interval,
            kind="trendline",
            name="Test line",
            status="preview",
            source="agent",
            confidence=0.7,
            points=[{"time": 1, "price": 2}, {"time": 3, "price": 4}],
            priceLow=None,
            priceHigh=None,
        )
        yield "shapes", {"shapes": [shape.model_dump()]}
        yield "done", {}


ANALYZE = {
    "symbol": "BTCUSDT",
    "interval": "1h",
    "from": 1,
    "to": 3,
    "closedCandles": [{"time": 1, "open": 1, "high": 2, "low": 1, "close": 2, "volume": 1}],
    "existingShapes": [],
    "prompt": "Find triangles",
}


def _llm_env(monkeypatch):
    monkeypatch.setenv("LLM_API_STYLE", "openai")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.deepseek.com")
    monkeypatch.setenv("LLM_API_KEY", "sk-secret-should-not-appear")
    monkeypatch.setenv("LLM_MODEL", "deepseek-chat")


@pytest.mark.asyncio
async def test_health_ok(monkeypatch):
    _llm_env(monkeypatch)
    app = create_app(runner=FakeRunner())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/v1/copilot/health")
    assert res.status_code == 200
    assert res.json()["model"] == "deepseek-chat"
    assert "sk-secret-should-not-appear" not in res.text


@pytest.mark.asyncio
async def test_health_missing(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_API_STYLE", raising=False)
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    app = create_app(runner=FakeRunner())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/v1/copilot/health")
    assert res.status_code == 503


@pytest.mark.asyncio
async def test_analyze_sse(monkeypatch):
    _llm_env(monkeypatch)
    app = create_app(runner=FakeRunner())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post("/v1/copilot/analyze", json=ANALYZE)
    assert res.status_code == 200
    assert "event: text" in res.text
    assert "event: shapes" in res.text
    assert "event: done" in res.text


@pytest.mark.asyncio
async def test_analyze_validation_error_422(monkeypatch):
    _llm_env(monkeypatch)
    app = create_app(runner=FakeRunner())
    bad = {**ANALYZE, "interval": "not-an-interval"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post("/v1/copilot/analyze", json=bad)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_analyze_coalesce_single_run_per_latest(monkeypatch):
    _llm_env(monkeypatch)

    class SlowFakeRunner:
        def __init__(self) -> None:
            self.calls: list[str] = []
            self.first_started = asyncio.Event()

        async def run(self, request):
            self.calls.append(request.prompt)
            if len(self.calls) == 1:
                self.first_started.set()
                await asyncio.sleep(0.15)
            yield "text", {"delta": request.prompt}
            yield "done", {}

    runner = SlowFakeRunner()
    app = create_app(runner=runner)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        first = asyncio.create_task(
            client.post("/v1/copilot/analyze", json={**ANALYZE, "prompt": "first"})
        )
        await runner.first_started.wait()
        second = asyncio.create_task(
            client.post("/v1/copilot/analyze", json={**ANALYZE, "prompt": "second"})
        )
        await asyncio.sleep(0.05)
        third = asyncio.create_task(
            client.post("/v1/copilot/analyze", json={**ANALYZE, "prompt": "third"})
        )
        results = await asyncio.gather(first, second, third)

    # In-flight first runs once; waiters coalesce to a single latest run ("third").
    assert runner.calls == ["first", "third"]
    assert all(r.status_code == 200 for r in results)
    superseded = [r for r in results if "superseded" in r.text]
    assert len(superseded) == 2
    assert any("event: text" in r.text and "third" in r.text for r in results)


def test_filter_preview_shapes_drops_invalid():
    valid_raw = {
        "id": "ok",
        "symbol": "BTCUSDT",
        "interval": "1h",
        "kind": "trendline",
        "name": "Line",
        "status": "committed",
        "source": "agent",
        "confidence": 0.8,
        "points": [{"time": 1, "price": 1.0}, {"time": 2, "price": 2.0}],
        "priceLow": None,
        "priceHigh": None,
    }
    invalid_raw = {
        "id": "bad-poly",
        "symbol": "BTCUSDT",
        "interval": "1h",
        "kind": "polyline",
        "name": "Broken",
        "status": "preview",
        "source": "agent",
        "confidence": 0.5,
        "points": [{"time": 1, "price": 1.0}],
        "priceLow": None,
        "priceHigh": None,
    }
    valid, dropped = filter_preview_shapes([valid_raw, invalid_raw])
    assert dropped == ["bad-poly"]
    assert len(valid) == 1
    assert valid[0]["id"] == "ok"
    assert valid[0]["status"] == "preview"
