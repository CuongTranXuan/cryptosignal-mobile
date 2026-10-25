import pytest
from pydantic_ai import ModelRetry

from cryptosignal_copilot.output_language_validate import validate_summary_language


def test_blocks_trade_call_language():
    with pytest.raises(ModelRetry, match="entry"):
        validate_summary_language("Tăng mạnh, mua ngay!", "trend_down")


def test_requires_regime_acknowledgement():
    with pytest.raises(ModelRetry, match="regime"):
        validate_summary_language("Giá đang dao động nhẹ.", "trend_down")


def test_allows_aligned_summary():
    validate_summary_language(
        "Xu hướng giảm trên khung 4h; chỉ mô tả hình học, không khuyến nghị lệnh.",
        "trend_down",
    )
