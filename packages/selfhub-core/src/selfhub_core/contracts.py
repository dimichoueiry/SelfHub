from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(slots=True)
class CommandResult:
    success: bool
    message: str | None = None
    data: dict[str, Any] | None = None

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


@dataclass(slots=True)
class GitStatus:
    branch: str
    modified: list[str]
    staged: list[str]
    untracked: list[str]
    ahead: int
    behind: int
    has_upstream: bool
    last_sync_at: str | None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(slots=True)
class GitLogEntry:
    commit_sha: str
    committed_at: str
    subject: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)
