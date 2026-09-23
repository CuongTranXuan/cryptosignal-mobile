from cryptosignal_copilot.rate_limit import SlidingWindowRateLimiter, client_ip


def test_sliding_window_blocks_after_limit():
    lim = SlidingWindowRateLimiter(limit=2, window_s=60.0)
    assert lim.allow("a") is True
    assert lim.allow("a") is True
    assert lim.allow("a") is False
    assert lim.allow("b") is True


def test_client_ip_prefers_xff():
    assert client_ip({"x-forwarded-for": "1.2.3.4, 5.6.7.8"}, "9.9.9.9") == "1.2.3.4"
    assert client_ip({}, "9.9.9.9") == "9.9.9.9"
    assert client_ip({}, None) == "unknown"
