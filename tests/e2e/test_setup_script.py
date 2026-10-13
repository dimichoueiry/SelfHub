import json
import os
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


def _bin_without_gh(tmp_path: Path, gh_script: str | None = None) -> str:
    """A PATH with the real tools setup.sh needs, minus gh (or with a fake gh)."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for tool in ("git", "uv", "node", "pnpm", "corepack"):
        found = shutil.which(tool)
        if found:
            (bin_dir / tool).symlink_to(found)
    if gh_script is not None:
        gh = bin_dir / "gh"
        gh.write_text(gh_script)
        gh.chmod(0o755)
    return f"{bin_dir}:/usr/bin:/bin:/usr/sbin:/sbin"


def _run_setup(tmp_path: Path, path: str) -> subprocess.CompletedProcess[str]:
    env = {k: v for k, v in os.environ.items() if k not in {"GH_TOKEN", "GITHUB_TOKEN"}}
    env.update(PATH=path, GH_CONFIG_DIR=str(tmp_path / "gh-config"))
    return subprocess.run(
        ["bash", str(SETUP), "--yes", "--skip-install", "--no-dashboard",
         "--config-dir", str(tmp_path / "cfg"), "--personal-path", str(tmp_path / "me")],
        capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL, timeout=120,
    )


def test_setup_script_guides_a_user_without_gh(tmp_path: Path) -> None:
    result = _run_setup(tmp_path, _bin_without_gh(tmp_path))
    out = result.stdout
    assert result.returncode == 1, out
    assert "[missing]  GitHub CLI (gh) is not installed" in out
    assert "https://github.com/signup" in out
    assert "copy from here" in out and "copy to here" in out
    assert f'bash "{SETUP}"' in out
    assert "gh auth login --hostname github.com --git-protocol https --web" in out
    assert not (tmp_path / "cfg").exists()  # nothing written before the checks pass


def test_setup_script_guides_a_logged_out_user(tmp_path: Path) -> None:
    fake_gh = '#!/bin/sh\ncase "$1" in\n  --version) echo "gh version 2.65.0 (fake)";;\n' \
              '  *) echo "You are not logged into any GitHub hosts." >&2; exit 1;;\nesac\n'
    result = _run_setup(tmp_path, _bin_without_gh(tmp_path, fake_gh))
    out = result.stdout
    assert result.returncode == 1, out
    assert "[ok]       GitHub CLI (gh) 2.65.0" in out
    assert "[missing]  Not logged in to GitHub" in out
    assert "https://github.com/signup" in out
    assert "- Not logged in to GitHub with the GitHub CLI (gh)" in out
    assert "Install whatever is missing" not in out  # only the login is missing
    assert f'bash "{SETUP}"' in out
