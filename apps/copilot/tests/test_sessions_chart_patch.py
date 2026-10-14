from cryptosignal_copilot.schema import SessionChartContext
from cryptosignal_copilot.sessions_store import SessionsStore


def test_patch_chart_dict_becomes_session_chart_context(tmp_path):
    store = SessionsStore(db_path=tmp_path / "s.sqlite3", run_migrations=True)
    chart = SessionChartContext(
        symbol="BTCUSDT",
        interval="1h",
        from_=1,
        to=2,
        candle_count=10,
    )
    created = store.create_session(title="t", model_id="m", chart=chart)
    updated = store.update_session(
        created.id,
        chart={
            "symbol": "ETHUSDT",
            "interval": "15m",
            "from": 3,
            "to": 4,
            "candle_count": 20,
        },
    )
    assert isinstance(updated.chart, SessionChartContext)
    assert updated.chart.symbol == "ETHUSDT"
    dumped = updated.model_dump(by_alias=True)
    assert isinstance(dumped["chart"], dict)
    assert dumped["chart"]["symbol"] == "ETHUSDT"
