import json
from pathlib import Path

import pytest
from selfhub_cli.main import app
from selfhub_cli.skills import (
    AGENTS_REL,
    BEGIN,
    END,
    GLOBAL_CODEX_REL,
    OVERRIDES_PATH,
    SKILL_REL,
    SkillsError,
    install_skills,
)
from selfhub_core.git_ops import init_repo, run_git
from selfhub_core.spaces import default_manifest, scaffold_files, write_manifest
from typer.testing import CliRunner

IDENTITY = ["-c", "user.name=Test", "-c", "user.email=test@example.com"]


@pytest.fixture(autouse=True)
def _fake_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Nothing in these tests may reach the real ~/.claude or ~/.codex."""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("SELFHUB_CONFIG_HOME", str(tmp_path / "cfg"))
    return home


def _space(root: Path, name: str = "Apex Roofing", git: bool = True) -> Path:
    manifest = default_manifest(name, "client", ["@agency"], [])
    root.mkdir(parents=True)
    if git:
        init_repo(root)
    write_manifest(root, manifest)
    for rel, text in scaffold_files(manifest).items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text)
    if git:
        run_git(["add", "."], cwd=root)
        run_git([*IDENTITY, "commit", "-qm", "Start"], cwd=root)
    return root


def _status(root: Path) -> str:
    return run_git(["status", "--porcelain"], cwd=root).stdout


def test_install_creates_both_files_and_is_idempotent(tmp_path: Path) -> None:
    root = _space(tmp_path / "apex")
    first = {a.path: a.action for a in install_skills(space=root)}
    assert first[root / SKILL_REL] == first[root / AGENTS_REL] == "create"
    skill = (root / SKILL_REL).read_text()
    agents = (root / AGENTS_REL).read_text()
    assert skill.startswith("---\nname: selfhub\n")
    assert "# SelfHub space: Apex Roofing" in skill
    assert agents.startswith(BEGIN) and "## SelfHub space: Apex Roofing" in agents

    second = install_skills(space=root)
    assert {a.action for a in second} == {"unchanged"}
    assert (root / SKILL_REL).read_text() == skill
    assert (root / AGENTS_REL).read_text() == agents


def test_install_keeps_user_content_outside_the_block(tmp_path: Path) -> None:
    root = _space(tmp_path / "apex")
    (root / AGENTS_REL).write_text("# Our agents\n\nAlways cite the brief.\n")
    install_skills(space=root)
    agents = (root / AGENTS_REL).read_text()
    assert agents.startswith("# Our agents\n\nAlways cite the brief.\n\n" + BEGIN)

    # The user edits around the block and inside it; the admin changes the tone.
    edited = agents.replace(BEGIN, "Above.\n\n" + BEGIN).replace("## Find things", "## Hacked")
    (root / AGENTS_REL).write_text(edited + "\nBelow.\n")
    skill_path = root / SKILL_REL
    skill_path.write_text(skill_path.read_text() + "\nMy own skill note.\n")
    (root / OVERRIDES_PATH).write_text('{"tone": "Short sentences."}')

    actions = {a.path: a.action for a in install_skills(space=root)}
    assert actions[root / AGENTS_REL] == "update"
    agents = (root / AGENTS_REL).read_text()
    assert "Always cite the brief." in agents and "Above." in agents
    assert agents.rstrip().endswith("Below.")
    assert "## Hacked" not in agents and "### Find things" in agents
    assert "Short sentences." in agents
    assert agents.count(BEGIN) == 1 and agents.count(END) == 1
    skill = skill_path.read_text()
    assert "My own skill note." in skill and "Short sentences." in skill


def test_dry_run_writes_nothing(tmp_path: Path) -> None:
    root = _space(tmp_path / "apex")
    before = _status(root)
    actions = {a.path: a.action for a in install_skills(space=root, dry_run=True)}
    assert actions[root / SKILL_REL] == actions[root / AGENTS_REL] == "create"
    assert not (root / SKILL_REL).exists() and not (root / AGENTS_REL).exists()
    assert _status(root) == before
    exclude = root / ".git/info/exclude"
    assert "selfhub-skill-pack" not in (exclude.read_text() if exclude.exists() else "")


def test_pack_stays_out_of_git_unless_shared(tmp_path: Path) -> None:
    root = _space(tmp_path / "apex")
    install_skills(space=root)
    install_skills(space=root)
    assert _status(root) == ""
    exclude = (root / ".git/info/exclude").read_text()
    assert exclude.count("# BEGIN selfhub-skill-pack") == 1
    assert "/.claude/skills/selfhub/" in exclude and "/AGENTS.md" in exclude

    shared = _space(tmp_path / "bolt", name="Bolt HVAC")
    install_skills(space=shared, share=True)
    assert "AGENTS.md" in _status(shared) and ".claude/" in _status(shared)


def test_tracked_agents_md_is_left_alone_unless_shared(tmp_path: Path) -> None:
    root = _space(tmp_path / "apex")
    (root / AGENTS_REL).write_text("# Team notes\n")
    run_git(["add", "AGENTS.md"], cwd=root)
    run_git([*IDENTITY, "commit", "-qm", "Add agent notes"], cwd=root)

    actions = {a.path: a for a in install_skills(space=root)}
    skipped = actions[root / AGENTS_REL]
    assert skipped.action == "skipped"
    assert skipped.note == (
        "Codex: this space already has its own AGENTS.md, so SelfHub didn't change it. "
        'To add SelfHub\'s guidance there, run: selfhub skills install --space "Apex Roofing" '
        "--share"
    )
    assert (root / AGENTS_REL).read_text() == "# Team notes\n"
    assert (root / SKILL_REL).exists()  # Claude still gets the skill
    assert "/AGENTS.md" not in (root / ".git/info/exclude").read_text()
    assert _status(root) == ""  # no unexplained unsaved change

    install_skills(space=root, share=True)
    assert (root / AGENTS_REL).read_text().startswith("# Team notes\n\n" + BEGIN)


def test_cli_prints_the_tracked_agents_md_line_with_the_space_name(tmp_path: Path) -> None:
    runner = CliRunner()
    me = ["--repo-path", str(tmp_path / "me")]
    assert runner.invoke(app, ["init", *me]).exit_code == 0
    root = tmp_path / "apex"
    created = runner.invoke(app, ["space", "create", str(root), "--name", "Apex Roofing",
                                  "--kind", "client", *me])
    assert created.exit_code == 0, created.stdout
    (root / AGENTS_REL).write_text("# Team notes\n")
    run_git(["add", "AGENTS.md"], cwd=root)
    run_git([*IDENTITY, "commit", "-qm", "Add agent notes"], cwd=root)

    result = runner.invoke(app, ["skills", "install", "--all", *me])
    assert result.exit_code == 0, result.stdout
    assert ("Codex: this space already has its own AGENTS.md, so SelfHub didn't change it. "
            "To add SelfHub's guidance there, run: "
            'selfhub skills install --space "Apex Roofing" --share') in result.stdout

    shared = runner.invoke(app, ["skills", "install", "--space", "Apex Roofing", "--share",
                                 *me])
    assert shared.exit_code == 0, shared.stdout
    assert BEGIN in (root / AGENTS_REL).read_text()


def test_install_works_without_git(tmp_path: Path) -> None:
    root = _space(tmp_path / "apex", git=False)
    install_skills(space=root)
    assert (root / SKILL_REL).exists() and not (root / ".git").exists()


def test_global_install_only_touches_the_given_home(tmp_path: Path) -> None:
    home = tmp_path / "fakehome"
    actions = install_skills(global_home=home)
    assert [a.path for a in actions] == [home / SKILL_REL, home / GLOBAL_CODEX_REL]
    assert "# Working in a SelfHub space" in (home / SKILL_REL).read_text()
    assert "## Working in a SelfHub space" in (home / GLOBAL_CODEX_REL).read_text()


def test_install_refuses_damaged_markers_and_bad_input(tmp_path: Path) -> None:
    root = _space(tmp_path / "apex")
    (root / AGENTS_REL).write_text(f"{BEGIN}\nhalf a block\n")
    with pytest.raises(SkillsError, match="markers are damaged"):
        install_skills(space=root)
    assert (root / AGENTS_REL).read_text() == f"{BEGIN}\nhalf a block\n"
    with pytest.raises(SkillsError, match="Nothing to install"):
        install_skills()
    with pytest.raises(SkillsError, match="not a folder"):
        install_skills(space=tmp_path / "missing")


def test_cli_install_dry_run_then_real(tmp_path: Path, _fake_home: Path) -> None:
    root = _space(tmp_path / "apex")
    runner = CliRunner()
    dry = runner.invoke(app, ["skills", "install", "--space", str(root), "--dry-run", "--json"])
    assert dry.exit_code == 0, dry.stdout
    payload = json.loads(dry.stdout)
    assert payload["data"]["dry_run"] is True
    assert not (root / SKILL_REL).exists()

    real = runner.invoke(app, ["skills", "install", "--space", str(root), "--global"])
    assert real.exit_code == 0, real.stdout
    assert "create" in real.stdout
    assert (root / SKILL_REL).exists()
    assert (_fake_home / SKILL_REL).exists() and (_fake_home / GLOBAL_CODEX_REL).exists()

    again = runner.invoke(app, ["skills", "install", "--space", str(root), "--json"])
    assert {a["action"] for a in json.loads(again.stdout)["data"]["actions"]} == {"unchanged"}


def test_cli_install_all_connected_spaces(tmp_path: Path) -> None:
    runner = CliRunner()
    me = ["--repo-path", str(tmp_path / "me")]
    assert runner.invoke(app, ["init", *me]).exit_code == 0
    created = runner.invoke(app, ["space", "create", str(tmp_path / "apex"), "--name", "Apex",
                                  "--kind", "client", *me])
    assert created.exit_code == 0, created.stdout
    result = runner.invoke(app, ["skills", "install", "--all", *me])
    assert result.exit_code == 0, result.stdout
    assert "# SelfHub space: Apex" in (tmp_path / "apex" / SKILL_REL).read_text()
    assert "Kind: personal" in (tmp_path / "me" / SKILL_REL).read_text()


def test_cli_needs_a_target_and_reports_bad_overrides(tmp_path: Path) -> None:
    runner = CliRunner()
    assert runner.invoke(app, ["skills", "install"]).exit_code == 1
    root = _space(tmp_path / "apex")
    (root / OVERRIDES_PATH).write_text('{"colour": "red"}')
    bad = runner.invoke(app, ["skills", "install", "--space", str(root)])
    assert bad.exit_code == 1 and "unknown setting colour" in bad.stdout


def test_cli_show_prints_the_skill(tmp_path: Path) -> None:
    root = _space(tmp_path / "apex")
    shown = CliRunner().invoke(app, ["skills", "show", "--space", str(root)])
    assert shown.exit_code == 0 and shown.stdout.startswith("---\nname: selfhub")
    codex = CliRunner().invoke(app, ["skills", "show", "--codex"])
    assert codex.stdout.startswith(BEGIN)
    assert not (root / SKILL_REL).exists()
