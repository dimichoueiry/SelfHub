import json

from selfhub_cli.main import app
from typer.testing import CliRunner


def test_tools_command_json_includes_cli_and_slash_tools() -> None:
    runner = CliRunner()
    result = runner.invoke(app, ["tools", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["success"] is True
    cli_tool_names = {item["name"] for item in payload["tools"]}
    slash_tool_names = {item["name"] for item in payload["slash_tools"]}

    assert "save" in cli_tool_names
    assert "search" in cli_tool_names
    assert "recall" in cli_tool_names
    assert "/tools" in slash_tool_names
    assert "/chat" in slash_tool_names
