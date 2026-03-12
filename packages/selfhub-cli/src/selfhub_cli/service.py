from __future__ import annotations

from pathlib import Path

from selfhub_core import DEFAULT_DIRECTORIES, DEFAULT_MARKDOWN_FILES
from selfhub_core.contracts import CommandResult, SaveResult, SearchResult


class SelfHubService:
    def __init__(self, repo_path: Path) -> None:
        self.repo_path = repo_path

    def init_repo(self) -> CommandResult:
        self.repo_path.mkdir(parents=True, exist_ok=True)
        for directory in DEFAULT_DIRECTORIES:
            (self.repo_path / directory).mkdir(parents=True, exist_ok=True)
        for rel_path, content in DEFAULT_MARKDOWN_FILES.items():
            target = self.repo_path / rel_path
            if not target.exists():
                target.write_text(content, encoding="utf-8")
        return CommandResult(success=True, message=f"Initialized SelfHub at {self.repo_path}")

    def save(self, content: str, file_path: str | None = None) -> SaveResult:
        target_rel = file_path or "meta/profile.md"
        target = self.repo_path / target_rel
        target.parent.mkdir(parents=True, exist_ok=True)
        prefix = "\n- " if target.exists() else ""
        with target.open("a", encoding="utf-8") as handle:
            handle.write(f"{prefix}{content}\n")
        return SaveResult(
            success=True,
            message="Saved content locally.",
            file_path=f"/{target_rel}",
            commit_sha=None,
            action_taken="append",
        )

    def read(self, target: str | None = None) -> CommandResult:
        if target is None:
            return CommandResult(success=True, message="Read command scaffolding is ready.")

        path = self.repo_path / target
        if not path.exists():
            return CommandResult(success=False, message=f"Path not found: {target}")
        if path.is_dir():
            files = sorted(str(p.relative_to(self.repo_path)) for p in path.rglob("*.md"))
            message = "\n".join(files) or "No markdown files found."
            return CommandResult(success=True, message=message)
        return CommandResult(success=True, message=path.read_text(encoding="utf-8"))

    def status(self) -> CommandResult:
        return CommandResult(
            success=True,
            message="Status command scaffolded (git integration next).",
        )

    def sync(self) -> CommandResult:
        return CommandResult(
            success=True,
            message="Sync command scaffolded (git pull integration next).",
        )

    def log(self, file_path: str | None = None) -> CommandResult:
        suffix = f" for {file_path}" if file_path else ""
        return CommandResult(success=True, message=f"Log command scaffolded{suffix}.")

    def search(self, query: str, mode: str = "hybrid") -> list[SearchResult]:
        if mode not in {"exact", "semantic", "hybrid"}:
            raise ValueError("mode must be one of: exact, semantic, hybrid")

        results: list[SearchResult] = []
        for path in self.repo_path.rglob("*.md"):
            content = path.read_text(encoding="utf-8")
            lower_content = content.lower()
            lower_query = query.lower()
            if lower_query in lower_content:
                index = lower_content.index(lower_query)
                excerpt = (
                    content[max(0, index - 30) : index + len(query) + 30]
                    .replace("\n", " ")
                    .strip()
                )
                score = 1.0 if mode == "exact" else 0.85
                rel_path = str(path.relative_to(self.repo_path))
                results.append(SearchResult(path=f"/{rel_path}", excerpt=excerpt, score=score))

        return sorted(results, key=lambda item: item.score, reverse=True)
