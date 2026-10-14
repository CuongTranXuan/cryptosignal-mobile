from cryptosignal_copilot.model_catalog import normalize_model_row
from cryptosignal_copilot.model_overrides import apply_id_prefix_aliases
from cryptosignal_copilot.model_visibility import is_advanced_route, normalize_upstream_model_id


def test_normalize_cu_alias(monkeypatch, omniroute_catalog_env):
    assert normalize_upstream_model_id("cu/composer-2.5") == "cursor/composer-2.5"
    assert apply_id_prefix_aliases("cu/auto") == "cursor/auto"


def test_cursor_auto_marked_advanced(monkeypatch, omniroute_catalog_env):
    model = normalize_model_row({"id": "cursor/auto", "owned_by": "cursor"})
    assert model.advanced is True
    assert model.reasoning_efforts == ()
    assert model.supports_reasoning is False
    assert model.structured_output_mode == "text_json"
    assert model.request_max_tokens == 8_192


def test_cursor_auto_router_advanced(omniroute_catalog_env):
    assert is_advanced_route("cursor/auto-balance", "cursor")
