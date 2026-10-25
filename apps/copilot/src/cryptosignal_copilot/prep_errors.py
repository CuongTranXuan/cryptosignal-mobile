from __future__ import annotations


class AnalyzePrepError(Exception):
    def __init__(self, code: str, status_code: int, message: str, detail: str = "") -> None:
        self.code = code
        self.status_code = status_code
        self.message = message
        self.detail = detail
        super().__init__(message)
