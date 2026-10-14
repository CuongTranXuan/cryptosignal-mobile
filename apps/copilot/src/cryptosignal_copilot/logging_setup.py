from __future__ import annotations

import logging
import sys


def configure_logging() -> None:
    """Ensure package loggers emit to stderr (uvicorn does not configure them by default)."""
    pkg = logging.getLogger("cryptosignal_copilot")
    if any(isinstance(h, logging.StreamHandler) for h in pkg.handlers):
        return
    pkg.setLevel(logging.INFO)
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("%(levelname)s [%(name)s] %(message)s"))
    pkg.addHandler(handler)
    pkg.propagate = True
