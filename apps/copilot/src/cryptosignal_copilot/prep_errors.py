from __future__ import annotations

from typing import Any


class AnalyzePrepError(Exception):
    def __init__(
        self,
        code: str,
        status_code: int,
        message: str,
        detail: str = "",
        *,
        fields: dict[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.status_code = status_code
        self.message = message
        self.detail = detail
        # Structured, machine-readable extras merged into the error body (e.g. probe_status).
        self.fields = dict(fields or {})
        super().__init__(message)

    def payload(self) -> dict[str, Any]:
        body: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.detail:
            body["detail"] = self.detail
        body.update(self.fields)
        return body
