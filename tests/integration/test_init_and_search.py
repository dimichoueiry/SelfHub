import subprocess
from pathlib import Path

from selfhub_cli.service import SelfHubService


def _run_git(args: list[str], cwd: Path) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def test_init_creates_standard_files(tmp_path: Path) -> None:
    repo_path = tmp_path / "selfhub"
    service = SelfHubService(repo_path)

    result = service.init_repo()

    assert result.success is True
    assert (repo_path / "meta/profile.md").exists()
    assert (repo_path / "voice/writing-style.md").exists()
    log_result = service.log(limit=1)
    assert log_result.success is True
    assert "Initialize standard structure" in (log_result.message or "")


def test_search_finds_saved_content(tmp_path: Path) -> None:
    repo_path = tmp_path / "selfhub"
    service = SelfHubService(repo_path)
    service.init_repo()

    service.save("I prefer deep work at night", file_path="preferences/lifestyle.md")
    results = service.search("deep work", mode="hybrid")

    assert len(results) == 1
    assert results[0].path == "/preferences/lifestyle.md"


def test_status_and_sync_without_remote(tmp_path: Path) -> None:
    repo_path = tmp_path / "selfhub"
    service = SelfHubService(repo_path)
    service.init_repo()

    status = service.status()
    assert status.success is True
    assert status.data is not None
    assert status.data["branch"] == "main"
    assert status.data["ahead"] == 0
    assert status.data["behind"] == 0

    sync = service.sync()
    assert sync.success is True
    assert sync.message == "No remote configured. Local repository is up to date."


def test_init_with_remote_pushes_initial_commit(tmp_path: Path) -> None:
    remote_repo = tmp_path / "remote.git"
    local_repo = tmp_path / "selfhub"
    remote_repo.mkdir(parents=True, exist_ok=True)
    _run_git(["init", "--bare"], cwd=remote_repo)

    service = SelfHubService(local_repo)
    result = service.init_repo(remote_url=str(remote_repo))

    assert result.success is True
    commit_count = _run_git(["rev-list", "--count", "--all"], cwd=local_repo)
    assert int(commit_count) >= 1

    mirror_clone = tmp_path / "mirror"
    _run_git(["clone", str(remote_repo), str(mirror_clone)], cwd=tmp_path)
    remote_count = _run_git(["rev-list", "--count", "--all"], cwd=mirror_clone)
    assert int(remote_count) >= 1
