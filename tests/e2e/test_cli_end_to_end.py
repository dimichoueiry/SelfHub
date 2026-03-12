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
