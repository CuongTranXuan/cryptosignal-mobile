"""CORS origins come from env; production is same-origin unless the real domain is listed."""

from __future__ import annotations

import pytest

from cryptosignal_copilot.app import CorsConfigError, cors_settings


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for name in ("CORS_ORIGINS", "COPILOT_CORS_ORIGINS", "COPILOT_ENV"):
        monkeypatch.delenv(name, raising=False)


def test_dev_default_covers_the_local_web_ports():
    origins, credentials = cors_settings()
    assert "http://localhost:3100" in origins
    assert "http://127.0.0.1:3100" in origins
    assert "http://localhost:3000" in origins
    assert credentials is True


def test_env_list_is_used_as_is(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "https://cryptosignal.vn, https://www.cryptosignal.vn")
    assert cors_settings() == (["https://cryptosignal.vn", "https://www.cryptosignal.vn"], True)


def test_production_defaults_to_no_cross_origin(monkeypatch):
    monkeypatch.setenv("COPILOT_ENV", "production")
    assert cors_settings() == ([], True)


def test_production_refuses_wildcard(monkeypatch):
    monkeypatch.setenv("COPILOT_ENV", "production")
    monkeypatch.setenv("CORS_ORIGINS", "*")
    with pytest.raises(CorsConfigError):
        cors_settings()


def test_dev_wildcard_still_allowed_without_credentials(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "*")
    assert cors_settings() == (["*"], False)
