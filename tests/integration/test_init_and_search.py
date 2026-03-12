from pathlib import Path

from selfhub_cli.service import SelfHubService


def test_init_creates_standard_files(tmp_path: Path) -> None:
    repo_path = tmp_path / "selfhub"
    service = SelfHubService(repo_path)

    result = service.init_repo()

    assert result.success is True
    assert (repo_path / "meta/profile.md").exists()
    assert (repo_path / "voice/writing-style.md").exists()


def test_search_finds_saved_content(tmp_path: Path) -> None:
    repo_path = tmp_path / "selfhub"
    service = SelfHubService(repo_path)
    service.init_repo()

    service.save("I prefer deep work at night", file_path="preferences/lifestyle.md")
    results = service.search("deep work", mode="hybrid")

    assert len(results) == 1
    assert results[0].path == "/preferences/lifestyle.md"
