import pytest
from httpx import ASGITransport, AsyncClient

from cryptosignal_copilot.app import create_app
from cryptosignal_copilot.schema import PatternShape


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


@pytest.mark.asyncio
async def test_health_ok(monkeypatch):
    monkeypatch.setenv("LLM_API_STYLE", "openai")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.deepseek.com")
    monkeypatch.setenv("LLM_API_KEY", "sk-secret-should-not-appear")
    monkeypatch.setenv("LLM_MODEL", "deepseek-chat")
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
    monkeypatch.setenv("LLM_API_STYLE", "openai")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.deepseek.com")
    monkeypatch.setenv("LLM_API_KEY", "sk-secret-should-not-appear")
    monkeypatch.setenv("LLM_MODEL", "deepseek-chat")
    app = create_app(runner=FakeRunner())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post("/v1/copilot/analyze", json=ANALYZE)
    assert res.status_code == 200
    assert "event: text" in res.text
    assert "event: shapes" in res.text
    assert "event: done" in res.text
