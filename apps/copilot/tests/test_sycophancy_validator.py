import pytest
from pydantic_ai import ModelRetry

from cryptosignal_copilot.output_language_validate import (
    validate_summary_direction,
    validate_summary_imperatives,
)

BLOCK_CASES = [
    "long ở hỗ trợ 60k",
    "short tại kháng cự 65k",
    "nên bán khi chạm vùng",
    "hãy mua vào ở đáy",
    "Buy the dip here",
    "go long on breakout",
    "SL 65k",
    "stop at 65k, TP 70k",
    "Tăng mạnh, mua ngay!",
]

ALLOW_CASES = [
    "ATR tăng mạnh trong 48h qua.",
    "nếu breakdown dưới 80k thì mô hình vô hiệu",
    "vô hiệu nếu breakout up qua đỉnh",
    "Đây không phải tín hiệu entry.",
    "giá mục tiêu theo mô hình H&S khoảng 72k",
    "vùng cắt lỗ của phe bán nằm trên đỉnh",
    "Giá dao động trong biên 60-65k.",
]


@pytest.mark.parametrize("text", BLOCK_CASES)
def test_imperative_blocklist_blocks(text: str) -> None:
    with pytest.raises(ModelRetry):
        validate_summary_imperatives(text)


@pytest.mark.parametrize("text", ALLOW_CASES)
def test_imperative_blocklist_allows_descriptive(text: str) -> None:
    validate_summary_imperatives(text)


def test_summary_direction_contradicts_regime() -> None:
    with pytest.raises(ModelRetry, match="trend_down"):
        validate_summary_direction("bullish", "trend_down")


def test_summary_direction_conditional_allowed() -> None:
    validate_summary_direction("conditional", "trend_down")
