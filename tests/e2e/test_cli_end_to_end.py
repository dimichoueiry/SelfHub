from pathlib import Path

from selfhub_cli.main import app
from typer.testing import CliRunner


def test_e2e_init_then_read(tmp_path: Path) -> None:
    runner = CliRunner()
    repo_path = tmp_path / "selfhub"

    init = runner.invoke(app, ["init", "--repo-path", str(repo_path)])
    assert init.exit_code == 0

    read = runner.invoke(
        app,
        ["read", "meta/profile.md", "--repo-path", str(repo_path), "--json"],
    )
    assert read.exit_code == 0
    assert "Profile" in read.stdout

    status = runner.invoke(app, ["status", "--repo-path", str(repo_path), "--json"])
    assert status.exit_code == 0
    assert "\"branch\": \"main\"" in status.stdout


def test_e2e_delete_entry(tmp_path: Path) -> None:
    runner = CliRunner()
    repo_path = tmp_path / "selfhub"

    init = runner.invoke(app, ["init", "--repo-path", str(repo_path)])
    assert init.exit_code == 0

    saved = runner.invoke(
        app,
        [
            "save",
            "Temporary wrong entry",
            "--file",
            "experiences/career.md",
            "--repo-path",
            str(repo_path),
        ],
    )
    assert saved.exit_code == 0

    deleted = runner.invoke(
        app,
        [
            "delete",
            "--file",
            "experiences/career.md",
            "--index",
            "1",
            "--repo-path",
            str(repo_path),
            "--json",
        ],
    )
    assert deleted.exit_code == 0
    assert "\"success\": true" in deleted.stdout.lower()

    read = runner.invoke(
        app,
        ["read", "experiences/career.md", "--repo-path", str(repo_path), "--json"],
    )
    assert read.exit_code == 0
    assert "Temporary wrong entry" not in read.stdout
