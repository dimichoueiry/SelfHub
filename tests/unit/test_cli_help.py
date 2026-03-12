from selfhub_cli.main import app
from typer.testing import CliRunner


def test_cli_help_contains_commands() -> None:
    runner = CliRunner()
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "init" in result.stdout
    assert "save" in result.stdout
    assert "delete" in result.stdout
    assert "tools" in result.stdout
    assert "search" in result.stdout
    assert "setup" in result.stdout
    assert "console" in result.stdout
