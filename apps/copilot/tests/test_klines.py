import httpx
import pytest
from cryptosignal_copilot.klines import KLINES_URL, fetch_klines

ROW = [1710000000000, "100", "110", "90", "105", "12.5", 1710003599999, "0", 1, "0", "0", "0"]


@pytest.mark.asyncio
async def test_fetch_klines_maps_row():
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url).startswith(KLINES_URL)
        assert request.url.params["symbol"] == "BTCUSDT"
        assert request.url.params["interval"] == "1h"
        return httpx.Response(200, json=[ROW])

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        candles = await fetch_klines("BTCUSDT", "1h", limit=500, client=client)
    assert candles[0].time == 1710000000
    assert candles[0].close == 105.0


@pytest.mark.asyncio
async def test_fetch_klines_http_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"code": -1121, "msg": "Invalid symbol."})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(httpx.HTTPStatusError):
            await fetch_klines("NOPEUSDT", "1h", client=client)
