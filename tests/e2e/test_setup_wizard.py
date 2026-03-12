from __future__ import annotations

from pathlib import Path

from _pytest.monkeypatch import MonkeyPatch
from selfhub_cli.main import app
from selfhub_cli.settings import load_settings
from typer.testing import CliRunner


def test_setup_wizard_local_skip(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    runner = CliRunner()

    config_home = tmp_path / "config"
    repo_path = tmp_path / "selfhub"

    monkeypatch.setenv("SELFHUB_CONFIG_HOME", str(config_home))

    user_input = "\n".join(
        [
            str(repo_path),
            "1",
            "3",
            "y",
        ]
    )

    result = runner.invoke(app, ["setup", "--json"], input=f"{user_input}\n")

    assert result.exit_code == 0
    assert '"success": true' in result.stdout.lower()

    loaded = load_settings()
    assert loaded.repo_path == str(repo_path)
    assert loaded.llm_provider is None
    assert (repo_path / "meta/profile.md").exists()
