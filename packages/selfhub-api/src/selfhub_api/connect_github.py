"""Put a space that is only on this computer onto GitHub, through the `gh` CLI.

`check()` says whether that can happen here: is the GitHub CLI (gh) installed, and is it
logged in? `create_and_push()` runs `gh repo create <owner>/<name> --source <folder>
--push`. Neither ever reads or writes gh's own config; gh does that itself.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

VISIBILITIES = ("private", "public")
REPO_NAME = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
OWNER_NAME = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
_TIMEOUT = 120


@dataclass(slots=True)
class GhCheck:
    problem: str | None  # None | "gh-missing" | "logged-out"
    login: str | None = None
    orgs: list[str] = field(default_factory=list)

    @property
    def ready(self) -> bool:
        return self.problem is None


@dataclass(slots=True)
class CreateResult:
    ok: bool
    taken: bool = False
    url: str | None = None
    technical: str = ""


def _gh(*args: str, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["gh", *args], cwd=cwd, check=False, capture_output=True, text=True,
                          timeout=_TIMEOUT)


def installed() -> bool:
    return shutil.which("gh") is not None


def check() -> GhCheck:
    if not installed():
        return GhCheck("gh-missing")
    if _gh("auth", "status", "--hostname", "github.com").returncode != 0:
        return GhCheck("logged-out")
    user = _gh("api", "user", "--jq", ".login")
    login = user.stdout.strip()
    if user.returncode != 0 or not login:
        return GhCheck("logged-out")
    orgs = _gh("api", "user/orgs", "--jq", ".[].login")
    names = [o for o in orgs.stdout.split() if o] if orgs.returncode == 0 else []
    return GhCheck(None, login, names)


def create_and_push(path: Path, owner: str, name: str, visibility: str) -> CreateResult:
    done = _gh("repo", "create", f"{owner}/{name}", f"--{visibility}", "--source", str(path),
               "--remote", "origin", "--push", cwd=path)
    output = (done.stderr.strip() or done.stdout.strip())
    if done.returncode != 0:
        return CreateResult(False, taken="already exists" in output.lower(), technical=output)
    url = next((w for w in done.stdout.split() if w.startswith("https://github.com/")), None)
    return CreateResult(True, url=url.rstrip("/") if url else None, technical=output)
