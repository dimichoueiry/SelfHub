"""Whole-file operations on one space: list, write, create, delete, search.

These sit next to `save` and `delete` (which append and remove entries) for callers that
edit a file as a whole, like the dashboard. Every write follows the same path:

1. `write_refusal` decides whether the path may be written at all (locks, read-only).
2. `prepare_write` catches up with the remote.
3. The file is written and only that path is staged (never `git add -A`).
4. `publish` commits directly or proposes a pull-request branch, per the write policy.

Who may write (GitHub roles) is the caller's job; this module only knows the space.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from selfhub_core.contracts import SearchResult
from selfhub_core.git_ops import GitCommandError, current_branch, has_staged_changes
from selfhub_core.history import (
    branches_containing,
    file_blob_sha,
    is_tracked,
    last_commit_by_path,
    move_path,
    remove_path,
    stage_paths,
)
from selfhub_core.spaces import normalize_rel_path

from selfhub_cli.service import SelfHubService

_PR_URL = re.compile(r"(https?://\S+/pull/\d+)")


class SpaceFileError(RuntimeError):
    """A file operation that did not happen. `code` is stable; `message` is for people."""

    def __init__(self, code: str, message: str, hint: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.hint = hint


@dataclass(slots=True)
class TreeEntry:
    path: str
    name: str
    type: str  # "file" | "dir"
    size: int | None = None
    updated_at: str | None = None
    updated_by_name: str | None = None
    updated_by_email: str | None = None


@dataclass(slots=True)
class WriteOutcome:
    outcome: str  # "committed" | "pull-request"
    sha: str | None
    branch: str | None
    pr_url: str | None
    note: str | None


_BAD_NAME_CHARS = set('?*:<>|"\\')


def safe_rel_path(rel_path: str) -> str:
    cleaned = normalize_rel_path(rel_path or "")
    parts = [p for p in cleaned.split("/") if p]
    if not parts or any(p in {"..", "."} for p in parts) or parts[0] == ".git":
        raise SpaceFileError("invalid-path", f"'{rel_path}' is not a valid path in a space.")
    for part in parts:
        if any(ch in _BAD_NAME_CHARS or ord(ch) < 32 for ch in part) or part[-1] in " .":
            raise SpaceFileError(
                "invalid-path",
                f"'{part}' can't be used as a name.",
                'Names can\'t contain ? * : < > | " or \\, and can\'t end with a space or a '
                "dot. Letters, numbers, spaces, dashes and underscores are fine.",
            )
    return "/".join(parts)


def tree(repo_path: Path) -> list[TreeEntry]:
    """Every file and folder in the space except `.git`, folders first at each level."""
    latest = last_commit_by_path(repo_path) if (repo_path / ".git").exists() else {}
    entries: list[TreeEntry] = []
    for path in sorted(repo_path.rglob("*")):
        rel = path.relative_to(repo_path)
        if rel.parts[0] == ".git":
            continue
        rel_posix = rel.as_posix()
        if path.is_dir():
            entries.append(TreeEntry(path=rel_posix, name=path.name, type="dir"))
            continue
        info = latest.get(rel_posix)
        entries.append(
            TreeEntry(
                path=rel_posix,
                name=path.name,
                type="file",
                size=path.stat().st_size,
                updated_at=info.date if info else None,
                updated_by_name=info.author_name if info else None,
                updated_by_email=info.author_email if info else None,
            )
        )
    _fill_dir_dates(entries)
    return sorted(entries, key=_tree_key)


def write_file(
    service: SelfHubService,
    rel_path: str,
    content: str,
    message: str,
    base_sha: str | None = None,
    create: bool = False,
) -> WriteOutcome:
    """Replace (or create) one whole file and publish it per the space's write policy."""
    rel = safe_rel_path(rel_path)
    _refuse(service, rel)
    service.prepare_write()
    target = service.repo_path / rel
    if create and target.exists():
        raise SpaceFileError(
            "exists", f"{rel} already exists.", "Open it and edit it instead, or pick a new name."
        )
    if not create:
        if not target.is_file():
            raise SpaceFileError("not-found", f"{rel} does not exist.")
        current = file_blob_sha(target)
        if base_sha is not None and base_sha != current:
            raise SpaceFileError(
                "conflict",
                f"{rel} changed since you opened it.",
                "Reload to see the newer version, then make your edit again.",
            )
        if target.read_text(encoding="utf-8") == content:
            raise SpaceFileError("no-change", f"{rel} is unchanged; nothing to save.")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    verb = "Create" if create else "Edit"
    return _publish(service, [rel], message.strip() or f"{verb} {rel}")


def delete_file(service: SelfHubService, rel_path: str, message: str) -> WriteOutcome:
    rel = safe_rel_path(rel_path)
    _refuse(service, rel)
    service.prepare_write()
    target = service.repo_path / rel
    if not target.is_file():
        raise SpaceFileError("not-found", f"{rel} does not exist.")
    if not is_tracked(service.repo_path, rel):
        target.unlink()
        return WriteOutcome("committed", None, None, None, "The file was never committed.")
    remove_path(service.repo_path, rel)
    return _publish(service, [], message.strip() or f"Delete {rel}")


def move_file(service: SelfHubService, from_path: str, to_path: str,
              message: str) -> WriteOutcome:
    """Rename or move one file as a single change, published per the write policy."""
    old, new = safe_rel_path(from_path), safe_rel_path(to_path)
    if old == new:
        raise SpaceFileError("no-change", "The new name is the same as the old one.")
    _refuse(service, old)
    _refuse(service, new)
    service.prepare_write()
    repo = service.repo_path
    source, target = repo / old, repo / new
    if not source.is_file():
        raise SpaceFileError("not-found", f"{old} does not exist.")
    if target.exists():
        raise SpaceFileError(
            "exists", f"{new} already exists.", "Pick a different name or folder."
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    if is_tracked(repo, old):
        move_path(repo, old, new)
    else:
        source.rename(target)
    # `git mv` already staged the removal of the old path; stage only the new one.
    return _publish(service, [new], message.strip() or f"Rename {old} to {new}")


def search_spaces(
    services: list[tuple[str, SelfHubService]], query: str, limit: int = 20
) -> list[tuple[str, SearchResult]]:
    """Search every given space and merge the hits by score, best first."""
    hits: list[tuple[str, SearchResult]] = []
    for name, service in services:
        for hit in service.search(query, mode="hybrid", limit=limit):
            hits.append((name, hit))
    hits.sort(key=lambda item: item[1].score, reverse=True)
    return hits[:limit]


def _refuse(service: SelfHubService, rel: str) -> None:
    refusal = service.write_refusal(rel)
    if refusal is None:
        return
    read_only = service.manifest is not None and service.manifest.write_policy == "read-only"
    raise SpaceFileError("read-only" if read_only else "locked", refusal)


def _publish(service: SelfHubService, rel_paths: list[str], message: str) -> WriteOutcome:
    repo = service.repo_path
    try:
        stage_paths(repo, rel_paths)
        if not has_staged_changes(repo):
            raise SpaceFileError("no-change", "Nothing changed; nothing to save.")
        sha, note = service.publish(
            message, failed_push_note="Saved locally; the push failed. Sync now to retry."
        )
    except GitCommandError as exc:
        raise SpaceFileError("git", str(exc)) from exc
    is_pr = service.manifest is not None and service.manifest.write_policy == "pull-request"
    branch = current_branch(repo)
    if is_pr:
        proposed = [b for b in branches_containing(repo, sha) if b.startswith("selfhub/")]
        branch = proposed[0] if proposed else branch
    match = _PR_URL.search(note or "")
    return WriteOutcome(
        outcome="pull-request" if is_pr else "committed",
        sha=sha,
        branch=branch,
        pr_url=match.group(1) if match else None,
        note=note,
    )


def _fill_dir_dates(entries: list[TreeEntry]) -> None:
    """A folder's date and author are those of its most recently changed file."""
    dirs = {e.path: e for e in entries if e.type == "dir"}
    for entry in entries:
        if entry.type != "file" or not entry.updated_at:
            continue
        parent = entry.path.rsplit("/", 1)[0] if "/" in entry.path else ""
        while parent:
            folder = dirs.get(parent)
            if folder and (folder.updated_at or "") < entry.updated_at:
                folder.updated_at = entry.updated_at
                folder.updated_by_name = entry.updated_by_name
                folder.updated_by_email = entry.updated_by_email
            parent = parent.rsplit("/", 1)[0] if "/" in parent else ""


def _tree_key(entry: TreeEntry) -> tuple[str, ...]:
    # Depth-first order with folders before files at each level: README.md, locked/,
    # locked/compliance.md, sops/, ...
    parts = entry.path.split("/")
    key = [("0" if i < len(parts) - 1 or entry.type == "dir" else "1") + p.lower()
           for i, p in enumerate(parts)]
    return tuple(key)
