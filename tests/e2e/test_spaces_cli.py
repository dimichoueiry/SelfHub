import json
from pathlib import Path

import pytest
from selfhub_cli.main import app
from typer.testing import CliRunner


def test_e2e_space_context_and_learning(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SELFHUB_CONFIG_HOME", str(tmp_path / "cfg"))
    for var in ("SELFHUB_THINKING_PROVIDER", "SELFHUB_LLM_PROVIDER", "SELFHUB_EMBEDDING_PROVIDER"):
        monkeypatch.delenv(var, raising=False)
    runner = CliRunner()
    me = ["--repo-path", str(tmp_path / "me")]

    assert runner.invoke(app, ["init", *me]).exit_code == 0
    created = runner.invoke(
        app,
        ["space", "create", str(tmp_path / "apex"), "--name", "Apex Roofing", "--kind", "client",
         "--alias", "apex", *me],
    )
    assert created.exit_code == 0, created.stdout
    (tmp_path / "apex/brief.md").write_text("# Apex\n- Never mention price.\n")

    saved = runner.invoke(
        app, ["save", "Spring promo ran in March.", "--file", "work/promo.md", "--space", "apex",
              *me, "--json"],
    )
    assert json.loads(saved.stdout)["success"] is True
    assert (tmp_path / "apex/work/promo.md").exists()

    context = runner.invoke(app, ["context", "an ad for apex", *me, "--json"])
    payload = json.loads(context.stdout)
    assert payload["success"] is True
    assert "Never mention price." in payload["message"]

    learned = runner.invoke(
        app, ["learn", "No urgency phrasing.", "--space", "apex", "--why", "too pushy", *me,
              "--json"],
    )
    rule_id = json.loads(learned.stdout)["data"]["rule"]["id"]
    approved = runner.invoke(app, ["rules", "approve", rule_id, "--space", "apex", *me])
    assert approved.exit_code == 0
    listed = runner.invoke(app, ["rules", "list", "--space", "apex", *me])
    assert "No urgency phrasing." in listed.stdout

    unknown = runner.invoke(app, ["read", "--space", "nope", *me])
    assert unknown.exit_code == 1
    assert "No space named 'nope'" in unknown.stdout
