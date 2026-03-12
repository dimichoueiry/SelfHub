from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import UTC, datetime
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
from selfhub_core.save_intelligence import (
    DuplicateDecision,
    SaveIntelligence,
    SaveIntelligenceError,
    build_default_save_intelligence,
)


@dataclass(slots=True)
class ParsedEntry:
    line_index: int
    text: str


class SelfHubService:
    def __init__(
        self,
        repo_path: Path,
        save_intelligence: SaveIntelligence | None = None,
    ) -> None:
        self.repo_path = repo_path
        self.save_intelligence = save_intelligence or build_default_save_intelligence()

    def init_repo(
        self,
        remote_url: str | None = None,
        github_owner: str | None = None,
        github_token_env: str = "GITHUB_TOKEN",
        github_token: str | None = None,
        bootstrap_github: bool = False,
    ) -> CommandResult:
        resolved_remote = remote_url

        if bootstrap_github:
            if not github_owner:
                return CommandResult(
                    success=False,
                    message="GitHub bootstrap requires --github-owner.",
                )
            token = github_token or os.getenv(github_token_env)
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

    def save(
        self,
        content: str,
        file_path: str | None = None,
        tool_name: str = "SelfHub CLI",
        on_duplicate: str | None = None,
        classification_threshold: float = 0.80,
    ) -> SaveResult:
        if not is_git_repo(self.repo_path):
            return SaveResult(
                success=False,
                message=(
                    f"No git repository found at {self.repo_path}. "
                    "Run 'selfhub init' first."
                ),
            )

        duplicate_mode = (on_duplicate or "").strip().lower()
        if duplicate_mode and duplicate_mode not in {"add", "update"}:
            return SaveResult(
                success=False,
                message="Invalid --on-duplicate value. Use 'add' or 'update'.",
            )

        try:
            self._sync_before_write()
        except GitCommandError as exc:
            return SaveResult(success=False, message=str(exc), data={"stderr": exc.stderr})

        resolved_target = file_path.lstrip("/") if file_path else None
        action = "append"
        classification: dict[str, object] | None = None

        if resolved_target is None:
            if self.save_intelligence is None:
                return SaveResult(
                    success=False,
                    message=(
                        "No thinking model configured for classification. "
                        "Set SELFHUB_THINKING_PROVIDER=openrouter|ollama (or legacy "
                        "SELFHUB_LLM_PROVIDER) and required env vars, "
                        "or pass --file."
                    ),
                )

            allowed_files = self._classification_file_candidates()
            try:
                decision = self.save_intelligence.classify(
                    content=content,
                    allowed_files=allowed_files,
                )
            except SaveIntelligenceError as exc:
                return SaveResult(success=False, message=str(exc))

            classification = {
                "target_file": decision.target_file,
                "confidence": decision.confidence,
                "action": decision.action,
                "reason": decision.reason,
            }

            if decision.confidence < classification_threshold:
                return SaveResult(
                    success=False,
                    message=(
                        f"Low classification confidence ({decision.confidence:.2f}). "
                        "Choose a target file."
                    ),
                    action_taken="needs_target_confirmation",
                    data={
                        "needs_target_confirmation": True,
                        "suggested_file": decision.target_file,
                        "confidence": decision.confidence,
                        "reason": decision.reason,
                        "allowed_files": allowed_files,
                    },
                )

            resolved_target = decision.target_file
            action = decision.action

        assert resolved_target is not None

        safe_target = self._safe_target_path(resolved_target)
        if safe_target is None:
            return SaveResult(success=False, message="Invalid target file path.")

        safe_target.parent.mkdir(parents=True, exist_ok=True)
        if not safe_target.exists() and resolved_target in DEFAULT_MARKDOWN_FILES:
            safe_target.write_text(DEFAULT_MARKDOWN_FILES[resolved_target], encoding="utf-8")

        parsed_entries = self._parse_entries(safe_target)
        duplicate_decision = self._check_duplicate(
            content=content,
            target_file=resolved_target,
            parsed_entries=parsed_entries,
        )
        if isinstance(duplicate_decision, SaveResult):
            return duplicate_decision

        if duplicate_decision.is_duplicate and duplicate_mode == "":
            return SaveResult(
                success=False,
                message="Potential duplicate detected. Choose add or update.",
                file_path=f"/{resolved_target}",
                action_taken="needs_duplicate_resolution",
                data={
                    "needs_duplicate_resolution": True,
                    "target_file": resolved_target,
                    "existing_entry": duplicate_decision.existing_entry,
                    "confidence": duplicate_decision.confidence,
                    "reason": duplicate_decision.reason,
                    "suggested_action": "update",
                },
            )

        timestamp = datetime.now(tz=UTC).replace(microsecond=0).isoformat()
        formatted_entry = f"- {content.strip()} (saved {timestamp} via {tool_name})"

        if duplicate_decision.is_duplicate and duplicate_mode == "update":
            wrote = self._update_entry(
                target=safe_target,
                existing_text=duplicate_decision.existing_entry,
                replacement=formatted_entry,
            )
            if not wrote:
                self._append_entry(target=safe_target, entry=formatted_entry)
                action = "append"
            else:
                action = "update"
        else:
            self._append_entry(target=safe_target, entry=formatted_entry)
            action = "append"

        try:
            stage_all(self.repo_path)
            if not has_staged_changes(self.repo_path):
                return SaveResult(
                    success=True,
                    message=f"No changes detected for /{resolved_target}.",
                    file_path=f"/{resolved_target}",
                    commit_sha=current_head(self.repo_path),
                    action_taken=action,
                    data={"classification": classification},
                )

            commit_sha = commit(self.repo_path, f"[SelfHub] {action} via {tool_name}")

            push_warning: str | None = None
            if has_remote(self.repo_path):
                try:
                    push(self.repo_path, set_upstream=not has_upstream(self.repo_path))
                except GitCommandError:
                    push_warning = "Saved locally; remote push failed. Run 'selfhub sync' later."

            message = f"Saved to /{resolved_target}."
            if push_warning:
                message = f"{message} {push_warning}"

            return SaveResult(
                success=True,
                message=message,
                file_path=f"/{resolved_target}",
                commit_sha=commit_sha,
                action_taken=action,
                data={
                    "classification": classification,
                    "duplicate_check": {
                        "is_duplicate": duplicate_decision.is_duplicate,
                        "confidence": duplicate_decision.confidence,
                    },
                },
            )
        except GitCommandError as exc:
            return SaveResult(success=False, message=str(exc), data={"stderr": exc.stderr})

    def delete(
        self,
        file_path: str,
        index: int | None = None,
        contains: str | None = None,
        delete_all: bool = False,
        tool_name: str = "SelfHub CLI",
    ) -> CommandResult:
        if not is_git_repo(self.repo_path):
            return CommandResult(
                success=False,
                message=(
                    f"No git repository found at {self.repo_path}. "
                    "Run 'selfhub init' first."
                ),
            )

        has_index = index is not None
        has_contains = contains is not None and bool(contains.strip())
        if has_index == has_contains:
            return CommandResult(
                success=False,
                message="Provide exactly one selector: --index or --contains.",
            )

        normalized_target = file_path.strip().lstrip("/")
        safe_target = self._safe_target_path(normalized_target)
        if safe_target is None:
            return CommandResult(success=False, message="Invalid target file path.")
        if not safe_target.exists():
            return CommandResult(success=False, message=f"Path not found: {file_path}")
        if safe_target.is_dir():
            return CommandResult(
                success=False,
                message=f"Expected a file path, got directory: {file_path}",
            )

        try:
            self._sync_before_write()
        except GitCommandError as exc:
            return CommandResult(success=False, message=str(exc), data={"stderr": exc.stderr})

        parsed_entries = self._parse_entries(safe_target)
        if not parsed_entries:
            return CommandResult(
                success=False,
                message=f"No bullet entries found in /{normalized_target}.",
            )

        selected_entries: list[ParsedEntry]
        if has_index:
            assert index is not None
            if index <= 0:
                return CommandResult(
                    success=False,
                    message="--index must be a positive 1-based value.",
                )
            if index > len(parsed_entries):
                entry_count = len(parsed_entries)
                noun = "entry" if entry_count == 1 else "entries"
                return CommandResult(
                    success=False,
                    message=(
                        f"--index {index} is out of range. "
                        f"File has {entry_count} bullet {noun}."
                    ),
                )
            selected_entries = [parsed_entries[index - 1]]
        else:
            assert contains is not None
            needle = contains.strip().lower()
            selected_entries = [entry for entry in parsed_entries if needle in entry.text.lower()]
            if not selected_entries:
                return CommandResult(
                    success=False,
                    message=(
                        f"No entries containing '{contains.strip()}' "
                        f"were found in /{normalized_target}."
                    ),
                )
            if len(selected_entries) > 1 and not delete_all:
                matches = [
                    {"index": parsed_entries.index(entry) + 1, "entry": entry.text}
                    for entry in selected_entries
                ]
                return CommandResult(
                    success=False,
                    message=(
                        f"Found {len(selected_entries)} matching entries in /{normalized_target}. "
                        "Use --index for one specific entry or pass --all."
                    ),
                    data={
                        "needs_delete_confirmation": True,
                        "target_file": normalized_target,
                        "matches": matches,
                    },
                )

        lines = safe_target.read_text(encoding="utf-8").splitlines()
        line_indexes = {entry.line_index for entry in selected_entries}
        kept_lines = [line for idx, line in enumerate(lines) if idx not in line_indexes]
        updated_content = "\n".join(kept_lines).rstrip()
        safe_target.write_text(f"{updated_content}\n", encoding="utf-8")

        try:
            stage_all(self.repo_path)
            if not has_staged_changes(self.repo_path):
                return CommandResult(
                    success=True,
                    message=f"No changes detected for /{normalized_target}.",
                    data={
                        "file_path": f"/{normalized_target}",
                        "deleted_count": len(selected_entries),
                        "commit_sha": current_head(self.repo_path),
                    },
                )

            commit_sha = commit(self.repo_path, f"[SelfHub] delete via {tool_name}")

            push_warning: str | None = None
            if has_remote(self.repo_path):
                try:
                    push(self.repo_path, set_upstream=not has_upstream(self.repo_path))
                except GitCommandError:
                    push_warning = "Deleted locally; remote push failed. Run 'selfhub sync' later."

            message = (
                f"Deleted {len(selected_entries)} entr"
                f"{'y' if len(selected_entries) == 1 else 'ies'} from /{normalized_target}."
            )
            if push_warning:
                message = f"{message} {push_warning}"

            return CommandResult(
                success=True,
                message=message,
                data={
                    "file_path": f"/{normalized_target}",
                    "deleted_count": len(selected_entries),
                    "deleted_entries": [entry.text for entry in selected_entries],
                    "commit_sha": commit_sha,
                },
            )
        except GitCommandError as exc:
            return CommandResult(success=False, message=str(exc), data={"stderr": exc.stderr})

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

    def search(self, query: str, mode: str = "hybrid", limit: int = 8) -> list[SearchResult]:
        if mode not in {"exact", "semantic", "hybrid"}:
            raise ValueError("mode must be one of: exact, semantic, hybrid")
        cleaned_query = query.strip()
        if not cleaned_query:
            return []
        safe_limit = max(1, min(limit, 25))

        query_terms = _meaningful_terms(_tokenize(cleaned_query))
        if not query_terms:
            query_terms = _tokenize(cleaned_query)
        expanded_terms = _expand_terms(query_terms)
        results: list[SearchResult] = []

        for path in self.repo_path.rglob("*.md"):
            if not path.is_file():
                continue
            content = path.read_text(encoding="utf-8")
            rel_path = str(path.relative_to(self.repo_path))
            match = self._best_match_for_file(
                rel_path=rel_path,
                content=content,
                query=cleaned_query,
                query_terms=query_terms,
                expanded_terms=expanded_terms,
                mode=mode,
            )
            if match is not None:
                results.append(match)

        return sorted(results, key=lambda item: item.score, reverse=True)[:safe_limit]

    def _best_match_for_file(
        self,
        rel_path: str,
        content: str,
        query: str,
        query_terms: set[str],
        expanded_terms: set[str],
        mode: str,
    ) -> SearchResult | None:
        lines = content.splitlines()
        if not lines:
            return None

        query_lower = query.lower()
        path_terms = _tokenize(rel_path.replace("/", " "))
        path_overlap_hits = len(expanded_terms & path_terms)
        path_overlap = _coverage(expanded_terms, path_terms)
        best_score = 0.0
        best_index: int | None = None

        for index, line in enumerate(lines):
            stripped = line.strip()
            if not stripped:
                continue
            line_terms = _tokenize(stripped)
            if not line_terms:
                continue

            exact_hit = bool(query_lower) and query_lower in stripped.lower()
            term_coverage = _coverage(query_terms, line_terms)
            expanded_coverage = _coverage(expanded_terms, line_terms)
            density = _density(expanded_terms, line_terms)

            if mode == "exact":
                if not exact_hit:
                    continue
                score = 1.0
            else:
                lexical = (0.72 * term_coverage) + (0.18 * density) + (0.10 * path_overlap)
                semantic = (0.55 * term_coverage) + (0.25 * expanded_coverage) + (
                    0.20 * path_overlap
                )
                if exact_hit:
                    lexical = max(lexical, 0.98)
                    semantic = min(1.0, semantic + 0.20)
                score = semantic if mode == "semantic" else max(lexical, semantic)

                if mode == "semantic":
                    if (
                        not exact_hit
                        and expanded_coverage < 0.20
                        and path_overlap < 0.20
                        and path_overlap_hits == 0
                    ):
                        continue
                if mode == "hybrid":
                    if (
                        not exact_hit
                        and term_coverage < 0.20
                        and expanded_coverage < 0.20
                        and path_overlap_hits == 0
                    ):
                        continue

            if score > best_score:
                best_score = min(score, 1.0)
                best_index = index

        # Path-aware fallback: if query maps to a category (e.g., "work" -> career), return
        # the latest content line from that file even if direct term overlap is weak.
        if best_index is None and mode in {"semantic", "hybrid"} and path_overlap_hits >= 1:
            fallback_index = _latest_content_line_index(lines)
            if fallback_index is None:
                return None
            best_index = fallback_index
            best_score = min(0.35 + (0.30 * path_overlap), 0.70)

        if best_index is None:
            return None

        excerpt = _excerpt_around(lines, best_index)
        if not excerpt:
            return None
        return SearchResult(path=f"/{rel_path}", excerpt=excerpt, score=best_score)

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

    def _sync_before_write(self) -> None:
        if has_remote(self.repo_path) and has_upstream(self.repo_path):
            status = get_status(self.repo_path)
            if status.behind > 0:
                pull(self.repo_path)

    def _classification_file_candidates(self) -> list[str]:
        # Use both standard schema files and any custom markdown files created by the user.
        candidates = set(DEFAULT_MARKDOWN_FILES.keys())
        if self.repo_path.exists():
            for file_path in self._markdown_files(self.repo_path):
                relative = str(file_path.relative_to(self.repo_path))
                candidates.add(relative)
        return sorted(candidates)

    def _safe_target_path(self, rel_path: str) -> Path | None:
        candidate = (self.repo_path / rel_path).resolve()
        repo_root = self.repo_path.resolve()
        if not str(candidate).startswith(str(repo_root)):
            return None
        return candidate

    def _parse_entries(self, target: Path) -> list[ParsedEntry]:
        if not target.exists():
            return []
        lines = target.read_text(encoding="utf-8").splitlines()
        entries: list[ParsedEntry] = []
        for index, line in enumerate(lines):
            stripped = line.strip()
            if stripped.startswith("- "):
                entries.append(ParsedEntry(line_index=index, text=stripped[2:].strip()))
        return entries

    def _check_duplicate(
        self,
        content: str,
        target_file: str,
        parsed_entries: list[ParsedEntry],
    ) -> DuplicateDecision | SaveResult:
        if self.save_intelligence is None or not parsed_entries:
            return DuplicateDecision(is_duplicate=False, confidence=0.0)

        existing_values = [entry.text for entry in parsed_entries]
        try:
            return self.save_intelligence.detect_duplicate(
                content=content,
                existing_entries=existing_values,
                target_file=target_file,
            )
        except SaveIntelligenceError as exc:
            return SaveResult(success=False, message=str(exc))

    def _update_entry(self, target: Path, existing_text: str | None, replacement: str) -> bool:
        if existing_text is None:
            return False

        lines = target.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            stripped = line.strip()
            if stripped.startswith("- ") and stripped[2:].strip() == existing_text:
                lines[index] = replacement
                new_content = "\n".join(lines)
                target.write_text(f"{new_content}\n", encoding="utf-8")
                return True
        return False

    def _append_entry(self, target: Path, entry: str) -> None:
        current = target.read_text(encoding="utf-8") if target.exists() else ""
        if current and not current.endswith("\n"):
            current = f"{current}\n"
        target.write_text(f"{current}{entry}\n", encoding="utf-8")

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


_SYNONYM_MAP: dict[str, set[str]] = {
    "work": {"career", "job", "profession", "role"},
    "career": {"work", "job", "profession", "role"},
    "job": {"work", "career", "profession", "role"},
    "favorite": {"prefer", "like", "love"},
    "prefer": {"favorite", "like", "love"},
    "style": {"voice", "tone", "writing"},
    "writing": {"style", "voice", "tone"},
    "voice": {"style", "tone", "writing"},
    "color": {"colour"},
    "colour": {"color"},
    "hobby": {"hobbies", "interest", "interests"},
    "hobbies": {"hobby", "interest", "interests"},
}

_STOPWORDS: set[str] = {
    "a",
    "about",
    "am",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "did",
    "do",
    "for",
    "from",
    "how",
    "i",
    "in",
    "is",
    "it",
    "me",
    "my",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "what",
    "where",
    "who",
    "you",
}

_TOKEN_RE = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9'_-]*")


def _tokenize(text: str) -> set[str]:
    return {match.group(0).lower() for match in _TOKEN_RE.finditer(text)}


def _expand_terms(terms: set[str]) -> set[str]:
    expanded = set(terms)
    for term in terms:
        expanded.update(_SYNONYM_MAP.get(term, set()))
    return expanded


def _meaningful_terms(terms: set[str]) -> set[str]:
    return {term for term in terms if term not in _STOPWORDS}


def _coverage(query_terms: set[str], target_terms: set[str]) -> float:
    if not query_terms:
        return 0.0
    return len(query_terms & target_terms) / len(query_terms)


def _density(query_terms: set[str], target_terms: set[str]) -> float:
    if not target_terms:
        return 0.0
    return len(query_terms & target_terms) / len(target_terms)


def _latest_content_line_index(lines: list[str]) -> int | None:
    for index in range(len(lines) - 1, -1, -1):
        stripped = lines[index].strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            continue
        return index
    return None


def _excerpt_around(lines: list[str], center: int, radius: int = 1) -> str:
    start = max(0, center - radius)
    end = min(len(lines), center + radius + 1)
    parts = [lines[i].strip() for i in range(start, end) if lines[i].strip()]
    excerpt = " ".join(parts)
    excerpt = re.sub(r"\s+", " ", excerpt).strip()
    if len(excerpt) <= 280:
        return excerpt
    return f"{excerpt[:277].rstrip()}..."
