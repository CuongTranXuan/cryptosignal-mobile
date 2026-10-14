import json

from cryptosignal_copilot.output_parsing import extract_json_text, parse_analyze_result_text


def test_extract_json_text_strips_fences():
    raw = 'Here you go:\n```json\n{"summary": "ok", "shapes": [], "markers": []}\n```'
    assert json.loads(extract_json_text(raw))["summary"] == "ok"


def test_extract_json_text_finds_braces_without_fence():
    raw = 'noise {"summary": "x", "shapes": [], "markers": []} tail'
    assert json.loads(extract_json_text(raw))["summary"] == "x"


def test_parse_analyze_result_text_validates_model():
    payload = {"summary": "vi", "shapes": [], "markers": []}
    result = parse_analyze_result_text(json.dumps(payload))
    assert result.summary == "vi"
