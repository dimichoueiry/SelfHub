import json
import os
import pty
import select
import shutil
import subprocess
from pathlib import Path

import pytest
from selfhub_cli import onboarding

ROOT = Path(__file__).resolve().parents[2]
SETUP = ROOT / "scripts" / "setup.sh"


@pytest.fixture
def cfg(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    config = tmp_path / "cfg"
    monkeypatch.setenv("SELFHUB_CONFIG_HOME", str(config))
    for var in ("SELFHUB_PERSONAL_PATH", "SELFHUB_SPACE_NAME", "SELFHUB_SPACE_KIND",
                "SELFHUB_SPACE_PATH", "SELFHUB_NO_SPACE", "SELFHUB_GITHUB_OWNER"):
        monkeypatch.delenv(var, raising=False)
    return config


def _snapshot(root: Path) -> dict[str, str]:
    return {
        str(p.relative_to(root)): p.read_text(errors="replace")
        for p in sorted(root.rglob("*"))
        if p.is_file() and ".git" not in p.parts
    }


def test_onboarding_writes_every_config_file_and_is_idempotent(cfg: Path, tmp_path: Path) -> None:
    args = ["--yes", "--personal-path", str(tmp_path / "me"), "--github-owner", "sam",
            "--space-name", "Apex Roofing", "--space-kind", "client"]
    assert onboarding.main(args) == 0

    assert json.loads((cfg / "config.json").read_text()) == {
        "repo_path": str(tmp_path / "me"), "github_owner": "sam"}
    manifest = json.loads((cfg / "spaces/apex-roofing/.selfhub/space.json").read_text())
    assert (manifest["name"], manifest["kind"]) == ("Apex Roofing", "client")
    registry = json.loads((cfg / "spaces.json").read_text())
    assert [s["name"] for s in registry["spaces"]] == ["Apex Roofing"]
    assert (tmp_path / "me/.git").exists()

    before = _snapshot(tmp_path)
    assert onboarding.main(args) == 0
    assert _snapshot(tmp_path) == before


def test_onboarding_never_replaces_space_json_without_permission(cfg: Path, tmp_path: Path) -> None:
    me = ["--yes", "--personal-path", str(tmp_path / "me")]
    space = tmp_path / "apex"
    assert onboarding.main([*me, "--space-name", "Apex", "--space-kind", "client",
                            "--space-path", str(space)]) == 0
    original = (space / ".selfhub/space.json").read_text()

    assert onboarding.main([*me, "--space-name", "Apex", "--space-kind", "team",
                            "--space-path", str(space)]) == 0
    assert (space / ".selfhub/space.json").read_text() == original

    assert onboarding.main([*me, "--space-name", "Apex", "--space-kind", "team",
                            "--space-path", str(space), "--replace"]) == 0
    assert json.loads((space / ".selfhub/space.json").read_text())["kind"] == "team"
    log = subprocess.run(["git", "-C", str(space), "log", "--format=%s"],
                         capture_output=True, text=True, check=True).stdout
    assert "[SelfHub] set up team space Apex" in log


def test_onboarding_leaves_an_unrelated_folder_alone(cfg: Path, tmp_path: Path) -> None:
    folder = tmp_path / "taxes"
    folder.mkdir()
    (folder / "2025.pdf").write_text("x")
    assert onboarding.main(["--yes", "--personal-path", str(folder), "--no-space"]) == 1
    assert not (folder / ".git").exists()
    assert not (cfg / "config.json").exists()


def test_onboarding_keeps_an_existing_personal_repo_untouched(cfg: Path, tmp_path: Path) -> None:
    me = tmp_path / "me"
    subprocess.run(["git", "init", "-q", str(me)], check=True)
    (me / "draft.md").write_text("unsaved thoughts")
    assert onboarding.main(["--yes", "--personal-path", str(me), "--no-space"]) == 0
    status = subprocess.run(["git", "-C", str(me), "status", "--porcelain"],
                            capture_output=True, text=True, check=True).stdout
    assert "?? draft.md" in status  # not committed behind the user's back


# ---------- scripts/setup.sh prerequisite checks ----------


FAKE_GH_LOGGED_OUT = (
    '#!/bin/sh\ncase "$1" in\n  --version) echo "gh version 2.65.0 (fake)";;\n'
    '  *) echo "You are not logged into any GitHub hosts." >&2; exit 1;;\nesac\n'
)


def _bin_without_gh(
    tmp_path: Path, gh_script: str | None = None, tools: tuple[str, ...] = ("git", "uv")
) -> str:
    """A PATH with only the given real tools, and no gh (or a fake gh)."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for tool in tools:
        found = shutil.which(tool)
        assert found, f"{tool} is needed to run this test"
        (bin_dir / tool).symlink_to(found)
    if gh_script is not None:
        gh = bin_dir / "gh"
        gh.write_text(gh_script)
        gh.chmod(0o755)
    return f"{bin_dir}:/usr/bin:/bin:/usr/sbin:/sbin"


def _setup_cmd(tmp_path: Path) -> tuple[list[str], dict[str, str]]:
    env = {k: v for k, v in os.environ.items() if k not in {"GH_TOKEN", "GITHUB_TOKEN"}}
    env["GH_CONFIG_DIR"] = str(tmp_path / "gh-config")
    cmd = ["bash", str(SETUP), "--skip-install", "--no-dashboard",
           "--config-dir", str(tmp_path / "cfg"), "--personal-path", str(tmp_path / "me"),
           "--space-name", "Apex", "--space-kind", "client",
           "--space-path", str(tmp_path / "cfg/spaces/apex")]
    return cmd, env


def _run_setup(tmp_path: Path, path: str) -> subprocess.CompletedProcess[str]:
    cmd, env = _setup_cmd(tmp_path)
    env["PATH"] = path
    return subprocess.run(cmd + ["--yes"], capture_output=True, text=True, env=env,
                          stdin=subprocess.DEVNULL, timeout=120)


def _assert_finished_local_only(tmp_path: Path, out: str) -> None:
    assert "SelfHub is set up." in out
    assert "your spaces are only on this computer for now" in out
    assert "Optional: connect GitHub later" in out
    assert "It's free." in out and "https://github.com/signup" in out
    assert "What it's for: backing up your spaces and sharing them with your team." in out
    assert "copy from here" in out and "copy to here" in out
    assert f'bash "{SETUP}"' in out
    assert "Space 'Apex': Only on this computer" in out
    assert "needs a GitHub account" not in out
    assert (tmp_path / "cfg/spaces/apex/.selfhub/space.json").exists()


def test_setup_finishes_without_gh(tmp_path: Path) -> None:
    result = _run_setup(tmp_path, _bin_without_gh(tmp_path))
    out = result.stdout
    assert result.returncode == 0, out + result.stderr
    assert "[skipped]  GitHub CLI (gh) is not installed" in out
    assert "Install it: " in out
    _assert_finished_local_only(tmp_path, out)


def test_setup_finishes_logged_out_when_input_is_closed(tmp_path: Path) -> None:
    result = _run_setup(tmp_path, _bin_without_gh(tmp_path, FAKE_GH_LOGGED_OUT))
    out = result.stdout
    assert result.returncode == 0, out + result.stderr
    assert "[ok]       GitHub CLI (gh) 2.65.0" in out
    assert "[skipped]  Not logged in to GitHub" in out
    assert "Install whatever is missing" not in out  # only the login is missing
    _assert_finished_local_only(tmp_path, out)


def test_setup_finishes_logged_out_when_user_says_no(tmp_path: Path) -> None:
    cmd, env = _setup_cmd(tmp_path)
    env["PATH"] = _bin_without_gh(tmp_path, FAKE_GH_LOGGED_OUT)
    leader, follower = pty.openpty()
    proc = subprocess.Popen(cmd, stdin=follower, stdout=follower, stderr=follower, env=env,
                            start_new_session=True)
    os.close(follower)
    out = b""
    answered = False
    while True:
        ready, _, _ = select.select([leader], [], [], 60)
        assert ready, out.decode()
        try:
            chunk = os.read(leader, 4096)
        except OSError:  # the script finished and closed the terminal
            break
        if not chunk:
            break
        out += chunk
        if not answered and b"Log in to GitHub now? [Y/n]" in out:
            os.write(leader, b"n\n")
            answered = True
    os.close(leader)
    text = out.decode().replace("\r", "")
    assert proc.wait(timeout=60) == 0, text
    assert answered
    _assert_finished_local_only(tmp_path, text)


def test_setup_stops_when_a_required_tool_is_missing(tmp_path: Path) -> None:
    result = _run_setup(tmp_path, _bin_without_gh(tmp_path, tools=("git",)))  # no uv
    out = result.stdout
    assert result.returncode == 1, out
    assert "[missing]  uv is not installed" in out
    assert "Setup can't continue yet." in out
    assert "Optional, while you're at it: connect GitHub." in out
    assert "copy from here" in out
    assert not (tmp_path / "cfg").exists()  # nothing written before the checks pass


def test_local_only_space_is_never_pushed(cfg: Path, tmp_path: Path) -> None:
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True)
    space = tmp_path / "apex"
    subprocess.run(["git", "clone", "-q", str(remote), str(space)], check=True,
                   capture_output=True)
    assert onboarding.main(["--yes", "--local-only", "--personal-path", str(tmp_path / "me"),
                            "--space-name", "Apex", "--space-kind", "client",
                            "--space-path", str(space)]) == 0
    assert (space / ".selfhub/space.json").exists()
    pushed = subprocess.run(["git", "-C", str(remote), "rev-parse", "--verify", "-q", "HEAD"],
                            capture_output=True, text=True)
    assert pushed.returncode != 0  # nothing reached the remote
