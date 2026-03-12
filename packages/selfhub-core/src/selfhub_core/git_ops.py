from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from selfhub_core.contracts import GitLogEntry, GitStatus


class GitCommandError(RuntimeError):
    def __init__(self, message: str, stderr: str | None = None) -> None:
        super().__init__(message)
        self.stderr = stderr


@dataclass(slots=True)
class GitCommandResult:
    stdout: str
    stderr: str


def run_git(args: list[str], cwd: Path) -> GitCommandResult:
    process = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        check=False,
        capture_output=True,
        text=True,
    )
    if process.returncode != 0:
        stderr = process.stderr.strip()
        stdout = process.stdout.strip()
        details = stderr or stdout or "unknown git error"
        raise GitCommandError(f"git {' '.join(args)} failed: {details}", stderr=stderr)
    return GitCommandResult(stdout=process.stdout.strip(), stderr=process.stderr.strip())


def is_git_repo(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        run_git(["rev-parse", "--is-inside-work-tree"], cwd=path)
    except GitCommandError:
        return False
    return True


def clone_repo(remote_url: str, repo_path: Path) -> None:
    if repo_path.exists() and any(repo_path.iterdir()):
        raise GitCommandError(
            f"Cannot clone into non-empty directory: {repo_path}",
        )
    parent = repo_path.parent
    parent.mkdir(parents=True, exist_ok=True)
    run_git(["clone", remote_url, str(repo_path)], cwd=parent)


def init_repo(repo_path: Path) -> None:
    repo_path.mkdir(parents=True, exist_ok=True)
    run_git(["init", "-b", "main"], cwd=repo_path)


def has_remote(repo_path: Path, name: str = "origin") -> bool:
    try:
        run_git(["remote", "get-url", name], cwd=repo_path)
    except GitCommandError:
        return False
    return True


def add_remote(repo_path: Path, remote_url: str, name: str = "origin") -> None:
    run_git(["remote", "add", name, remote_url], cwd=repo_path)


def current_branch(repo_path: Path) -> str:
    return run_git(["branch", "--show-current"], cwd=repo_path).stdout or "main"


def current_head(repo_path: Path) -> str | None:
    try:
        output = run_git(["rev-parse", "HEAD"], cwd=repo_path).stdout
    except GitCommandError:
        return None
    return output or None


def stage_all(repo_path: Path) -> None:
    run_git(["add", "-A"], cwd=repo_path)


def has_staged_changes(repo_path: Path) -> bool:
    process = subprocess.run(
        ["git", "diff", "--cached", "--quiet"],
        cwd=str(repo_path),
        check=False,
        capture_output=True,
        text=True,
    )
    return process.returncode == 1


def commit(repo_path: Path, message: str) -> str:
    run_git(
        [
            "-c",
            "user.name=SelfHub",
            "-c",
            "user.email=noreply@selfhub.local",
            "commit",
            "-m",
            message,
        ],
        cwd=repo_path,
    )
    head = current_head(repo_path)
    if head is None:
        raise GitCommandError("Unable to resolve commit SHA after commit")
    return head


def push(repo_path: Path, remote: str = "origin", set_upstream: bool = False) -> None:
    branch = current_branch(repo_path)
    command = ["push"]
    if set_upstream:
        command.extend(["-u", remote, branch])
    else:
        command.extend([remote, branch])
    run_git(command, cwd=repo_path)


def pull(repo_path: Path) -> str:
    return run_git(["pull", "--rebase", "--autostash"], cwd=repo_path).stdout


def has_upstream(repo_path: Path) -> bool:
    process = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        cwd=str(repo_path),
        check=False,
        capture_output=True,
        text=True,
    )
    return process.returncode == 0


def ahead_behind(repo_path: Path) -> tuple[int, int]:
    if not has_upstream(repo_path):
        return (0, 0)

    output = run_git(["rev-list", "--left-right", "--count", "HEAD...@{u}"], cwd=repo_path).stdout
    parts = output.split()
    if len(parts) != 2:
        return (0, 0)

    ahead = int(parts[0])
    behind = int(parts[1])
    return (ahead, behind)


def last_sync_at(repo_path: Path) -> str | None:
    if not has_upstream(repo_path):
        return None
    try:
        output = run_git(
            ["log", "-1", "--date=iso-strict", "--pretty=%ad", "@{u}"],
            cwd=repo_path,
        )
        return output.stdout
    except GitCommandError:
        return None


def get_status(repo_path: Path) -> GitStatus:
    output = run_git(["status", "--porcelain"], cwd=repo_path).stdout
    modified: list[str] = []
    staged: list[str] = []
    untracked: list[str] = []

    if output:
        for line in output.splitlines():
            if len(line) < 4:
                continue
            x, y = line[0], line[1]
            path = line[3:]
            if x == "?":
                untracked.append(path)
                continue
            if x != " ":
                staged.append(path)
            if y != " ":
                modified.append(path)

    ahead, behind = ahead_behind(repo_path)
    return GitStatus(
        branch=current_branch(repo_path),
        modified=sorted(set(modified)),
        staged=sorted(set(staged)),
        untracked=sorted(set(untracked)),
        ahead=ahead,
        behind=behind,
        has_upstream=has_upstream(repo_path),
        last_sync_at=last_sync_at(repo_path),
    )


def get_log(repo_path: Path, limit: int = 20, file_path: str | None = None) -> list[GitLogEntry]:
    command = ["log", f"-n{limit}", "--date=iso-strict", "--pretty=%H%x09%ad%x09%s"]
    if file_path:
        command.extend(["--", file_path])

    output = run_git(command, cwd=repo_path).stdout
    if not output:
        return []

    entries: list[GitLogEntry] = []
    for line in output.splitlines():
        parts = line.split("\t", maxsplit=2)
        if len(parts) != 3:
            continue
        entries.append(
            GitLogEntry(
                commit_sha=parts[0],
                committed_at=parts[1],
                subject=parts[2],
            )
        )
    return entries
