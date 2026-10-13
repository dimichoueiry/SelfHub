"""The agency story: an org with locked compliance rules, two clients, one ads person."""

import json
import subprocess
from pathlib import Path

import pytest
from selfhub_cli.service import SelfHubService
from selfhub_cli.workspace import Workspace
from selfhub_core.spaces import Space


def _service(space: Space) -> SelfHubService:
    manifest = None if space.kind == "personal" else space.manifest
    return SelfHubService(space.path, save_intelligence=None, manifest=manifest)


def _commit_all(repo: Path, message: str) -> None:
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(
        ["git", "-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", message],
        cwd=repo,
        check=True,
    )


def _branch(repo: Path) -> str:
    out = subprocess.run(
        ["git", "branch", "--show-current"], cwd=repo, check=True, capture_output=True, text=True
    )
    return out.stdout.strip()


@pytest.fixture()
def agency(tmp_path: Path) -> tuple[Workspace, Path]:
    me = tmp_path / "me"
    assert SelfHubService(me, save_intelligence=None).init_repo().success
    sop = me / "sops" / "ads.md"
    sop.parent.mkdir(parents=True)
    sop.write_text("# Ads SOP\n- Hook, offer, proof, CTA. Always give 3 variants.\n")
    _commit_all(me, "sop")

    ws = Workspace(tmp_path / "cfg", me, service_factory=_service)
    org = ws.create_space(tmp_path / "northline", "Northline", "org", owners=["@nl/admins"])
    assert org.success, org.message
    (tmp_path / "northline/locked/compliance.md").write_text("# Compliance\n- No fake reviews.\n")
    _commit_all(tmp_path / "northline", "compliance")

    for folder, name, alias, brief in (
        ("apex", "Apex Roofing", "apex", "- Never mention price.\n"),
        ("bolt", "Bolt HVAC", "bolt", "- SECRET bolt strategy.\n"),
    ):
        made = ws.create_space(tmp_path / folder, name, "client", aliases=[alias])
        assert made.success, made.message
        (tmp_path / folder / "brief.md").write_text(f"# {name}\n{brief}")
        _commit_all(tmp_path / folder, "brief")
    return ws, tmp_path


def test_create_scaffolds_manifest_codeowners_and_registers(agency: tuple[Workspace, Path]) -> None:
    ws, root = agency
    manifest = json.loads((root / "northline/.selfhub/space.json").read_text())
    assert manifest["kind"] == "org"
    assert manifest["locked"] == ["locked/"]
    assert "/locked/ @nl/admins" in (root / "northline/.github/CODEOWNERS").read_text()
    spaces, problems = ws.spaces()
    assert [s.name for s in spaces] == ["Northline", "Apex Roofing", "Bolt HVAC", "me"]
    assert problems == []
    assert not ws.create_space(root / "other", "northline", "org").success  # name taken
    assert not ws.create_space(root / "mine", "me", "team").success  # reserved


def test_locked_paths_refuse_writes(agency: tuple[Workspace, Path]) -> None:
    ws, root = agency
    service = _service(ws.find("Northline"))
    result = service.save("drop the compliance rule", file_path="locked/compliance.md")
    assert not result.success
    assert "locked" in (result.message or "")
    assert "fake reviews" in (root / "northline/locked/compliance.md").read_text()
    deleted = service.delete("locked/compliance.md", index=1)
    assert not deleted.success


def test_context_loads_locked_rules_and_only_the_named_client(
    agency: tuple[Workspace, Path],
) -> None:
    ws, _ = agency
    result = ws.context("Make a Facebook ad for Apex, following my ads SOP")
    assert result.success
    text = result.message or ""
    assert "No fake reviews." in text
    assert "Never mention price." in text
    assert "SECRET" not in text
    assert "Not loaded: Bolt HVAC." in text
    assert "me:sops/ads.md" in text
    assert text.index("Locked rules") < text.index("Client space: Apex Roofing")
    assert "Northline:locked/README.md" not in text

    data = result.data or {}
    assert "Northline:locked/compliance.md" in data["sources"]
    assert "Apex Roofing:brief.md" in data["sources"]
    assert data["not_loaded_clients"] == ["Bolt HVAC"]
    assert not any("Bolt" in source for source in data["sources"])


def test_feedback_becomes_a_rule_only_after_approval(agency: tuple[Workspace, Path]) -> None:
    ws, root = agency
    learned = ws.learn(
        "Never use urgency phrasing like 'act now'.",
        "apex",
        why="Strategist: variant 2 felt pushy",
        source="work/spring-promo.md",
    )
    assert learned.success, learned.message
    rule_id = str((learned.data or {})["rule"]["id"])
    assert "urgency" not in (ws.context("ad for apex").message or "")

    pending = ws.list_rules("apex", pending=True)
    assert rule_id in (pending.message or "")

    approved = ws.approve(rule_id, "Apex Roofing")
    assert approved.success, approved.message
    text = ws.context("ad for apex").message or ""
    assert f"[{rule_id}] Never use urgency phrasing" in text
    assert "Strategist: variant 2 felt pushy" in text
    assert "urgency" not in (ws.context("ad for bolt").message or "")

    learned_file = (root / "apex/rules/learned.md").read_text()
    assert "- source: work/spring-promo.md" in learned_file
    assert "- approved by:" in learned_file
    assert rule_id not in (root / "apex/rules/proposed.md").read_text()
    assert not ws.approve(rule_id, "apex").success  # already settled


def test_reject_removes_the_proposal(agency: tuple[Workspace, Path]) -> None:
    ws, root = agency
    learned = ws.learn("Always use emojis.", "bolt")
    rule_id = str((learned.data or {})["rule"]["id"])
    assert ws.reject(rule_id, "bolt").success
    assert rule_id not in (root / "bolt/rules/proposed.md").read_text()
    assert rule_id not in (root / "bolt/rules/learned.md").read_text()


def test_pull_request_spaces_put_changes_on_a_review_branch(
    agency: tuple[Workspace, Path],
) -> None:
    ws, root = agency
    org = root / "northline"
    learned = ws.learn("Always include the license number.", "Northline")
    assert learned.success, learned.message
    assert "review" in (learned.message or "")
    assert _branch(org) == "main"
    assert "license number" not in (org / "rules/learned.md").read_text()
    branches = subprocess.run(
        ["git", "branch", "--list", "selfhub/*"], cwd=org, capture_output=True, text=True
    ).stdout
    assert "selfhub/learn-" in branches


def test_personal_learn_direct_policy_skips_approval(agency: tuple[Workspace, Path]) -> None:
    ws, root = agency
    assert ws.set_policy("learn-direct", on=True).success
    learned = ws.learn("Keep hooks under 8 words.", None)
    assert learned.success
    assert (learned.data or {})["applies_now"] is True
    assert "Keep hooks under 8 words." in (root / "me/rules/learned.md").read_text()


def test_policies_combine_personal_choice_and_org_enforcement(
    agency: tuple[Workspace, Path],
) -> None:
    ws, root = agency
    manifest_path = root / "northline/.selfhub/space.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["policies"] = ["draft-only"]
    manifest_path.write_text(json.dumps(manifest))
    assert ws.set_policy("cite-sources", on=True).success

    data = ws.context("ad for apex").data or {}
    policies = {p["name"]: p["from"] for p in data["policies"]}
    assert policies == {"draft-only": "enforced by Northline", "cite-sources": "your choice"}
    off = ws.set_policy("draft-only", on=False)
    assert "stays on" in (off.message or "")
    assert not ws.set_policy("make-it-pop", on=True).success


def test_read_only_spaces_refuse_writes(agency: tuple[Workspace, Path]) -> None:
    ws, root = agency
    manifest_path = root / "bolt/.selfhub/space.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["write_policy"] = "read-only"
    manifest_path.write_text(json.dumps(manifest))
    assert not _service(ws.find("bolt")).save("x", file_path="brief.md").success
    assert not ws.learn("x", "bolt").success


def test_missing_space_is_reported_not_fatal(agency: tuple[Workspace, Path]) -> None:
    ws, root = agency
    subprocess.run(["mv", str(root / "bolt"), str(root / "bolt-moved")], check=True)
    spaces, problems = ws.spaces()
    assert "Bolt HVAC" not in [s.name for s in spaces]
    assert any("Bolt HVAC" in p for p in problems)
    assert ws.context("ad for apex").success


def test_add_connects_an_existing_space_and_remove_disconnects(
    agency: tuple[Workspace, Path],
) -> None:
    ws, root = agency
    other = Workspace(root / "cfg2", root / "me", service_factory=_service)
    added = other.add_space(str(root / "apex"))
    assert added.success, added.message
    assert other.find("apex").name == "Apex Roofing"
    assert not other.add_space(str(root / "me")).success  # no manifest
    assert other.remove_space("Apex Roofing").success
    assert (root / "apex/brief.md").exists()
