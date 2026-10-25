import pytest
from pydantic_ai import ModelRetry

from cryptosignal_copilot.output_language_validate import validate_pick_note

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
    "Nên mua ở 60k",
    "Short ở 70k",
    "SL: 65k",
    "Take profit at 70k",
    "Cắt lỗ ở 65k",
    "Buy here",
    "chốt lời ở 70k",
    "đặt stop ở 65k",
    "Mua vào quanh 60k",
    "Canh short ở kháng cự",
    "Go short now",
]

ALLOW_CASES = [
    "ATR tăng mạnh trong 48h qua.",
    "nếu breakdown dưới 80k thì mô hình vô hiệu",
    "vô hiệu nếu breakout up qua đỉnh",
    "Đây không phải tín hiệu entry.",
    "giá mục tiêu theo mô hình H&S khoảng 72k",
    "vùng cắt lỗ của phe bán nằm trên đỉnh",
    "Giá dao động trong biên 60-65k.",
    "Thanh khoản long ở dưới 60k gần đáy.",
    "Phe short tại vùng 70k bị ép về mid.",
    "Lực bán ngay sau đỉnh nhưng chưa phá vùng.",
    "Volume TP 1h thấp so với trung bình.",
    "Đỉnh đôi với hai chạm trong biên ATR.",
    "Đường trendline nối hai đáy swing.",
    "Vùng FVG còn trống phía trên.",
    "Neckline H&S ngang qua đáy vai.",
]


@pytest.mark.parametrize("text", BLOCK_CASES)
def test_imperative_blocklist_blocks(text: str) -> None:
    with pytest.raises(ModelRetry):
        validate_pick_note(text)


@pytest.mark.parametrize("text", ALLOW_CASES)
def test_imperative_blocklist_allows_descriptive(text: str) -> None:
    validate_pick_note(text)


def test_directional_narrative_blocked_in_pick_note() -> None:
    with pytest.raises(ModelRetry):
        validate_pick_note("phe mua đã kiểm soát; giá sẽ sớm đảo chiều lên và vượt đỉnh cũ")
