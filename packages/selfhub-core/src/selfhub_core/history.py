"""Read-side git helpers for browsing a space: who changed what, when, and how.

Everything here reads, except `stage_paths` and `remove_path`, which stage exactly the
paths they are given. Nothing here runs `git add -A`, so a person's other uncommitted
work in the same clone is never swept into a commit.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

from selfhub_core.git_ops import GitCommandError, has_remote, run_git

_SEP = "\x1f"
_REC = "\x1e"


@dataclass(slots=True)
class CommitInfo:
    sha: str
    author_name: str
    author_email: str
    date: str
    message: str
    additions: int = 0
    deletions: int = 0
    paths: list[str] = field(default_factory=list)
    created: list[str] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    renamed: dict[str, str] = field(default_factory=dict)  # new path -> old path

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def blob_sha(data: bytes) -> str:
    """The git blob id of this content, same as `git hash-object`."""
    header = f"blob {len(data)}\0".encode()
    return hashlib.sha1(header + data, usedforsecurity=False).hexdigest()


def file_blob_sha(path: Path) -> str:
    return blob_sha(path.read_bytes())


def commits(
    repo_path: Path,
    file_path: str | None = None,
    limit: int = 50,
    rev: str = "HEAD",
) -> list[CommitInfo]:
    """Newest first, with author, line counts and the paths each commit touched."""
    if not _has_commits(repo_path):
        return []
    command = [
        "log",
        rev,
        f"-n{max(1, limit)}",
        "--date=iso-strict",
        f"--pretty=format:{_REC}%H{_SEP}%an{_SEP}%ae{_SEP}%ad{_SEP}%s",
        "--numstat",
        "--summary",
        "-M",
    ]
    if file_path:
        command.extend(["--", file_path])
    return _parse_log(run_git(command, cwd=repo_path).stdout)


def _parse_log(output: str) -> list[CommitInfo]:
    found: list[CommitInfo] = []
    for record in output.split(_REC):
        if not record.strip():
            continue
        header, _, body = record.partition("\n")
        parts = header.split(_SEP)
        if len(parts) != 5:
            continue
        info = CommitInfo(
            sha=parts[0],
            author_name=parts[1],
            author_email=parts[2],
            date=parts[3],
            message=parts[4],
        )
        for line in body.splitlines():
            if line.startswith((" create mode ", " delete mode ")):
                path = line.split(" ", 4)[4]
                (info.created if line.startswith(" create") else info.deleted).append(path)
                continue
            cols = line.split("\t", 2)
            if len(cols) != 3:
                continue
            added, removed, path = cols
            info.additions += int(added) if added.isdigit() else 0
            info.deletions += int(removed) if removed.isdigit() else 0
            old, new = _rename_parts(path)
            if old is not None:
                info.renamed[new] = old
            info.paths.append(new)
        found.append(info)
    return found


_BRACE_RENAME = re.compile(r"^(.*)\{(.*) => (.*)\}(.*)$")


def _rename_parts(path: str) -> tuple[str | None, str]:
    """`dir/{a.md => b.md}` or `a.md => b.md` from `--numstat -M` → (old, new)."""
    match = _BRACE_RENAME.match(path)
    if match:
        pre, old, new, post = match.groups()
        return (f"{pre}{old}{post}".replace("//", "/"), f"{pre}{new}{post}".replace("//", "/"))
    if " => " in path:
        old, new = path.split(" => ", 1)
        return old, new
    return None, path


@dataclass(slots=True)
class FileChange:
    path: str
    status: str  # "added" | "modified" | "deleted"


@dataclass(slots=True)
class RepoStatus:
    """What a space list needs to know about one clone, from as few git calls as possible."""

    branch: str
    head: CommitInfo | None
    remote_url: str | None
    has_upstream: bool
    ahead: int
    behind: int
    dirty: bool
    commit_count: int | None = None  # only counted when there is no upstream
    changes: list[FileChange] = field(default_factory=list)
    # Only filled when behind: the commits upstream has that HEAD doesn't, newest first.
    incoming: list[CommitInfo] = field(default_factory=list)
    # Only filled when behind and ahead: paths changed by local commits not pushed yet.
    outgoing_paths: list[str] = field(default_factory=list)


def repo_status(repo_path: Path, remote: str = "origin") -> RepoStatus | None:
    """Branch, upstream ahead/behind, uncommitted changes, remote and newest commit, or
    None when the path is not a git repo. Reads only; `--no-optional-locks` keeps
    `git status` from taking the index lock while a write may be running."""
    if not repo_path.exists():
        return None
    try:
        out = run_git(
            ["--no-optional-locks", "status", "--porcelain=v2", "--branch", "-z",
             "--untracked-files=all"],
            cwd=repo_path,
        ).stdout
    except GitCommandError:
        return None
    branch, has_commits, upstream, ahead, behind = "", True, False, 0, 0
    changes = _parse_status(out)
    for record in out.split("\0"):
        if record.startswith("# branch.head "):
            branch = record.split(" ", 2)[2]
        elif record.startswith("# branch.oid "):
            has_commits = record.split(" ", 2)[2] != "(initial)"
        elif record.startswith("# branch.ab "):
            upstream = True
            parts = record.split()
            ahead, behind = abs(int(parts[2])), abs(int(parts[3]))
    try:
        url = run_git(["remote", "get-url", remote], cwd=repo_path).stdout or None
    except GitCommandError:
        url = None
    head = None
    count: int | None = None
    if has_commits:
        found = _parse_log(run_git(["log", "-n1", *_LOG_FORMAT], cwd=repo_path).stdout)
        head = found[0] if found else None
        if url and not upstream:
            count = int(run_git(["rev-list", "--count", "HEAD"], cwd=repo_path).stdout or "0")
    elif url and not upstream:
        count = 0
    incoming: list[CommitInfo] = []
    outgoing: list[str] = []
    if upstream and behind:
        incoming = _parse_log(run_git(["log", "HEAD..@{u}", *_LOG_FORMAT],
                                      cwd=repo_path).stdout)
        if ahead:
            output = run_git(["log", "@{u}..HEAD", "--name-only", "--format="],
                             cwd=repo_path).stdout
            outgoing = list(dict.fromkeys(p for p in output.splitlines() if p.strip()))
    return RepoStatus(
        branch="main" if branch in {"", "(detached)"} else branch,
        head=head,
        remote_url=url,
        has_upstream=upstream,
        ahead=ahead,
        behind=behind,
        dirty=bool(changes),
        commit_count=count,
        changes=changes,
        incoming=incoming,
        outgoing_paths=outgoing,
    )


_LOG_FORMAT = ["--date=iso-strict",
               f"--pretty=format:{_REC}%H{_SEP}%an{_SEP}%ae{_SEP}%ad{_SEP}%s", "--numstat",
               "--summary", "-M"]


def _parse_status(out: str) -> list[FileChange]:
    """Changed paths from `git status --porcelain=v2 -z`, staged or not, untracked too."""
    records = out.split("\0")
    found: dict[str, str] = {}
    i = 0
    while i < len(records):
        record = records[i]
        i += 1
        if not record or record.startswith("#"):
            continue
        kind = record[0]
        if kind == "?":
            found[record[2:]] = "added"
        elif kind == "1":
            fields = record.split(" ", 8)
            xy = fields[1]
            status = "deleted" if "D" in xy else "added" if "A" in xy else "modified"
            found[fields[8]] = status
        elif kind == "2":  # rename or copy: the original path is the next record
            fields = record.split(" ", 9)
            found[fields[9]] = "added"
            if i < len(records) and records[i]:
                found[records[i]] = "deleted"
            i += 1
        elif kind == "u":
            found[record.split(" ", 10)[10]] = "modified"
    return [FileChange(path, status) for path, status in found.items()]


def last_commit(repo_path: Path, file_path: str | None = None) -> CommitInfo | None:
    found = commits(repo_path, file_path=file_path, limit=1)
    return found[0] if found else None


def last_commit_by_path(repo_path: Path) -> dict[str, CommitInfo]:
    """The newest commit for every path that has one, from a single `git log` pass."""
    latest: dict[str, CommitInfo] = {}
    for info in commits(repo_path, limit=100000):
        for path in info.paths:
            latest.setdefault(path, info)
    return latest


def show_patch(repo_path: Path, sha: str, file_path: str | None = None) -> str:
    command = ["show", "--format=", "--patch", sha]
    if file_path:
        command.extend(["--", file_path])
    return run_git(command, cwd=repo_path).stdout


def is_tracked(repo_path: Path, rel_path: str) -> bool:
    try:
        run_git(["ls-files", "--error-unmatch", "--", rel_path], cwd=repo_path)
    except GitCommandError:
        return False
    return True


def stage_paths(repo_path: Path, rel_paths: list[str]) -> None:
    """Stage only these paths (new, changed or deleted)."""
    if rel_paths:
        run_git(["add", "-A", "--", *rel_paths], cwd=repo_path)


def remove_path(repo_path: Path, rel_path: str) -> None:
    """Delete a tracked file and stage that deletion, nothing else."""
    run_git(["rm", "-q", "--", rel_path], cwd=repo_path)


def move_path(repo_path: Path, old: str, new: str) -> None:
    """Rename a tracked file and stage just that rename."""
    run_git(["mv", "--", old, new], cwd=repo_path)


def is_dirty(repo_path: Path) -> bool:
    return bool(run_git(["status", "--porcelain"], cwd=repo_path).stdout)


def fetch(repo_path: Path, remote: str = "origin") -> None:
    run_git(["fetch", "--quiet", remote], cwd=repo_path)


def commit_count(repo_path: Path) -> int:
    if not _has_commits(repo_path):
        return 0
    return int(run_git(["rev-list", "--count", "HEAD"], cwd=repo_path).stdout or "0")


def remote_url(repo_path: Path, remote: str = "origin") -> str | None:
    if not has_remote(repo_path, remote):
        return None
    return run_git(["remote", "get-url", remote], cwd=repo_path).stdout or None


def branches_containing(repo_path: Path, sha: str) -> list[str]:
    output = run_git(
        ["branch", "--contains", sha, "--format=%(refname:short)"], cwd=repo_path
    ).stdout
    return [line.strip() for line in output.splitlines() if line.strip()]


def _has_commits(repo_path: Path) -> bool:
    try:
        run_git(["rev-parse", "--verify", "--quiet", "HEAD"], cwd=repo_path)
    except GitCommandError:
        return False
    return True
