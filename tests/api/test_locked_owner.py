"""Owners of a space can change its locked files (SH-9).

Local mode, with GitHub faked: `gh` is never run and nothing leaves this machine.

- Only on this computer: an owner's edit is saved straight away.
- Connected to GitHub: an owner's edit becomes a reviewed change (branch + pull request).
- Everyone else sees the lock and who to ask, and gets a 403.
"""

from __future__ import annotations

import json
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
import selfhub_api.app as api_app
import selfhub_cli.service as cli_service
from fastapi.testclient import TestClient
from selfhub_api.app import Settings, create_app
from selfhub_api.brain import Brain, Context, SpaceLocks
from selfhub_api.github import GhGitHubProvider, ProviderError
from selfhub_api.store import Store
from selfhub_cli.workspace import Workspace
from selfhub_core.spaces import MANIFEST_PATH, Space, load_manifest

LOCKED = "locked/README.md"
DIMITRI = {"login": "dimichoueiry", "name": "Dimitri El-Choueiry", "avatar_url": "a",
           "email": "dimi@example.com"}
SAM = {"login": "sam", "name": "Sam Okafor", "avatar_url": "a", "email": "sam@example.com"}
LOCAL_NOTE = ("You own this file. Changes are saved straight away because this space is "
              "only on this computer.")


def _git(repo: Path, *args: str) -> str:
    done = subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True)
    return done.stdout.strip()


def _runner(user: dict[str, Any], role: str = "admin") -> Callable[[list[str]], Any]:
    def run(args: list[str]) -> Any:
        path = args[1]
        if path == "user":
            return user
        if path.endswith(f"/collaborators/{user['login']}/permission"):
            return {"permission": role}
        if "--paginate" in args:
            return []
        return None

    return run


@pytest.fixture()
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    # This computer's git identity, kept away from the real one.
    gitconfig = tmp_path / "gitconfig"
    gitconfig.write_text("[user]\n\tname = Dimitri El-Choueiry\n\temail = dimi@example.com\n"
                         "[init]\n\tdefaultBranch = main\n", encoding="utf-8")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(gitconfig))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    prs: list[str] = []

    def fake_pr(repo_path: Path, base: str, title: str) -> str:
        prs.append(title)
        return f"https://github.com/acme/ui-ux/pull/{len(prs)}"

    monkeypatch.setattr(cli_service, "_open_pull_request", fake_pr)
    return {"config": tmp_path / "config", "personal": tmp_path / "personal", "prs": prs,
            "tmp": tmp_path, "monkeypatch": monkeypatch}


def _client(env: dict[str, Any], user: dict[str, Any], role: str = "admin") -> TestClient:
    run = _runner(user, role)
    env["monkeypatch"].setattr(
        api_app, "GhGitHubProvider", lambda org_login=None: GhGitHubProvider(org_login, run))
    return TestClient(create_app(Settings(demo=False, config_dir=env["config"],
                                          personal_path=env["personal"])))


def _create(client: TestClient) -> Path:
    """Create the team space UI/UX the way the dashboard does: owners left empty."""
    res = client.post("/api/spaces", json={"action": "create", "name": "UI/UX", "kind": "team"})
    assert res.status_code == 201, res.text
    return Path(client.app.state.ctx.workspace.config_dir) / "spaces" / "ui-ux"


def _connect(client: TestClient, repo: Path, tmp: Path) -> Path:
    """Give the space a remote, as if it were connected to GitHub as acme/ui-ux."""
    bare = tmp / "remotes" / "ui-ux.git"
    bare.parent.mkdir(parents=True, exist_ok=True)
    _git(bare.parent, "init", "-q", "--bare", "-b", "main", str(bare))
    _git(repo, "remote", "add", "origin", str(bare))
    _git(repo, "push", "-q", "-u", "origin", "main")
    client.app.state.ctx.store.update_space("ui-ux", repo={"owner": "acme", "name": "ui-ux"})
    return bare


def test_owner_edits_locked_file_directly_when_only_on_this_computer(env: dict[str, Any]) -> None:
    client = _client(env, DIMITRI)
    repo = _create(client)
    assert client.get("/api/spaces/ui-ux").json()["repo"] is None

    doc = client.get("/api/spaces/ui-ux/file", params={"path": LOCKED}).json()
    assert doc["locked"] and doc["editable"] and doc["owned"]
    assert doc["saveMode"] == "direct" and doc["note"] == LOCAL_NOTE
    assert "reason" not in doc
    # New spaces explain locked files in plain words.
    assert "Only this space's owners can change these\nfiles." in doc["content"]
    assert "CODEOWNERS" not in doc["content"] and "pull request" not in doc["content"]
    tree = {e["path"]: e for e in client.get("/api/spaces/ui-ux/tree").json()}
    assert tree[LOCKED]["editable"] and tree[LOCKED]["owned"]

    head = _git(repo, "rev-parse", "HEAD")
    res = client.put("/api/spaces/ui-ux/file", json={
        "path": LOCKED, "content": "# Locked\n\nNo stock photos.\n", "message": "Add rule",
        "baseSha": doc["sha"]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["outcome"] == "committed" and body["prUrl"] is None
    assert body["message"] == "Saved on this computer. This space isn't connected to GitHub."
    assert _git(repo, "rev-parse", "HEAD~1") == head
    assert _git(repo, "log", "-1", "--format=%an|%s") == "Dimitri El-Choueiry|Add rule"
    assert (repo / LOCKED).read_text() == "# Locked\n\nNo stock photos.\n"
    assert _git(repo, "branch", "--list", "selfhub/*") == ""
    assert env["prs"] == []

    # Owners can add files to the locked folder too.
    res = client.post("/api/spaces/ui-ux/files", json={"path": "locked/brand.md",
                                                      "content": "# Brand\n"})
    assert res.status_code in {200, 201}, res.text


def test_owner_edit_in_connected_space_becomes_reviewed_change(env: dict[str, Any]) -> None:
    client = _client(env, DIMITRI)
    repo = _create(client)
    bare = _connect(client, repo, env["tmp"])
    client = _client(env, DIMITRI)  # fresh caches: the space now has a GitHub repo

    doc = client.get("/api/spaces/ui-ux/file", params={"path": LOCKED}).json()
    assert doc["editable"] and doc["owned"] and doc["saveMode"] == "review"
    assert doc["note"].startswith("You own this file.") and "reviewed change" in doc["note"]

    main_before = _git(repo, "rev-parse", "main")
    res = client.put("/api/spaces/ui-ux/file", json={
        "path": LOCKED, "content": "# Locked\n\nNo stock photos.\n", "message": "Add rule"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["outcome"] == "pull-request"
    assert body["prUrl"] == "https://github.com/acme/ui-ux/pull/1"
    assert body["branch"].startswith("selfhub/")
    assert body["message"] == "Sent for review. It becomes part of UI/UX once you approve it."
    # main only changes once the reviewed change is approved; the branch is on GitHub.
    assert _git(repo, "rev-parse", "main") == main_before
    assert _git(repo, "branch", "--show-current") == "main"
    assert "No stock photos" not in (repo / LOCKED).read_text()
    assert _git(bare, "branch", "--list", body["branch"]) != ""

    # Unlocked files in the same direct space still save straight to main.
    res = client.put("/api/spaces/ui-ux/file", json={"path": "sops/README.md",
                                                      "content": "# SOPs\n\nOne.\n"})
    assert res.json()["outcome"] == "committed"
    assert env["prs"] == ["Add rule"]


def test_non_owner_sees_who_to_ask_and_gets_403(env: dict[str, Any]) -> None:
    owner = _client(env, DIMITRI)
    repo = _create(owner)
    _connect(owner, repo, env["tmp"])

    client = _client(env, SAM, role="write")
    doc = client.get("/api/spaces/ui-ux/file", params={"path": LOCKED}).json()
    assert doc["locked"] and not doc["editable"] and "owned" not in doc
    assert doc["reason"] == ("Locked. Only Dimitri El-Choueiry can change this file. Ask "
                             "them to make the change.")
    tree = {e["path"]: e for e in client.get("/api/spaces/ui-ux/tree").json()}
    assert not tree[LOCKED]["editable"] and tree[LOCKED]["reason"] == doc["reason"]
    # Sam can still edit the space's unlocked files.
    assert tree["sops/README.md"]["editable"]

    head = _git(repo, "rev-parse", "HEAD")
    res = client.put("/api/spaces/ui-ux/file", json={"path": LOCKED, "content": "x"})
    assert res.status_code == 403
    error = res.json()["error"]
    assert error["code"] == "locked"
    assert error["message"] == ("locked/README.md is locked in UI/UX. Only Dimitri El-Choueiry "
                                "can change it. Nothing was saved.")
    assert error["hint"] == "Ask them to make the change."
    assert client.delete("/api/spaces/ui-ux/file", params={"path": LOCKED}).status_code == 403
    assert _git(repo, "rev-parse", "HEAD") == head
    assert _git(repo, "branch", "--list", "selfhub/*") == ""


def test_lock_reason_never_names_the_person_reading_it(env: dict[str, Any]) -> None:
    """A co-listed owner without write access still isn't told "only you can change it"."""
    owner = _client(env, DIMITRI)
    repo = _create(owner)
    _connect(owner, repo, env["tmp"])
    manifest = json.loads((repo / MANIFEST_PATH).read_text())
    manifest["owners"] = ["@dimichoueiry", "@sam"]
    (repo / MANIFEST_PATH).write_text(json.dumps(manifest))

    client = _client(env, SAM, role="read")
    doc = client.get("/api/spaces/ui-ux/file", params={"path": LOCKED}).json()
    assert not doc["editable"]
    assert "sam" not in doc["reason"].lower()


# ---------- who counts as an owner ----------


def _space(tmp: Path, owners: list[str], connected: bool,
           author: tuple[str, str] = ("SelfHub", "noreply@selfhub.local")) -> Space:
    """A team space made by hand, so only the owners list (and the first commit's
    author) can make someone an owner."""
    repo = tmp / "space"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    (repo / ".selfhub").mkdir()
    (repo / MANIFEST_PATH).write_text(json.dumps({
        "name": "UI/UX", "kind": "team", "locked": ["locked/"], "owners": owners}))
    (repo / "locked").mkdir()
    (repo / LOCKED).write_text("# Locked\n")
    _git(repo, "add", "-A")
    _git(repo, "-c", f"user.name={author[0]}", "-c", f"user.email={author[1]}",
         "commit", "-q", "-m", "create")
    if connected:
        _git(repo, "remote", "add", "origin", "https://github.com/acme/ui-ux.git")
    manifest = load_manifest(repo)
    assert manifest is not None
    return Space("UI/UX", repo, manifest)


def _brain(tmp: Path, user: dict[str, Any]) -> Brain:
    ctx = Context(workspace=Workspace(tmp / "config", tmp / "personal"),
                  store=Store(tmp / "config"), locks=SpaceLocks(), mode="local")
    return Brain(ctx=ctx, gh=GhGitHubProvider(runner=_runner(user)))


@pytest.mark.parametrize("owners", [
    ["@dimichoueiry"],
    ["@DimiChoueiry"],          # handle, different case
    ["dimichoueiry"],           # no @
    ["Dimi@Example.com"],       # email, different case
    ["@maya", "@DIMICHOUEIRY"],  # one of several
])
def test_owner_matches_handle_or_email_ignoring_case(env: dict[str, Any],
                                                     owners: list[str]) -> None:
    space = _space(env["tmp"], owners, connected=True)
    assert _brain(env["tmp"], DIMITRI)._is_owner(space)
    assert not _brain(env["tmp"] / "other", SAM)._is_owner(space)


def test_owners_on_a_team_count(env: dict[str, Any]) -> None:
    space = _space(env["tmp"], ["@acme/design"], connected=True)

    def run(args: list[str]) -> Any:
        if args[1] == "user":
            return DIMITRI
        if "orgs/acme/teams?" in args[1]:
            return [[{"slug": "design", "name": "Design"}]]
        if "teams/design/members" in args[1]:
            return [[{"login": "DimiChoueiry"}]]
        return []

    ctx = Context(workspace=Workspace(env["tmp"] / "c", env["tmp"] / "p"),
                  store=Store(env["tmp"] / "c"), locks=SpaceLocks(), mode="local")
    assert Brain(ctx=ctx, gh=GhGitHubProvider(org_login="acme", runner=run))._is_owner(space)


def test_space_creator_is_an_owner(env: dict[str, Any]) -> None:
    # Listed owners are someone else, but Dimitri made the space's first commit.
    space = _space(env["tmp"], ["@maya"], connected=True,
                   author=("Dimitri El-Choueiry", "DIMI@example.com"))
    assert _brain(env["tmp"], DIMITRI)._is_owner(space)
    assert not _brain(env["tmp"] / "other", SAM)._is_owner(space)


def test_this_computers_git_identity_counts_only_when_space_is_local(
        env: dict[str, Any]) -> None:
    # gh says "dimi-gh" with no email; git on this computer says dimi@example.com.
    gh_user = {"login": "dimi-gh", "name": "dimi-gh", "avatar_url": "a"}
    local = _space(env["tmp"], ["dimi@example.com"], connected=False)
    assert _brain(env["tmp"], gh_user)._is_owner(local)
    # Once on GitHub, only the GitHub identity counts.
    _git(local.path, "remote", "add", "origin", "https://github.com/acme/ui-ux.git")
    assert not _brain(env["tmp"], gh_user)._is_owner(local)


def _no_gh(args: list[str]) -> Any:
    raise ProviderError("gh-missing", "The GitHub CLI isn't installed.", status=503)


def test_owner_without_gh_edits_locked_file_in_local_space(env: dict[str, Any]) -> None:
    """gh missing or logged out: the API falls back to the person on this computer, and
    their git identity makes them the owner of the space they created here."""
    env["monkeypatch"].setattr(
        api_app, "GhGitHubProvider", lambda org_login=None: GhGitHubProvider(org_login, _no_gh))
    client = TestClient(create_app(Settings(demo=False, config_dir=env["config"],
                                            personal_path=env["personal"])))
    repo = _create(client)
    doc = client.get("/api/spaces/ui-ux/file", params={"path": LOCKED}).json()
    assert doc["editable"] and doc["owned"] and doc["note"] == LOCAL_NOTE
    res = client.put("/api/spaces/ui-ux/file", json={"path": LOCKED, "content": "# Mine\n"})
    assert res.status_code == 200, res.text
    assert res.json()["outcome"] == "committed"
    assert (repo / LOCKED).read_text() == "# Mine\n"


def test_git_identity_counts_in_connected_space_when_gh_is_missing(env: dict[str, Any]) -> None:
    space = _space(env["tmp"], ["dimi@example.com"], connected=True)
    ctx = Context(workspace=Workspace(env["tmp"] / "config", env["tmp"] / "personal"),
                  store=Store(env["tmp"] / "config"), locks=SpaceLocks(), mode="local")
    assert Brain(ctx=ctx, gh=GhGitHubProvider(runner=_no_gh))._is_owner(space)
    # Signed in to GitHub as someone else: the GitHub identity wins.
    assert not _brain(env["tmp"], SAM)._is_owner(space)
