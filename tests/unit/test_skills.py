import json
from pathlib import Path

import pytest
from selfhub_cli.skills import (
    BEGIN,
    END,
    OVERRIDES_PATH,
    PackContext,
    SkillsError,
    load_overrides,
    render_agents_section,
    render_body,
    render_skill,
    skill_front_matter,
    space_context,
    upsert_block,
)
from selfhub_core.rules import Rule, append_rule
from selfhub_core.spaces import (
    RULES_LEARNED,
    SpaceManifest,
    default_manifest,
    scaffold_files,
    write_manifest,
)


def _space(root: Path, manifest: SpaceManifest) -> Path:
    write_manifest(root, manifest)
    for rel, text in scaffold_files(manifest).items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text)
    return root


def test_skill_and_agents_share_one_body() -> None:
    ctx = PackContext(kind="client", name="Apex Roofing", always_load=["brief.md"])
    skill, agents = render_skill(ctx), render_agents_section(ctx)
    # Same text, AGENTS.md one heading level down: they can't drift.
    assert render_body(ctx, level=1) in skill
    assert render_body(ctx, level=2) in agents
    demoted = render_body(ctx, level=1).replace("\n#", "\n##")
    assert ("#" + demoted) == render_body(ctx, level=2)
    for block in (skill, agents):
        assert block.startswith(BEGIN) and block.rstrip().endswith(END)


def test_front_matter_names_the_skill() -> None:
    head = skill_front_matter()
    assert head.startswith("---\nname: selfhub\ndescription: ")
    assert head.count("---") == 2


def test_client_space_uses_its_manifest_and_rules(tmp_path: Path) -> None:
    root = _space(tmp_path, default_manifest("Apex Roofing", "client", ["@agency"], ["apex"]))
    append_rule(root / RULES_LEARNED, Rule(id="R-20261012-3f9a", title="No urgency",
                                           rule="No urgency phrasing."), "# Learned\n")
    (root / "campaigns").mkdir()
    body = render_body(space_context(root))
    assert "# SelfHub space: Apex Roofing" in body
    assert "Kind: client" in body
    assert "`brief.md`, then `rules/learned.md`" in body
    assert "--space \"Apex Roofing\"" in body
    assert "work/YYYY-MM-DD-<short-name>.md" in body
    assert "(1 approved at install)" in body
    assert "- `campaigns/`: see its `README.md`" in body
    # The rule text itself is not copied: rules change, the pack is read from the file.
    assert "No urgency phrasing." not in body


def test_org_space_lists_locked_paths_and_forced_policies(tmp_path: Path) -> None:
    manifest = default_manifest("Northline", "org", ["@northline/admins"], [])
    manifest.locked.append("sops/brand.md")
    manifest.policies = ["draft-only", "ask-before-save"]
    body = render_body(space_context(_space(tmp_path, manifest)))
    assert "Writes: pull-request" in body
    assert "selfhub/<short-name>-<YYYYMMDD-HHMMSS>" in body
    assert "`.selfhub/space.json`, `.github/CODEOWNERS`, `locked/`, `sops/brand.md`" in body
    assert "every file under `locked/`" in body
    assert "Publish, send, post or schedule anything" in body
    assert "Before every `selfhub save` or `selfhub learn`" in body
    assert "Policy `draft-only`" in body


def test_read_only_space_allows_nothing(tmp_path: Path) -> None:
    manifest = SpaceManifest(name="Archive", kind="team", write_policy="read-only")
    body = render_body(space_context(_space(tmp_path, manifest)))
    assert "Nothing. This space is read-only." in body
    assert "Append new facts" not in body


def test_personal_space_has_no_manifest(tmp_path: Path) -> None:
    (tmp_path / "preferences").mkdir()
    body = render_body(space_context(tmp_path))
    assert "Kind: personal" in body
    assert "`preferences/`: `preferences/food.md`" in body
    assert "locked path" not in body


def test_global_pack_explains_every_kind() -> None:
    body = render_body(PackContext())
    assert "# Working in a SelfHub space" in body
    for word in ("`pull-request`", "`read-only`", "`brief.md`", "`sops/`", "nearest parent"):
        assert word in body


def test_overrides_tailor_the_pack(tmp_path: Path) -> None:
    root = _space(tmp_path, default_manifest("Apex Roofing", "client", [], []))
    (root / OVERRIDES_PATH).write_text(json.dumps({
        "company": "Apex Roofing Co.",
        "tone": "Plain and friendly. No jargon.",
        "folders": {"campaigns/": "one folder per campaign, named YYYY-MM-<name>"},
        "protect": ["contracts/"],
        "ask_first": ["Before mentioning prices."],
        "instructions": ["Write in US English."],
    }))
    body = render_body(space_context(root))
    assert "# SelfHub space: Apex Roofing Co." in body
    assert "Tone for anything you write here: Plain and friendly." in body
    assert "- `campaigns/`: one folder per campaign" in body
    assert "Write to `contracts/` (protected by the admin)." in body
    assert "- Before mentioning prices." in body
    assert "- Write in US English." in body


def test_overrides_file_can_live_outside_the_space(tmp_path: Path) -> None:
    root = _space(tmp_path / "apex", default_manifest("Apex", "client", [], []))
    outside = tmp_path / "agency" / "apex.json"
    outside.parent.mkdir()
    outside.write_text('{"tone": "Warm."}')
    assert "Warm." in render_body(space_context(root, outside))


@pytest.mark.parametrize("raw, error", [
    ('{"tone": "x", "colour": "red"}', "unknown setting colour"),
    ('{"folders": ["a"]}', "'folders' must map"),
    ('{"protect": [1]}', "'protect' must be a list"),
    ('{"tone": 3}', "'tone' must be text"),
    ("[]", "must hold a JSON object"),
    ("{nope", "not valid JSON"),
])
def test_bad_overrides_are_refused(tmp_path: Path, raw: str, error: str) -> None:
    path = tmp_path / "o.json"
    path.write_text(raw)
    with pytest.raises(SkillsError, match=error):
        load_overrides(path)


def test_upsert_block_replaces_only_the_managed_part() -> None:
    old = f"# Mine\n\nKeep this.\n\n{BEGIN}\nold\n{END}\n\nAnd this.\n"
    new = upsert_block(old, f"{BEGIN}\nnew\n{END}\n")
    assert new == f"# Mine\n\nKeep this.\n\n{BEGIN}\nnew\n{END}\n\nAnd this.\n"
    assert upsert_block("# Mine\n", "B\n") == "# Mine\n\nB\n"
    assert upsert_block("", "B\n") == "B\n"


@pytest.mark.parametrize("text", [
    f"{BEGIN}\nno end\n",
    f"{END}\n{BEGIN}\n",
    f"{BEGIN}\n{END}\n{BEGIN}\n{END}\n",
])
def test_upsert_block_refuses_damaged_markers(text: str) -> None:
    with pytest.raises(SkillsError, match="markers are damaged"):
        upsert_block(text, "B\n")
