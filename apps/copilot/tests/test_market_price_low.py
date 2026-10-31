from cryptosignal_copilot.market_price import format_market_price
from cryptosignal_copilot.symbol_tick import tick_size_for_symbol


def test_low_price_symbols_not_zero_display():
    for symbol, price in (
        ("DOGEUSDT", 0.12345),
        ("PEPEUSDT", 0.00001234),
        ("SHIBUSDT", 0.000021),
    ):
        tick = tick_size_for_symbol(symbol, reference_price=price)
        assert tick > 0
        text = format_market_price(price, symbol)
        assert text not in ("0", "0.0", "0.00", "0.0000")
        assert float(text.replace(",", "")) != 0.0
