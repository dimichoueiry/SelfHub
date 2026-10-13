"""Connect a space that is only on this computer to GitHub.

Local mode runs against a fake `gh` on PATH; the real GitHub CLI is never on PATH here,
so no real repository is created and gh's own config is never read.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from selfhub_api.app import Settings, create_app

FAKE_GH = r"""#!/bin/bash
# A stand-in for the GitHub CLI. State: $FAKE_GH_STATE = logged-in | logged-out.
echo "$*" >> "$FAKE_GH_LOG"
remotes="$FAKE_GH_REMOTES"
if [ "$FAKE_GH_STATE" = "logged-out" ]; then
  if [ "$1" = "auth" ]; then echo "You are not logged into any GitHub hosts." >&2; exit 1; fi
  echo "To get started with GitHub CLI, please run:  gh auth login" >&2; exit 4
fi
case "$1 $2" in
  "auth status") echo "Logged in to github.com account octo"; exit 0 ;;
  "api user")
    if [ "$3" = "--jq" ]; then echo octo; else echo '{"login":"octo","name":"Octo Cat"}'; fi
    exit 0 ;;
  "api user/orgs") echo acme; exit 0 ;;
  "api orgs/acme") echo '{"login":"acme","name":"Acme"}'; exit 0 ;;
esac
if [ "$1" = "api" ]; then
  case "$2" in
    repos/*/collaborators/*/permission) echo '{"permission":"admin"}'; exit 0 ;;
    repos/*/*/*|*\?*) echo '[[]]'; exit 0 ;;
    repos/*) if [ -d "$remotes/${2#repos/}.git" ]; then echo '{}'; exit 0; fi
             echo '{"message":"Not Found"}'; echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;
  esac
  echo '[]'; exit 0
fi
if [ "$1 $2" = "repo create" ]; then
  full="$3"; src=""
  while [ $# -gt 0 ]; do [ "$1" = "--source" ] && src="$2"; shift; done
  if [ -d "$remotes/$full.git" ]; then
    echo "GraphQL: Name already exists on this account (createRepository)" >&2; exit 1
  fi
  mkdir -p "$remotes/$full.git"
  git init -q --bare -b main "$remotes/$full.git"
  git -C "$src" remote add origin "$remotes/$full.git"
  git -C "$src" push -q -u origin HEAD >/dev/null 2>&1 || exit 1
  echo "https://github.com/$full"
  exit 0
fi
echo "fake gh: unhandled $*" >&2; exit 2
"""


def _path_without_gh() -> str:
    """The current PATH minus every folder that has a real `gh` in it."""
    keep = [d for d in os.environ.get("PATH", "").split(os.pathsep)
            if d and not (Path(d) / "gh").exists()]
    return os.pathsep.join(keep)


@pytest.fixture()
def fake_gh(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    bin_dir = tmp_path / "fake-bin"
    bin_dir.mkdir()
    gh = bin_dir / "gh"
    gh.write_text(FAKE_GH, encoding="utf-8")
    gh.chmod(0o755)
    remotes = tmp_path / "github"
    remotes.mkdir()
    log = tmp_path / "gh.log"
    log.touch()
    # Belt and braces: even if something did reach a real gh, it would see an empty config.
    monkeypatch.setenv("GH_CONFIG_DIR", str(tmp_path / "gh-config"))
    monkeypatch.setenv("FAKE_GH_REMOTES", str(remotes))
    monkeypatch.setenv("FAKE_GH_LOG", str(log))
    monkeypatch.setenv("FAKE_GH_STATE", "logged-in")
    bare_path = _path_without_gh()

    def install(on: bool) -> None:
        monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{bare_path}" if on else bare_path)

    install(True)
    return {"install": install, "remotes": remotes, "log": log, "monkeypatch": monkeypatch}


@pytest.fixture()
def local(tmp_path: Path, fake_gh: dict[str, Any]) -> tuple[TestClient, Path]:
    config = tmp_path / "config"
    app = create_app(Settings(demo=False, config_dir=config,
                              personal_path=tmp_path / "personal", github_org="acme"))
    client = TestClient(app)
    res = client.post("/api/spaces", json={"action": "create", "name": "Ridgeline Plumbing",
                                           "kind": "client"})
    assert res.status_code == 201, res.text
    assert res.json()["sync"]["state"] == "no-remote"
    return client, config / "spaces/ridgeline-plumbing"


def _state(fake: dict[str, Any], state: str) -> None:
    fake["monkeypatch"].setenv("FAKE_GH_STATE", state)


def _connect(client: TestClient, name: str = "ridgeline-plumbing") -> Any:
    return client.post("/api/spaces/ridgeline-plumbing/connect-github",
                       json={"owner": "acme", "name": name, "visibility": "private"})


def test_gh_not_installed_explains_and_gives_the_folder_path(
    local: tuple[TestClient, Path], fake_gh: dict[str, Any]
) -> None:
    client, folder = local
    fake_gh["install"](False)
    assert client.get("/api/me").status_code == 200  # still opens, as the local user
    res = client.get("/api/spaces/ridgeline-plumbing/github")
    assert res.status_code == 200, res.text
    check = res.json()
    assert check["ready"] is False and check["problem"] == "gh-missing"
    assert check["path"] == str(folder.resolve()) and Path(check["path"]).is_absolute()
    assert check["suggestedName"] == "ridgeline-plumbing" and check["owners"] == []
    # The space itself carries the path too, so the prompt works even if the check fails.
    assert client.get("/api/spaces/ridgeline-plumbing").json()["path"] == check["path"]

    res = _connect(client)
    assert res.status_code == 503
    error = res.json()["error"]
    assert error["code"] == "gh-missing"
    assert error["message"] == "The GitHub CLI (gh) isn't installed on this computer."


def test_logged_out_says_so_and_creates_nothing(
    local: tuple[TestClient, Path], fake_gh: dict[str, Any]
) -> None:
    client, folder = local
    _state(fake_gh, "logged-out")
    assert client.get("/api/spaces").status_code == 200
    check = client.get("/api/spaces/ridgeline-plumbing/github").json()
    assert check["ready"] is False and check["problem"] == "logged-out"

    res = _connect(client)
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "logged-out"
    assert "repo create" not in fake_gh["log"].read_text()
    assert not list(fake_gh["remotes"].iterdir())
    assert subprocess.run(["git", "remote"], cwd=folder, capture_output=True,
                          text=True).stdout.strip() == ""


def test_logged_in_creates_a_private_repo_pushes_and_updates_sync(
    local: tuple[TestClient, Path], fake_gh: dict[str, Any]
) -> None:
    client, folder = local
    check = client.get("/api/spaces/ridgeline-plumbing/github").json()
    assert check["ready"] is True and check["problem"] is None and check["login"] == "octo"
    assert check["owners"] == [{"login": "octo", "kind": "user"},
                               {"login": "acme", "kind": "org"}]

    res = _connect(client)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["repo"] == {"owner": "acme", "name": "ridgeline-plumbing",
                            "url": "https://github.com/acme/ridgeline-plumbing"}
    space = body["space"]
    assert space["sync"]["state"] == "synced"
    assert space["repo"]["url"] == "https://github.com/acme/ridgeline-plumbing"
    calls = fake_gh["log"].read_text()
    assert (f"repo create acme/ridgeline-plumbing --private --source {folder} "
            "--remote origin --push") in calls
    bare = fake_gh["remotes"] / "acme/ridgeline-plumbing.git"
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=folder, capture_output=True,
                          text=True).stdout.strip()
    assert subprocess.run(["git", "rev-parse", "main"], cwd=bare, capture_output=True,
                          text=True).stdout.strip() == head
    listed = {s["id"]: s for s in client.get("/api/spaces").json()}
    assert listed["ridgeline-plumbing"]["sync"]["state"] == "synced"

    res = _connect(client)  # once is enough
    assert res.status_code == 409 and res.json()["error"]["code"] == "already-connected"
    assert client.get("/api/spaces/ridgeline-plumbing/github").status_code == 409


def test_name_taken_suggests_another_and_the_suggestion_works(
    local: tuple[TestClient, Path], fake_gh: dict[str, Any]
) -> None:
    client, folder = local
    (fake_gh["remotes"] / "acme/ridgeline-plumbing.git").mkdir(parents=True)
    res = _connect(client)
    assert res.status_code == 409
    error = res.json()["error"]
    assert error["code"] == "name-taken"
    assert error["message"] == ("acme already has a repository called ridgeline-plumbing on "
                                "GitHub.")
    assert error["details"]["suggestion"] == "ridgeline-plumbing-2"
    assert error["hint"] == "Try ridgeline-plumbing-2, or pick another name."
    assert subprocess.run(["git", "remote"], cwd=folder, capture_output=True,
                          text=True).stdout.strip() == ""

    res = _connect(client, "ridgeline-plumbing-2")
    assert res.status_code == 200, res.text
    assert res.json()["space"]["sync"]["state"] == "synced"


def test_bad_names_are_refused_before_gh_runs(
    local: tuple[TestClient, Path], fake_gh: dict[str, Any]
) -> None:
    client, _ = local
    for name in ("", "has space", "../up", "a" * 101):
        res = _connect(client, name)
        assert res.status_code == 400 and res.json()["error"]["code"] == "invalid-name", name
    res = client.post("/api/spaces/ridgeline-plumbing/connect-github",
                      json={"owner": "acme", "name": "ok", "visibility": "secret"})
    assert res.status_code == 400
    assert "repo create" not in fake_gh["log"].read_text()


def test_demo_mode_connects_without_gh_and_only_admins_can(
    tmp_path: Path, fake_gh: dict[str, Any]
) -> None:
    from selfhub_cli.workspace import Workspace
    from selfhub_core.git_ops import init_repo

    fake_gh["install"](False)  # demo mode never needs gh
    repo = tmp_path / "elsewhere/ridgeline"
    init_repo(repo)
    for key, value in (("user.name", "Sam Okafor"), ("user.email", "sam@example.com")):
        subprocess.run(["git", "config", key, value], cwd=repo, check=True)
    made = Workspace(tmp_path / "other-config", tmp_path / "other-personal").create_space(
        repo, "Ridgeline Plumbing", "client", owners=["@sam-okafor"], aliases=[])
    assert made.success, made.message

    client = TestClient(create_app(Settings(demo=True, config_dir=tmp_path / "demo",
                                            public_url="http://testserver")))
    res = client.post("/api/spaces", json={"action": "connect", "source": str(repo)})
    assert res.status_code == 201, res.text
    sid = res.json()["id"]
    assert res.json()["sync"]["state"] == "no-remote"

    check = client.get(f"/api/spaces/{sid}/github").json()
    assert check["ready"] is True and check["path"] == str(repo.resolve())
    org = next(o["login"] for o in check["owners"] if o["kind"] == "org")
    assert check["defaultOwner"] == org

    res = client.post(f"/api/spaces/{sid}/members", json={"login": "leo-park", "role": "read"})
    assert res.status_code == 201, res.text
    res = client.get(f"/api/spaces/{sid}/github", headers={"X-SelfHub-User": "leo-park"})
    assert res.status_code == 403
    assert res.json()["error"]["hint"] == "Ask an admin to connect this space to GitHub."

    res = client.post(f"/api/spaces/{sid}/connect-github",
                      json={"owner": org, "name": "client-apex"})
    assert res.status_code == 409 and res.json()["error"]["code"] == "name-taken"
    res = client.post(f"/api/spaces/{sid}/connect-github", json={"owner": org, "name": sid})
    assert res.status_code == 200, res.text
    assert res.json()["space"]["sync"]["state"] == "synced"
