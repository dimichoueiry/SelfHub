from __future__ import annotations

from selfhub_cli.space_files import SpaceFileError

from selfhub_api.github import ProviderError


class ApiError(RuntimeError):
    """Becomes `{"error": {"code", "message", "hint"}}` with this HTTP status."""

    def __init__(self, status: int, code: str, message: str, hint: str | None = None,
                 details: dict[str, object] | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.hint = hint
        self.details = details

    def body(self) -> dict[str, object]:
        error: dict[str, object] = {"code": self.code, "message": self.message,
                                    "hint": self.hint}
        if self.details:
            error["details"] = self.details
        return {"error": error}


_FILE_STATUS = {
    "invalid-path": 400,
    "locked": 403,
    "read-only": 403,
    "not-found": 404,
    "exists": 409,
    "conflict": 409,
    "no-change": 422,
    "git": 500,
}


GIT_FAILED = "SelfHub couldn't record that change in this space. Nothing was sent to GitHub."


def from_file_error(exc: SpaceFileError) -> ApiError:
    if exc.code == "git":  # git's own output is for logs and bug reports, not the message
        return ApiError(500, "git", GIT_FAILED, "Try again. If it keeps failing, use Sync now "
                        "first.", {"technical": exc.message})
    return ApiError(_FILE_STATUS.get(exc.code, 400), exc.code, exc.message, exc.hint)


def from_provider_error(exc: ProviderError) -> ApiError:
    details: dict[str, object] | None = {"technical": exc.technical} if exc.technical else None
    return ApiError(exc.status, exc.code, exc.message, exc.hint, details)
