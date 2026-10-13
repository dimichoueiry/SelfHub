from pathlib import Path

import pytest
from selfhub_core.rules import Rule, parse_rules, render_rules
from selfhub_core.spaces import (
    Registry,
    Space,
    SpaceError,
    SpaceManifest,
    codeowners_text,
    default_manifest,
    is_locked,
    load_manifest,
    personal_manifest,
    resolve_scope,
    write_manifest,
)


def _space(name: str, kind: str, aliases: list[str] | None = None) -> Space:
    manifest = SpaceManifest(name=name, kind=kind, aliases=aliases or [])
    return Space(name=name, path=Path("/x") / name, manifest=manifest)


def test_locked_paths_match_folders_files_and_the_manifest() -> None:
    manifest = SpaceManifest(name="Org", kind="org", locked=["locked/", "sops/brand.md"])
    assert is_locked(manifest, "locked/compliance.md")
    assert is_locked(manifest, "/locked/deep/rule.md")
    assert is_locked(manifest, "sops/brand.md")
    assert not is_locked(manifest, "sops/brand-notes.md")
    assert not is_locked(manifest, "lockedish/file.md")
    assert is_locked(manifest, ".selfhub/space.json")
    assert is_locked(manifest, ".github/CODEOWNERS")
    assert not is_locked(personal_manifest(), "locked/anything.md")


def test_manifest_round_trip_and_validation(tmp_path: Path) -> None:
    manifest = default_manifest("Northline", "org", ["@northline/admins"], ["nl"])
    write_manifest(tmp_path, manifest)
    loaded = load_manifest(tmp_path)
    assert loaded is not None
    assert loaded.kind == "org"
    assert loaded.write_policy == "pull-request"
    assert loaded.locked == ["locked/"]

    (tmp_path / ".selfhub/space.json").write_text('{"name": "X", "kind": "galaxy"}')
    with pytest.raises(SpaceError):
        load_manifest(tmp_path)
    (tmp_path / ".selfhub/space.json").write_text(
        '{"name": "X", "kind": "org", "policies": ["not-a-policy"]}'
    )
    with pytest.raises(SpaceError):
        load_manifest(tmp_path)


def test_codeowners_routes_locked_paths_and_rules_to_owners() -> None:
    manifest = default_manifest("Northline", "org", ["@northline/admins"], [])
    text = codeowners_text(manifest)
    assert "/locked/ @northline/admins" in text
    assert "/.selfhub/space.json @northline/admins" in text
    assert "/rules/learned.md @northline/admins" in text


def test_scope_loads_only_the_named_client() -> None:
    spaces = [
        _space("me", "personal"),
        _space("Northline", "org"),
        _space("Ads", "team"),
        _space("Apex Roofing", "client", ["apex"]),
        _space("Bolt HVAC", "client", ["bolt"]),
    ]
    scope = resolve_scope(spaces, "Make a Facebook ad for Apex's spring promo")
    names = [s.name for s in scope.included]
    assert names == ["me", "Northline", "Ads", "Apex Roofing"]
    assert scope.other_clients == ["Bolt HVAC"]

    week = resolve_scope(spaces, "plan my week")
    assert [s.name for s in week.included if s.kind == "client"] == []
    # A word inside another word is not a mention.
    assert resolve_scope(spaces, "boltless design").other_clients == ["Apex Roofing", "Bolt HVAC"]
    explicit = resolve_scope(spaces, "an ad for apex", clients=["bolt"])
    assert [s.name for s in explicit.included if s.kind == "client"] == ["Bolt HVAC"]


def test_rules_file_round_trip_keeps_unknown_lines() -> None:
    text = (
        "# Learned rules\n\nIntro line.\n\n"
        "## R-20261012-3f9a: No urgency\n"
        "- rule: Never say act now.\n"
        "- why: client hates it\n"
        "- custom: kept as is\n"
    )
    preamble, rules = parse_rules(text)
    assert preamble == ["# Learned rules", "", "Intro line."]
    assert rules[0] == Rule(
        id="R-20261012-3f9a",
        title="No urgency",
        rule="Never say act now.",
        why="client hates it",
        extra=["- custom: kept as is"],
    )
    assert parse_rules(render_rules(preamble, rules)) == (preamble, rules)


def test_registry_defaults_are_empty() -> None:
    assert Registry().to_dict() == {"spaces": [], "policies": []}
