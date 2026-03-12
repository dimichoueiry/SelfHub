from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(slots=True)
class CommandResult:
    success: bool
    message: str | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(slots=True)
class SaveResult(CommandResult):
    file_path: str | None = None
    commit_sha: str | None = None
    action_taken: str | None = None


@dataclass(slots=True)
class SearchResult:
    path: str
    excerpt: str
    score: float

    def to_dict(self) -> dict[str, object]:
        return asdict(self)
