import pytest

from cryptosignal_copilot.rate_limit import SlidingWindowRateLimiter, client_ip, trusted_proxies


def test_sliding_window_blocks_after_limit():
    lim = SlidingWindowRateLimiter(limit=2, window_s=60.0)
    assert lim.allow("a") is True
    assert lim.allow("a") is True
    assert lim.allow("a") is False
    assert lim.allow("b") is True


def test_xff_is_ignored_without_trusted_proxies(monkeypatch):
    monkeypatch.delenv("COPILOT_TRUSTED_PROXIES", raising=False)
    # A client spoofing X-Forwarded-For gets its own peer address.
    assert client_ip({"x-forwarded-for": "1.2.3.4"}, "9.9.9.9") == "9.9.9.9"
    assert client_ip({}, "9.9.9.9") == "9.9.9.9"
    assert client_ip({}, None) == "unknown"


def test_xff_is_ignored_when_the_peer_is_not_a_trusted_proxy(monkeypatch):
    monkeypatch.setenv("COPILOT_TRUSTED_PROXIES", "127.0.0.1")
    assert client_ip({"x-forwarded-for": "1.2.3.4"}, "9.9.9.9") == "9.9.9.9"


def test_trusted_proxy_uses_the_rightmost_untrusted_hop(monkeypatch):
    monkeypatch.setenv("COPILOT_TRUSTED_PROXIES", "127.0.0.1, 10.0.0.0/8")
    # nginx appends the real peer; anything left of it may be client-forged.
    headers = {"x-forwarded-for": "6.6.6.6, 1.2.3.4, 10.1.2.3"}
    assert client_ip(headers, "127.0.0.1") == "1.2.3.4"
    assert client_ip({"x-forwarded-for": "1.2.3.4"}, "127.0.0.1") == "1.2.3.4"


def test_trusted_proxy_without_xff_or_only_trusted_hops_keeps_the_peer(monkeypatch):
    monkeypatch.setenv("COPILOT_TRUSTED_PROXIES", "127.0.0.1,10.0.0.0/8")
    assert client_ip({}, "127.0.0.1") == "127.0.0.1"
    assert client_ip({"x-forwarded-for": "10.0.0.5"}, "127.0.0.1") == "127.0.0.1"
    assert client_ip({"x-forwarded-for": "not-an-ip, 1.2.3.4"}, "127.0.0.1") == "1.2.3.4"
    assert client_ip({"x-forwarded-for": "1.2.3.4, garbage"}, "127.0.0.1") == "127.0.0.1"


def test_invalid_trusted_proxy_entries_are_skipped(monkeypatch, caplog):
    monkeypatch.setenv("COPILOT_TRUSTED_PROXIES", "127.0.0.1,nope")
    nets = trusted_proxies()
    assert [str(n) for n in nets] == ["127.0.0.1/32"]
    assert "nope" in caplog.text


@pytest.mark.parametrize("peer", ["::1", "127.0.0.1"])
def test_ipv6_and_ipv4_loopback(monkeypatch, peer):
    monkeypatch.setenv("COPILOT_TRUSTED_PROXIES", "127.0.0.1,::1")
    assert client_ip({"x-forwarded-for": "2001:db8::1"}, peer) == "2001:db8::1"
