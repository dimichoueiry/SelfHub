"""The dashboard API against the seeded Northline demo (real local git repos).

Sam (ads) is the default user: write on Ads Team and Apex, read on Northline, no access
to Bolt. Other people act through the demo-only X-SelfHub-User header.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from selfhub_api.app import Settings, create_app
from selfhub_api.github import GhGitHubProvider, RepoRef

MAYA = {"X-SelfHub-User": "maya-chen"}
JORDAN = {"X-SelfHub-User": "jordan-reyes"}


@pytest.fixture()
def demo(tmp_path: Path) -> tuple[TestClient, Path]:
    config = tmp_path / "demo"
    app = create_app(Settings(demo=True, config_dir=config, public_url="http://testserver"))
    return TestClient(app), config


def _git(repo: Path, *args: str) -> str:
    done = subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True)
    return done.stdout.strip()


def _spaces(client: TestClient, headers: dict[str, str] | None = None) -> dict[str, Any]:
    return {s["id"]: s for s in client.get("/api/spaces", headers=headers).json()}


def test_me_and_spaces_show_roles_and_sync_states(demo: tuple[TestClient, Path]) -> None:
    client, _ = demo
    me = client.get("/api/me").json()
    assert me["login"] == "sam-okafor" and me["mode"] == "demo"
    assert me["org"]["name"] == "Northline"

    spaces = _spaces(client)
    assert set(spaces) == {"northline", "ads-team", "apex-roofing", "bolt-hvac", "me"}
    access = {sid: s["myAccess"] for sid, s in spaces.items()}
    assert access == {"northline": "read", "ads-team": "write", "apex-roofing": "write",
                      "bolt-hvac": "none", "me": "admin"}
    states = {sid: s["sync"]["state"] for sid, s in spaces.items()}
    assert states == {"northline": "synced", "ads-team": "behind",
                      "apex-roofing": "local-changes", "bolt-hvac": "ahead", "me": "no-remote"}
    assert spaces["ads-team"]["sync"]["behind"] == 2
    assert spaces["northline"]["writePolicy"] == "pull-request"
    assert spaces["northline"]["owners"] == ["maya-chen", "marcus-bell"]
    assert "locked/" in spaces["northline"]["lockedPaths"]
    assert spaces["me"]["name"] == "Sam's space"


def test_tree_lists_all_files_with_lock_and_edit_state(demo: tuple[TestClient, Path]) -> None:
    client, _ = demo
    tree = {e["path"]: e for e in client.get("/api/spaces/northline/tree").json()}
    assert not any(p == ".git" or p.startswith(".git/") for p in tree)
    compliance = tree["locked/compliance.md"]
    assert compliance["locked"] and not compliance["editable"]
    assert "Maya Chen" in compliance["reason"]
    assert compliance["updatedBy"] == "maya-chen"
    assert tree["locked"]["type"] == "dir" and tree["locked"]["locked"]
    # Sam only reads Northline, so even unlocked files are not editable for him.
    assert not tree["sops/reporting.md"]["editable"]

    ads = {e["path"]: e for e in client.get("/api/spaces/ads-team/tree").json()}
    assert ads["templates/campaign-naming.csv"]["editable"]  # non-markdown files are listed


def test_read_file_returns_sha_and_last_commit(demo: tuple[TestClient, Path]) -> None:
    client, _ = demo
    body = client.get("/api/spaces/apex-roofing/file", params={"path": "brief.md"}).json()
    assert body["content"].startswith("# Apex Roofing")
    assert len(body["sha"]) == 40 and body["editable"]
    assert body["lastCommit"]["author"]["login"] == "priya-nair"


def test_locked_write_is_refused_and_nothing_changes(demo: tuple[TestClient, Path]) -> None:
    client, config = demo
    repo = config / "spaces" / "northline"
    before = (repo / "locked/compliance.md").read_text()
    head = _git(repo, "rev-parse", "HEAD")
    # Jordan can edit Northline but isn't one of its owners (the admins team).
    for headers in (None, JORDAN):
        res = client.put("/api/spaces/northline/file", headers=headers, json={
            "path": "locked/compliance.md", "content": "# gone\n", "message": "x"})
        assert res.status_code == 403
        assert res.json()["error"]["code"] == "locked"
        assert "locked" in res.json()["error"]["message"]
    assert (repo / "locked/compliance.md").read_text() == before
    assert _git(repo, "rev-parse", "HEAD") == head
    assert _git(repo, "branch", "--list", "selfhub/*") == ""


def test_read_role_and_no_access_are_refused(demo: tuple[TestClient, Path]) -> None:
    client, _ = demo
    res = client.put("/api/spaces/northline/file", json={
        "path": "sops/reporting.md", "content": "x", "message": "x"})
    assert res.status_code == 403 and res.json()["error"]["code"] == "read-only"
    res = client.get("/api/spaces/bolt-hvac/tree")
    assert res.status_code == 403 and res.json()["error"]["code"] == "no-access"
    hits = client.get("/api/search", params={"q": "TACLA license"}).json()
    assert all(h["spaceId"] != "bolt-hvac" for h in hits)


def test_admin_write_to_pull_request_space_proposes_a_branch(
    demo: tuple[TestClient, Path],
) -> None:
    client, config = demo
    repo = config / "spaces" / "northline"
    current = client.get("/api/spaces/northline/file", headers=MAYA,
                         params={"path": "sops/reporting.md"}).json()
    assert current["editable"]
    new = current["content"] + "\n## Deadlines\n\n- Draft by the 3rd business day.\n"
    res = client.put("/api/spaces/northline/file", headers=MAYA, json={
        "path": "sops/reporting.md", "content": new, "message": "Reporting: add deadline",
        "baseSha": current["sha"]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["outcome"] == "pull-request"
    assert body["branch"].startswith("selfhub/")
    assert body["commit"]["author"]["login"] == "maya-chen"
    # main is untouched until a reviewer merges; the branch holds the change.
    assert body["file"]["content"] == current["content"]
    assert _git(repo, "branch", "--show-current") == "main"
    assert "Deadlines" in _git(repo, "show", f"{body['branch']}:sops/reporting.md")


def test_stale_base_sha_is_a_conflict(demo: tuple[TestClient, Path]) -> None:
    client, _ = demo
    res = client.put("/api/spaces/apex-roofing/file", json={
        "path": "offers.md", "content": "x", "message": "x", "baseSha": "0" * 40})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "conflict"


def test_direct_write_commits_only_the_touched_path(demo: tuple[TestClient, Path]) -> None:
    client, config = demo
    repo = config / "spaces" / "apex-roofing"
    dirty = "past-ads/2026-09-fall-inspection.md"
    assert dirty in _git(repo, "status", "--porcelain")
    current = client.get("/api/spaces/apex-roofing/file", params={"path": "offers.md"}).json()
    res = client.put("/api/spaces/apex-roofing/file", json={
        "path": "offers.md", "content": current["content"] + "\nUpdated.\n",
        "message": "Offers: note", "baseSha": current["sha"]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["outcome"] == "committed" and body["prUrl"] is None
    assert body["commit"]["author"]["login"] == "sam-okafor"
    assert _git(repo, "show", "--name-only", "--format=", "HEAD") == "offers.md"
    assert dirty in _git(repo, "status", "--porcelain")  # Sam's draft stays uncommitted
    assert body["file"]["sha"] != current["sha"]


def test_create_delete_history_and_diff(demo: tuple[TestClient, Path]) -> None:
    client, _ = demo
    path = "work/2026-10-12-winter-prep.md"
    res = client.post("/api/spaces/apex-roofing/files", json={
        "path": path, "content": "# Winter prep\n", "message": "Draft winter ad"})
    assert res.status_code == 201, res.text
    again = client.post("/api/spaces/apex-roofing/files", json={"path": path, "content": "x"})
    assert again.status_code == 409 and again.json()["error"]["code"] == "exists"

    history = client.get("/api/spaces/apex-roofing/history", params={"path": path}).json()
    assert history[0]["message"] == "Draft winter ad" and history[0]["additions"] == 1
    diff = client.get("/api/spaces/apex-roofing/diff",
                      params={"sha": history[0]["sha"], "path": path}).json()
    assert "+# Winter prep" in diff["patch"]

    gone = client.delete("/api/spaces/apex-roofing/file",
                         params={"path": path, "message": "Drop draft"})
    assert gone.status_code == 200 and gone.json()["outcome"] == "committed"
    missing = client.get("/api/spaces/apex-roofing/file", params={"path": path})
    assert missing.status_code == 404
    bad = client.get("/api/spaces/apex-roofing/file", params={"path": "../../etc/passwd"})
    assert bad.status_code == 400


def test_member_changes_need_admin(demo: tuple[TestClient, Path]) -> None:
    client, _ = demo
    members = client.get("/api/spaces/apex-roofing/members").json()
    by_login = {m["login"]: m for m in members}
    assert by_login["sam-okafor"] == {**by_login["sam-okafor"], "role": "write", "via": "team",
                                      "team": "Ads"}
    assert by_login["jordan-reyes"]["isOwner"]
    assert by_login["tess-alvarez"]["role"] == "read"

    res = client.put("/api/spaces/apex-roofing/members/tess-alvarez", json={"role": "write"})
    assert res.status_code == 403 and res.json()["error"]["code"] == "forbidden"
    res = client.post("/api/spaces/apex-roofing/members", json={"login": "leo-park",
                                                                "role": "read"})
    assert res.status_code == 403

    res = client.post("/api/spaces/apex-roofing/members", headers=MAYA,
                      json={"login": "leo-park", "role": "read"})
    assert res.status_code == 201
    assert any(m["login"] == "leo-park" for m in res.json())
    res = client.put("/api/spaces/apex-roofing/members/tess-alvarez", headers=MAYA,
                     json={"role": "write"})
    assert {m["login"]: m["role"] for m in res.json()}["tess-alvarez"] == "write"
    res = client.delete("/api/spaces/apex-roofing/members/sam-okafor", headers=MAYA)
    assert res.status_code == 409 and res.json()["error"]["code"] == "via-team"
    res = client.delete("/api/spaces/apex-roofing/members/tess-alvarez", headers=MAYA)
    assert all(m["login"] != "tess-alvarez" for m in res.json())

    people = client.get("/api/people").json()
    assert len(people["people"]) == 9
    assert people["access"]["leo-park"]["apex-roofing"] == "read"
    assert people["access"]["sam-okafor"]["bolt-hvac"] == "none"


def test_rules_approve_and_reject_need_owner_or_admin(demo: tuple[TestClient, Path]) -> None:
    client, config = demo
    pending = client.get("/api/rules", params={"status": "pending"}).json()
    assert {r["spaceId"] for r in pending} == {"apex-roofing", "ads-team"}
    apex_rule = next(r for r in pending if r["spaceId"] == "apex-roofing")
    assert apex_rule["proposedBy"] == "sam-okafor"
    active_before = len(client.get("/api/rules", params={"status": "active"}).json())

    res = client.post(f"/api/rules/{apex_rule['id']}/approve")
    assert res.status_code == 403 and "Jordan Reyes" in res.json()["error"]["message"]

    res = client.post(f"/api/rules/{apex_rule['id']}/approve", headers=JORDAN)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "active" and res.json()["approvedBy"] == "jordan-reyes"
    learned = (config / "spaces/apex-roofing/rules/learned.md").read_text()
    assert apex_rule["id"] in learned

    ads_rule = next(r for r in pending if r["spaceId"] == "ads-team")
    res = client.post(f"/api/rules/{ads_rule['id']}/reject", headers=JORDAN)
    assert res.status_code == 200 and res.json()["rejectedBy"] == "jordan-reyes"
    assert client.get("/api/rules", params={"status": "pending"}).json() == []
    assert len(client.get("/api/rules", params={"status": "active"}).json()) == active_before + 1
    rejected = client.get("/api/rules", params={"status": "rejected"}).json()
    assert [r["id"] for r in rejected] == [ads_rule["id"]]
    assert client.post(f"/api/rules/{ads_rule['id']}/approve", headers=JORDAN).status_code == 404


def test_activity_merges_commits_and_events(demo: tuple[TestClient, Path]) -> None:
    client, _ = demo
    items = client.get("/api/activity", params={"limit": 50}).json()
    types = {i["type"] for i in items}
    assert {"edit", "rule", "access", "sync"} <= types
    assert all(i["spaceId"] != "bolt-hvac" for i in items)  # Sam can't see Bolt
    dates = [i["date"] for i in items]
    assert dates == sorted(dates, reverse=True)


def test_sync_pulls_and_pushes(demo: tuple[TestClient, Path]) -> None:
    client, _ = demo
    res = client.post("/api/spaces/ads-team/sync").json()
    assert res["result"] == "pulled" and res["pulled"] == 2
    assert res["space"]["sync"]["state"] == "synced"
    res = client.post("/api/spaces/bolt-hvac/sync", headers={"X-SelfHub-User": "priya-nair"})
    assert res.json()["result"] == "pushed"
    assert client.post("/api/spaces/me/sync").json()["result"] == "up-to-date"


def test_create_and_disconnect_space(demo: tuple[TestClient, Path]) -> None:
    client, config = demo
    res = client.post("/api/spaces", json={
        "action": "create", "name": "Summit Solar", "kind": "client",
        "description": "Boulder solar installer.", "owners": ["priya-nair"]})
    assert res.status_code == 201, res.text
    space = res.json()
    assert space["id"] == "summit-solar" and space["myAccess"] == "admin"
    assert space["owners"] == ["priya-nair", "sam-okafor"]  # the creator always owns it
    assert (config / "spaces/summit-solar/brief.md").exists()

    res = client.post("/api/spaces", json={"action": "create", "name": "Creative",
                                           "kind": "team", "writePolicy": "pull-request"})
    assert res.json()["writePolicy"] == "pull-request"

    assert client.delete("/api/spaces/summit-solar").status_code == 200
    assert "summit-solar" not in _spaces(client)
    assert (config / "spaces/summit-solar/brief.md").exists()  # files stay
    assert client.delete("/api/spaces/me").status_code == 400


def _ridgeline_repo(tmp_path: Path) -> Path:
    """A local space repo made outside the API, with no remote."""
    from selfhub_cli.workspace import Workspace
    from selfhub_core.git_ops import init_repo

    repo = tmp_path / "elsewhere/ridgeline"
    init_repo(repo)
    _git(repo, "config", "user.name", "Sam Okafor")
    _git(repo, "config", "user.email", "sam@example.com")
    result = Workspace(tmp_path / "other-config", tmp_path / "other-personal").create_space(
        repo, "Ridgeline Plumbing", "client", owners=["@sam-okafor"], aliases=[])
    assert result.success, result.message
    return repo


def _members(client: TestClient, sid: str, headers: dict[str, str] | None = None) -> Any:
    res = client.get(f"/api/spaces/{sid}/members", headers=headers)
    assert res.status_code == 200, res.text
    return sorted((m["login"], m["role"], m["isOwner"]) for m in res.json())


def test_members_are_the_same_for_every_viewer(
    demo: tuple[TestClient, Path], tmp_path: Path
) -> None:
    client, _ = demo
    res = client.post("/api/spaces", json={"action": "connect", "name": "Ridgeline Plumbing",
                                           "source": str(_ridgeline_repo(tmp_path))})
    assert res.status_code == 201, res.text
    res = client.post("/api/spaces", json={"action": "create", "name": "Summit Solar",
                                           "kind": "client"})
    assert res.status_code == 201, res.text

    for sid in ("ridgeline-plumbing", "summit-solar"):
        as_sam, as_maya = _members(client, sid), _members(client, sid, MAYA)
        assert as_sam == as_maya
        assert ("sam-okafor", "admin", True) in as_sam
        # The admins team gets admin on every new repo, like the seeded ones.
        assert ("maya-chen", "admin", False) in as_sam

    leo = {"X-SelfHub-User": "leo-park"}
    assert _spaces(client, leo)["ridgeline-plumbing"]["myAccess"] == "none"
    assert client.get("/api/spaces/ridgeline-plumbing/tree", headers=leo).status_code == 403

    views = {who: client.get("/api/people", headers=h).json()
             for who, h in (("sam", None), ("maya", MAYA), ("leo", leo))}
    assert views["sam"]["access"] == views["maya"]["access"] == views["leo"]["access"]
    assert views["maya"]["access"]["sam-okafor"]["ridgeline-plumbing"] == "admin"
    for who, login, headers in (("sam", "sam-okafor", None), ("maya", "maya-chen", MAYA),
                                ("leo", "leo-park", leo)):
        listed = _spaces(client, headers)
        for entry in views[who]["spaces"]:
            assert entry["myAccess"] == listed[entry["id"]]["myAccess"]
            assert views[who]["access"][login][entry["id"]] == entry["myAccess"]
            assert entry["owners"] == listed[entry["id"]]["owners"]


def test_space_list_cache_is_cleared_by_writes(demo: tuple[TestClient, Path]) -> None:
    client, config = demo
    before = _spaces(client)["apex-roofing"]
    res = client.post("/api/spaces/apex-roofing/files",
                      json={"path": "notes/cache-check.md", "content": "# Hi\n"})
    assert res.status_code == 201, res.text
    after = _spaces(client)["apex-roofing"]
    assert after["fileCount"] == before["fileCount"] + 1
    assert after["updatedAt"] != before["updatedAt"]

    # A commit made outside the API shows up once the short cache expires.
    client.app.state.ctx.locks.facts.ttl = 0  # type: ignore[attr-defined]
    repo = config / "spaces/apex-roofing"
    (repo / "outside.md").write_text("x\n", encoding="utf-8")
    assert _spaces(client)["apex-roofing"]["fileCount"] == after["fileCount"] + 1


def test_unknown_demo_user_is_an_error(demo: tuple[TestClient, Path]) -> None:
    client, _ = demo
    res = client.get("/api/me", headers={"X-SelfHub-User": "nobody"})
    assert res.status_code == 400 and res.json()["error"]["code"] == "unknown-user"


def test_gh_provider_reads_and_maps_roles_without_mutating() -> None:
    calls: list[list[str]] = []
    responses: dict[str, Any] = {
        "user": {"login": "maya", "name": "Maya", "avatar_url": "a"},
        "repos/acme/brain/collaborators/maya/permission": {"permission": "admin",
                                                           "role_name": "maintain"},
        "repos/acme/brain/collaborators/sam/permission": {"permission": "read",
                                                          "role_name": "triage"},
    }

    def runner(args: list[str]) -> Any:
        calls.append(args)
        return responses.get(args[1])

    gh = GhGitHubProvider(org_login="acme", runner=runner)
    repo = RepoRef("acme", "brain")
    assert gh.me().login == "maya"
    assert gh.role(repo, "maya") == "admin"
    assert gh.role(repo, "sam") == "read"
    assert all("-X" not in call for call in calls)

    gh.set_role(repo, "sam", "write")
    assert calls[-1] == ["api", "repos/acme/brain/collaborators/sam", "-X", "PUT", "-f",
                         "permission=push"]


# ---------- QA round 2 ----------

_GIT_WORDS = ("commit", "push", "pull ", "pulled", "clone", "branch", "remote", "HEAD",
              "[SelfHub]", "R-20", "read access", "write access", "upstream", "rebase",
              # glossary: incoming work is "changes"; "unsaved" is for editor drafts only
              "update", "unsaved", "repo", "@", "GitHub read", "GitHub write")


def _plain(text: str | None) -> None:
    lowered = (text or "").lower()
    for word in _GIT_WORDS:
        # Whole words for plain terms, so "reporting" doesn't match "repo".
        pattern = rf"\b{re.escape(word.lower())}" if word[0].isalnum() else re.escape(word)
        if word.isalpha():
            pattern += r"(s|ed|ing)?\b"
        assert not re.search(pattern, lowered), f"{word!r} in {text!r}"
    # The action is always called "Sync now".
    assert not re.search(r"\bsync (?!now\b)", lowered), f"bare 'sync' instruction in {text!r}"


def test_sync_is_honest_about_local_changes_and_save_local_saves_them(
    demo: tuple[TestClient, Path],
) -> None:
    client, config = demo
    apex = config / "spaces/apex-roofing"
    sync = _spaces(client)["apex-roofing"]["sync"]
    assert sync["state"] == "local-changes"
    assert sync["changedPaths"] == ["past-ads/2026-09-fall-inspection.md"]
    assert sync["changes"] == [{"path": "past-ads/2026-09-fall-inspection.md",
                                "status": "modified"}]
    assert sync["message"] == ("1 file on this computer isn't on GitHub yet. Save it to "
                               "send it.")
    bolt = _spaces(client, {"X-SelfHub-User": "priya-nair"})["bolt-hvac"]["sync"]
    assert bolt["message"] == ("This space isn't on GitHub yet. 5 saved changes are only on "
                               "this computer. Sync now to send them.")
    _plain(bolt["message"])
    _plain(sync["message"])

    res = client.post("/api/spaces/apex-roofing/sync").json()
    assert res["result"] == "local-changes"  # never "up-to-date" while edits are unsaved
    assert res["space"]["sync"]["state"] == "local-changes"
    _plain(res["message"])

    (apex / "notes").mkdir(exist_ok=True)
    (apex / "notes/new-idea.md").write_text("# Idea\n", encoding="utf-8")
    res = client.post("/api/spaces/apex-roofing/save-local",
                      headers={"X-SelfHub-User": "tess-alvarez"})  # Can view only
    assert res.status_code == 403 and res.json()["error"]["code"] == "read-only"

    res = client.post("/api/spaces/apex-roofing/save-local", json={"message": "Fall results"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["result"] == "pushed" and body["outcome"] == "committed"
    assert sorted(body["saved"]) == ["notes/new-idea.md", "past-ads/2026-09-fall-inspection.md"]
    assert body["space"]["sync"]["state"] == "synced"
    assert body["space"]["sync"]["changedPaths"] == []
    _plain(body["message"])
    assert _git(apex, "status", "--porcelain") == ""
    assert _git(apex, "log", "-1", "--format=%an %s") == "Sam Okafor Fall results"
    assert _git(apex, "rev-parse", "HEAD") == _git(apex, "rev-parse", "@{u}")

    res = client.post("/api/spaces/apex-roofing/save-local")
    assert res.status_code == 422 and res.json()["error"]["code"] == "no-change"


def test_save_local_refuses_locked_files_by_name(demo: tuple[TestClient, Path]) -> None:
    client, config = demo
    northline = config / "spaces/northline"
    target = northline / "locked/compliance.md"
    target.write_text(target.read_text(encoding="utf-8") + "\nEdited by hand.\n",
                      encoding="utf-8")
    (northline / "sops/draft.md").write_text("# Draft\n", encoding="utf-8")
    before = _git(northline, "rev-parse", "HEAD")
    res = client.post("/api/spaces/northline/save-local", headers=JORDAN)
    assert res.status_code == 403
    error = res.json()["error"]
    assert error["code"] == "locked" and "locked/compliance.md" in error["message"]
    assert error["details"] == {"path": "locked/compliance.md"}
    _plain(error["message"])
    _plain(error["hint"])
    assert _git(northline, "rev-parse", "HEAD") == before
    assert "locked/compliance.md" in _git(northline, "status", "--porcelain")


def test_save_reports_what_it_pulled_and_updates_last_sync(
    demo: tuple[TestClient, Path],
) -> None:
    client, _ = demo
    ads = _spaces(client)["ads-team"]["sync"]
    assert ads["message"] == ("GitHub has 2 newer changes from Jordan Reyes. Sync now to get "
                              "them.")
    old_sync = ads["lastSyncAt"]
    current = client.get("/api/spaces/ads-team/file",
                         params={"path": "templates/ad-brief.md"}).json()
    res = client.put("/api/spaces/ads-team/file", json={
        "path": "templates/ad-brief.md", "content": current["content"] + "\nOne more line.\n",
        "baseSha": current["sha"]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["pulled"] == 2 and body["pulledBy"] == ["Jordan Reyes"]
    assert "Got 2 changes from Jordan Reyes first." in body["message"]
    _plain(body["message"])
    assert body["space"]["sync"]["state"] == "synced"
    assert body["space"]["sync"]["lastSyncAt"] > old_sync


def test_conflict_is_structured_and_a_409_still_updates_last_sync(
    demo: tuple[TestClient, Path],
) -> None:
    client, config = demo
    ads = config / "spaces/ads-team"
    stale = client.get("/api/spaces/ads-team/file",
                       params={"path": "sops/facebook-ads.md"}).json()
    old_sync = _spaces(client)["ads-team"]["sync"]["lastSyncAt"]

    # An unsaved edit here to a file Jordan also changed on GitHub.
    target = ads / "sops/facebook-ads.md"
    original = target.read_text(encoding="utf-8")
    target.write_text(original + "\nMy local note.\n", encoding="utf-8")
    client.app.state.ctx.locks.facts.ttl = 0  # type: ignore[attr-defined]
    sync = _spaces(client)["ads-team"]["sync"]
    assert sync["conflict"] == {"path": "sops/facebook-ads.md", "byName": "Jordan Reyes",
                                "byLogin": "jordan-reyes"}
    assert sync["incomingBy"] == ["Jordan Reyes"]
    target.write_text(original, encoding="utf-8")
    assert _spaces(client)["ads-team"]["sync"]["conflict"] is None

    res = client.put("/api/spaces/ads-team/file", json={
        "path": "sops/facebook-ads.md", "content": stale["content"] + "\nMine.\n",
        "baseSha": stale["sha"]})
    assert res.status_code == 409
    error = res.json()["error"]
    assert error["code"] == "conflict"
    assert error["details"] == {"path": "sops/facebook-ads.md", "byName": "Jordan Reyes",
                                "byLogin": "jordan-reyes"}
    assert "Jordan Reyes saved a newer version" in error["message"]
    _plain(error["message"])
    after = _spaces(client)["ads-team"]["sync"]
    assert after["state"] == "synced" and after["lastSyncAt"] > old_sync


def test_connect_errors_are_plain_and_demo_create_has_a_remote(
    demo: tuple[TestClient, Path], tmp_path: Path
) -> None:
    client, config = demo
    plain = tmp_path / "plain"
    plain.mkdir()
    (plain / "notes.md").write_text("hi\n", encoding="utf-8")
    res = client.post("/api/spaces", json={"action": "connect", "source": str(plain)},
                      headers=MAYA)
    assert res.status_code == 400
    error = res.json()["error"]
    assert error["code"] == "not-a-space"
    assert error["message"] == "This folder isn't a SelfHub space yet."
    for text in (error["message"], error["hint"]):
        assert "selfhub " not in text and "`" not in text and "--kind" not in text
    res = client.post("/api/spaces", json={"action": "connect",
                                           "source": str(tmp_path / "missing")})
    assert res.status_code == 400 and res.json()["error"]["code"] == "not-found"

    res = client.post("/api/spaces", json={"action": "create", "name": "Cedar Dental",
                                           "kind": "client"}, headers=MAYA)
    assert res.status_code == 201, res.text
    space = res.json()
    assert space["sync"]["state"] == "synced" and space["sync"]["lastSyncAt"]
    assert space["repo"]["name"] == "cedar-dental"
    repo = config / "spaces/cedar-dental"
    assert _git(repo, "rev-parse", "HEAD") == _git(repo, "rev-parse", "@{u}")


def test_activity_history_and_errors_use_plain_words(demo: tuple[TestClient, Path]) -> None:
    client, _ = demo
    for item in client.get("/api/activity", params={"limit": 200},
                           headers=MAYA).json():
        _plain(item["summary"])
    rule_items = [a for a in client.get("/api/activity", params={"limit": 200}).json()
                  if a["type"] == "rule" and a.get("ruleId")]
    assert any(a["summary"] == "Sam Okafor proposed a rule for Apex Roofing: No urgency "
               "phrasing for Apex" for a in rule_items)
    for commit in client.get("/api/spaces/ads-team/history", params={"limit": 50}).json():
        _plain(commit["message"])
    approved = [c for c in client.get("/api/spaces/ads-team/history").json()
                if c.get("ruleId")]
    assert approved and approved[0]["rawMessage"].startswith("[SelfHub]")
    for space in client.get("/api/spaces", headers=MAYA).json():
        _plain(space["sync"]["message"])
    res = client.put("/api/spaces/northline/file", json={"path": "sops/reporting.md",
                                                         "content": "x"})
    _plain(res.json()["error"]["message"])
    assert "Can edit" in res.json()["error"]["message"]
    res = client.put("/api/spaces/northline/file", headers=JORDAN,
                     json={"path": "locked/compliance.md", "content": "x"})
    _plain(res.json()["error"]["message"])
    _plain(res.json()["error"]["hint"])
    res = client.post("/api/spaces/apex-roofing/members", headers=MAYA,
                      json={"login": "leo-park", "role": "read"})
    assert res.status_code == 201
    assert next(m for m in res.json() if m["login"] == "leo-park")["pending"] is True
    latest = client.get("/api/activity", params={"limit": 1}, headers=MAYA).json()[0]
    assert latest["summary"] == "Maya Chen gave Leo Park Can view access to Apex Roofing"
    res = client.post("/api/spaces/ads-team/members", json={"login": "dana-whitfield",
                                                            "role": "read"})
    assert res.status_code == 403
    assert res.json()["error"]["hint"] == "Ask Jordan Reyes to add someone."
    res = client.put("/api/spaces/apex-roofing/members/leo-park", headers=MAYA,
                     json={"role": "owner"})
    assert res.status_code == 400
    _plain(res.json()["error"]["message"])
    res = client.post("/api/spaces/ads-team/sync").json()
    assert res["message"] == "Got 2 changes from Jordan Reyes."
    synced = [a for a in client.get("/api/activity", params={"limit": 200}).json()
              if a["type"] == "sync"]
    assert synced[0]["summary"] == "Sam Okafor synced Ads Team and got 2 changes from Jordan Reyes"
    for item in synced:
        _plain(item["summary"])


def test_move_is_one_change_and_names_are_validated(demo: tuple[TestClient, Path]) -> None:
    client, config = demo
    ads = config / "spaces/ads-team"
    before = int(_git(ads, "rev-list", "--count", "HEAD"))
    res = client.post("/api/spaces/ads-team/move", json={
        "from": "templates/facebook-variants.md", "to": "templates/fb-variants.md"})
    assert res.status_code == 200, res.text
    assert res.json()["file"]["path"] == "templates/fb-variants.md"
    assert int(_git(ads, "rev-list", "--count", "HEAD")) == before + 2 + 1  # 2 pulled + 1
    latest = client.get("/api/activity", params={"limit": 1}).json()[0]
    assert latest["summary"] == ("Sam Okafor renamed facebook-variants.md to "
                                 "fb-variants.md in Ads Team")
    res = client.post("/api/spaces/ads-team/files", json={"path": "templates/bad?.md"})
    assert res.status_code == 400 and res.json()["error"]["code"] == "invalid-path"

    res = client.delete("/api/spaces/ads-team/file", params={"path": "templates/fb-variants.md"})
    assert res.status_code == 200
    sha = client.get("/api/activity", params={"limit": 1}).json()[0]
    assert sha["summary"] == "Sam Okafor deleted fb-variants.md from Ads Team"
    diff = client.get("/api/spaces/ads-team/diff", params={"sha": sha["sha"]}).json()
    assert diff["files"][0]["status"] == "deleted"
    assert all(line["type"] in {"hunk", "del"} for line in diff["files"][0]["lines"])
    assert not any(line["text"].startswith(("eleted", "deleted file"))
                   for line in diff["files"][0]["lines"])


def test_tree_file_search_and_reject_reason(demo: tuple[TestClient, Path]) -> None:
    client, _ = demo
    tree = {e["path"]: e for e in client.get("/api/spaces/ads-team/tree").json()}
    assert tree[".selfhub/space.json"]["system"] is True
    assert "system" not in tree["sops/facebook-ads.md"]
    csv = client.get("/api/spaces/ads-team/file",
                     params={"path": "templates/campaign-naming.csv"}).json()
    assert csv["format"] == "csv"
    for hit in client.get("/api/search", params={"q": "urgency"}).json():
        assert "R-20" not in hit["snippet"] and "##" not in hit["snippet"]
    pending = client.get("/api/rules", params={"status": "pending", "space": "apex-roofing"})
    rule_id = pending.json()[0]["id"]
    res = client.post(f"/api/rules/{rule_id}/reject", headers=JORDAN,
                      json={"reason": "Too broad; Apex is fine with soft deadlines."})
    assert res.status_code == 200, res.text
    assert res.json()["rejectReason"] == "Too broad; Apex is fine with soft deadlines."
    _plain(res.json()["message"])
