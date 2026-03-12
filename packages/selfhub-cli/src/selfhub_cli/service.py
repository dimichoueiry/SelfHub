from __future__ import annotations

import os
from pathlib import Path

from selfhub_core import DEFAULT_DIRECTORIES, DEFAULT_MARKDOWN_FILES, REPO_NAME
from selfhub_core.contracts import CommandResult, SaveResult, SearchResult
from selfhub_core.git_ops import (
    GitCommandError,
    add_remote,
    clone_repo,
    commit,
    current_head,
    get_log,
    get_status,
    has_remote,
    has_staged_changes,
    has_upstream,
    init_repo,
    is_git_repo,
    pull,
    push,
    stage_all,
)
from selfhub_core.github_api import GitHubApiError, GitHubBootstrapClient


class SelfHubService:
    def __init__(self, repo_path: Path) -> None:
        self.repo_path = repo_path

    def init_repo(
        self,
        remote_url: str | None = None,
        github_owner: str | None = None,
        github_token_env: str = "GITHUB_TOKEN",
        bootstrap_github: bool = False,
    ) -> CommandResult:
        resolved_remote = remote_url

        if bootstrap_github:
            if not github_owner:
                return CommandResult(
                    success=False,
                    message="GitHub bootstrap requires --github-owner.",
                )
            token = os.getenv(github_token_env)
            if not token:
                return CommandResult(
                    success=False,
                    message=f"Missing GitHub token in env var: {github_token_env}",
                )

            try:
                client = GitHubBootstrapClient(token=token, owner=github_owner)
                github_repo = client.ensure_private_repo(REPO_NAME)
            except GitHubApiError as exc:
                return CommandResult(success=False, message=str(exc))
            resolved_remote = github_repo.clone_url

        try:
            cloned = self._ensure_local_repo(resolved_remote)
            created_files = self._ensure_structure()
            commit_sha = self._commit_structure_changes(created_files)
            push_note = self._sync_after_init(commit_sha)
        except GitCommandError as exc:
            return CommandResult(success=False, message=str(exc), data={"stderr": exc.stderr})

        details = {
            "repo_path": str(self.repo_path),
            "remote_url": resolved_remote,
            "cloned": cloned,
            "files_created": created_files,
            "commit_sha": commit_sha,
        }
        message = f"Initialized SelfHub at {self.repo_path}"
        if push_note:
            message = f"{message}. {push_note}"
        return CommandResult(success=True, message=message, data=details)

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
        if not self.repo_path.exists():
            return CommandResult(
                success=False,
                message=(
                    f"SelfHub repo not found at {self.repo_path}. "
                    "Run 'selfhub init' first."
                ),
            )

        if target is None:
            files = self._markdown_files(self.repo_path)
            summaries = [self._summarize_file(path) for path in files]
            message = "\n".join(summaries) if summaries else "No markdown files found."
            return CommandResult(
                success=True,
                message=message,
                data={"files": [str(path.relative_to(self.repo_path)) for path in files]},
            )

        path = self.repo_path / target
        if not path.exists():
            return CommandResult(success=False, message=f"Path not found: {target}")
        if path.is_dir():
            files = self._markdown_files(path)
            rel_paths = [str(p.relative_to(self.repo_path)) for p in files]
            message = "\n".join(rel_paths) if rel_paths else "No markdown files found."
            return CommandResult(success=True, message=message, data={"files": rel_paths})

        content = path.read_text(encoding="utf-8")
        return CommandResult(
            success=True,
            message=content,
            data={"path": target, "content": content},
        )

    def status(self) -> CommandResult:
        if not is_git_repo(self.repo_path):
            return CommandResult(
                success=False,
                message=(
                    f"No git repository found at {self.repo_path}. "
                    "Run 'selfhub init' first."
                ),
            )

        try:
            status = get_status(self.repo_path)
        except GitCommandError as exc:
            return CommandResult(success=False, message=str(exc), data={"stderr": exc.stderr})

        message = (
            f"branch={status.branch} modified={len(status.modified)} staged={len(status.staged)} "
            f"untracked={len(status.untracked)} ahead={status.ahead} behind={status.behind}"
        )
        return CommandResult(success=True, message=message, data=status.to_dict())

    def sync(self) -> CommandResult:
        if not is_git_repo(self.repo_path):
            return CommandResult(
                success=False,
                message=(
                    f"No git repository found at {self.repo_path}. "
                    "Run 'selfhub init' first."
                ),
            )

        try:
            if not has_remote(self.repo_path):
                return CommandResult(
                    success=True,
                    message="No remote configured. Local repository is up to date.",
                )

            if not has_upstream(self.repo_path):
                head = current_head(self.repo_path)
                if head is None:
                    return CommandResult(
                        success=True,
                        message="No commits yet. Create your first commit before syncing.",
                    )
                push(self.repo_path, set_upstream=True)
                message = "Configured upstream branch and pushed current commits."
            else:
                pull_output = pull(self.repo_path)
                message = pull_output or "Already up to date."

            status = get_status(self.repo_path)
            return CommandResult(success=True, message=message, data=status.to_dict())
        except GitCommandError as exc:
            return CommandResult(success=False, message=str(exc), data={"stderr": exc.stderr})

    def log(self, file_path: str | None = None, limit: int = 20) -> CommandResult:
        if not is_git_repo(self.repo_path):
            return CommandResult(
                success=False,
                message=(
                    f"No git repository found at {self.repo_path}. "
                    "Run 'selfhub init' first."
                ),
            )

        try:
            entries = get_log(self.repo_path, limit=limit, file_path=file_path)
        except GitCommandError as exc:
            return CommandResult(success=False, message=str(exc), data={"stderr": exc.stderr})

        if not entries:
            return CommandResult(success=True, message="No commits yet.", data={"commits": []})

        lines = [
            f"{entry.committed_at} {entry.commit_sha[:8]} {entry.subject}"
            for entry in entries
        ]
        return CommandResult(
            success=True,
            message="\n".join(lines),
            data={"commits": [entry.to_dict() for entry in entries]},
        )

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

    def _ensure_local_repo(self, remote_url: str | None) -> bool:
        if remote_url:
            if not self.repo_path.exists():
                clone_repo(remote_url, self.repo_path)
                return True

            if is_git_repo(self.repo_path):
                if not has_remote(self.repo_path):
                    add_remote(self.repo_path, remote_url)
                return False

            if any(self.repo_path.iterdir()):
                raise GitCommandError(
                    f"Directory exists and is not a git repo: {self.repo_path}",
                )
            clone_repo(remote_url, self.repo_path)
            return True

        if not is_git_repo(self.repo_path):
            init_repo(self.repo_path)
        return False

    def _ensure_structure(self) -> list[str]:
        created: list[str] = []
        for directory in DEFAULT_DIRECTORIES:
            (self.repo_path / directory).mkdir(parents=True, exist_ok=True)

        for rel_path, content in DEFAULT_MARKDOWN_FILES.items():
            target = self.repo_path / rel_path
            if not target.exists():
                target.write_text(content, encoding="utf-8")
                created.append(rel_path)
        return created

    def _commit_structure_changes(self, created_files: list[str]) -> str | None:
        if not created_files:
            return None

        stage_all(self.repo_path)
        if not has_staged_changes(self.repo_path):
            return None

        return commit(self.repo_path, "[SelfHub] Initialize standard structure")

    def _sync_after_init(self, commit_sha: str | None) -> str | None:
        if not has_remote(self.repo_path):
            return None

        if commit_sha is None:
            return None

        try:
            push(self.repo_path, set_upstream=not has_upstream(self.repo_path))
        except GitCommandError:
            return "Initialized locally, but remote push failed. Run 'selfhub sync' later."
        return None

    def _markdown_files(self, base_path: Path) -> list[Path]:
        return sorted(path for path in base_path.rglob("*.md") if path.is_file())

    def _summarize_file(self, path: Path) -> str:
        relative = path.relative_to(self.repo_path)
        first_line = ""
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                stripped = line.strip()
                if stripped:
                    first_line = stripped
                    break
        summary = first_line if first_line else "(empty)"
        return f"{relative}: {summary}"
