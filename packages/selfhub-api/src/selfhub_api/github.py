"""Who can see and change each space, as GitHub says.

The dashboard never keeps its own permission system: every role comes from a
GitHubProvider. Two implementations:

- FixtureGitHubProvider: an in-memory org (people, teams, repo grants) loaded from a
  JSON file. Used in demo mode; changes are saved back to the same file.
- GhGitHubProvider: the real thing, through the `gh` CLI (`gh api ...`). Reads run
  freely. Writes (set role, invite, remove) only run when the API receives an explicit
  request to make that change.
"""

from __future__ import annotations

import getpass
import json
import re
import shutil
import subprocess
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

ROLES: tuple[str, ...] = ("read", "write", "admin")
_RANK = {"none": 0, "read": 1, "write": 2, "admin": 3}


class ProviderError(RuntimeError):
    def __init__(self, code: str, message: str, hint: str | None = None, status: int = 409,
                 technical: str | None = None):
        super().__init__(technical or message)
        self.code = code
        self.message = message
        self.hint = hint
        self.status = status
        self.technical = technical


@dataclass(frozen=True, slots=True)
class RepoRef:
    owner: str
    name: str

    @property
    def full_name(self) -> str:
        return f"{self.owner}/{self.name}"

    @property
    def url(self) -> str:
        return f"https://github.com/{self.owner}/{self.name}"


@dataclass(slots=True)
class Person:
    login: str
    name: str
    avatar_url: str
    title: str | None = None
    email: str | None = None


@dataclass(slots=True)
class Member:
    login: str
    name: str
    avatar_url: str
    role: str
    via: str  # "direct" | "team"
    team: str | None = None
    pending: bool = False  # invited, hasn't accepted yet (demo only)


@dataclass(slots=True)
class Team:
    slug: str
    name: str
    members: list[str] = field(default_factory=list)


@dataclass(slots=True)
class PullRequest:
    number: int
    title: str
    url: str
    author: str
    branch: str


class GitHubProvider(Protocol):
    mode: str

    def me(self) -> Person: ...

    def org(self) -> tuple[str, str | None]: ...

    def people(self) -> list[Person]: ...

    def teams(self) -> list[Team]: ...

    def members(self, repo: RepoRef) -> list[Member]: ...

    def role(self, repo: RepoRef, login: str) -> str: ...

    def set_role(self, repo: RepoRef, login: str, role: str) -> None: ...

    def invite(self, repo: RepoRef, login: str, role: str) -> None: ...

    def remove(self, repo: RepoRef, login: str) -> None: ...

    def open_prs(self, repo: RepoRef) -> list[PullRequest]: ...

    def register_repo(self, repo: RepoRef, creator: str) -> None: ...

    def has_repo(self, repo: RepoRef) -> bool: ...


_LABEL = {"read": "Can view", "write": "Can edit", "admin": "Admin", "none": "No access"}


def max_role(*roles: str) -> str:
    return max(roles, key=lambda r: _RANK.get(r, 0)) if roles else "none"


def parse_github_remote(url: str | None) -> RepoRef | None:
    if not url:
        return None
    match = re.search(r"github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?/?$", url.strip())
    if not match:
        return None
    return RepoRef(owner=match.group(1), name=match.group(2))


def check_role(role: str) -> str:
    if role not in ROLES:
        raise ProviderError("invalid-role", "Pick Can view, Can edit or Admin.", status=400,
                            technical=f"role must be one of: {', '.join(ROLES)}")
    return role


# ---------- demo ----------


class FixtureGitHubProvider:
    """A fake GitHub org that behaves like the real one: roles come from direct grants
    and team grants, and the effective role is the highest of them."""

    mode = "demo"

    def __init__(self, path: Path, avatar_base: str, acting_as: str | None = None) -> None:
        self.path = path
        self.avatar_base = avatar_base.rstrip("/")
        self._lock = threading.Lock()
        self.data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        self.acting_as = acting_as or str(self.data["me"])

    def as_user(self, login: str) -> FixtureGitHubProvider:
        """The same org, seen by another person (demo only: the 'view as' switch)."""
        clone = FixtureGitHubProvider.__new__(FixtureGitHubProvider)
        clone.path, clone.avatar_base, clone._lock = self.path, self.avatar_base, self._lock
        clone.data, clone.acting_as = self.data, login
        return clone

    def avatar(self, login: str) -> str:
        return f"{self.avatar_base}/api/avatars/{login}.svg"

    def me(self) -> Person:
        person = self._person(self.acting_as)
        if person is None:
            raise ProviderError("unknown-user", f"No person '{self.acting_as}' in the demo org.",
                                status=400)
        return person

    def org(self) -> tuple[str, str | None]:
        org = self.data["org"]
        return str(org["name"]), self.avatar(str(org["login"]))

    def people(self) -> list[Person]:
        return [self._to_person(p) for p in self.data["people"]]

    def teams(self) -> list[Team]:
        return [Team(slug=t["slug"], name=t["name"], members=list(t["members"]))
                for t in self.data["teams"]]

    def members(self, repo: RepoRef) -> list[Member]:
        grants = self._repo(repo)
        out: list[Member] = []
        for login in self._logins_with_access(grants):
            role, via, team = self._effective(grants, login)
            person = self._person(login) or Person(login, login, self.avatar(login))
            pending = via == "direct" and login in grants.get("invited", [])
            out.append(Member(login, person.name, person.avatar_url, role, via, team, pending))
        out.sort(key=lambda m: (-_RANK[m.role], m.name.lower()))
        return out

    def role(self, repo: RepoRef, login: str) -> str:
        grants = self.data["repos"].get(repo.full_name)
        if grants is None:
            return "none"
        return self._effective(grants, login)[0]

    def set_role(self, repo: RepoRef, login: str, role: str) -> None:
        check_role(role)
        with self._lock:
            grants = self._repo(repo)
            if self._effective(grants, login)[0] == "none":
                raise ProviderError("not-member", f"{self._name(login)} doesn't have access to "
                                    "this space.", "Invite them first.", status=404)
            self._check_team_floor(grants, login, role)
            grants.setdefault("direct", {})[login] = role
            self._save()

    def invite(self, repo: RepoRef, login: str, role: str) -> None:
        check_role(role)
        with self._lock:
            grants = self._repo(repo)
            if self._effective(grants, login)[0] != "none":
                raise ProviderError("already-member", f"{self._name(login)} already has access.",
                                    "Change their access below instead.")
            if self._person(login) is None:
                self.data["people"].append({"login": login, "name": login,
                                            "title": "Outside collaborator"})
            grants.setdefault("direct", {})[login] = role
            invited = grants.setdefault("invited", [])
            if login not in invited:
                invited.append(login)
            self._save()

    def remove(self, repo: RepoRef, login: str) -> None:
        with self._lock:
            grants = self._repo(repo)
            direct = grants.setdefault("direct", {})
            team_role, team = self._team_role(grants, login)
            if team_role != "none":
                raise ProviderError(
                    "via-team",
                    f"{self._name(login)} has {_LABEL[team_role]} access through the {team} "
                    "team, so it can't be removed here.",
                    f"Remove them from the {team} team on GitHub, or change that team's access.",
                )
            if login not in direct:
                raise ProviderError("not-member", f"{self._name(login)} doesn't have access to "
                                    "this space.", status=404)
            del direct[login]
            if login in grants.get("invited", []):
                grants["invited"].remove(login)
            self._save()

    def open_prs(self, repo: RepoRef) -> list[PullRequest]:
        pulls = self.data.get("pulls", {}).get(repo.full_name, [])
        return [PullRequest(int(p["number"]), str(p["title"]), str(p["url"]), str(p["author"]),
                            str(p["branch"])) for p in pulls]

    def has_repo(self, repo: RepoRef) -> bool:
        return repo.full_name in self.data["repos"]

    def register_repo(self, repo: RepoRef, creator: str) -> None:
        with self._lock:
            if repo.full_name not in self.data["repos"]:
                self.data["repos"][repo.full_name] = {"teams": {"admins": "admin"},
                                                      "direct": {creator: "admin"}}
                self._save()

    # ---------- helpers ----------

    def _repo(self, repo: RepoRef) -> dict[str, Any]:
        grants: dict[str, Any] | None = self.data["repos"].get(repo.full_name)
        if grants is None:
            raise ProviderError("unknown-repo", "This space isn't set up in the demo company "
                                "on GitHub.", status=404)
        return grants

    def _logins_with_access(self, grants: dict[str, Any]) -> list[str]:
        logins = set(grants.get("direct", {}))
        for team in self.teams():
            if team.slug in grants.get("teams", {}):
                logins.update(team.members)
        return sorted(logins)

    def _team_role(self, grants: dict[str, Any], login: str) -> tuple[str, str | None]:
        best, best_team = "none", None
        for team in self.teams():
            role = grants.get("teams", {}).get(team.slug)
            if role and login in team.members and _RANK[role] > _RANK[best]:
                best, best_team = role, team.name
        return best, best_team

    def _effective(self, grants: dict[str, Any], login: str) -> tuple[str, str, str | None]:
        direct = grants.get("direct", {}).get(login, "none")
        team_role, team = self._team_role(grants, login)
        if _RANK[direct] >= _RANK[team_role] and direct != "none":
            return direct, "direct", None
        if team_role != "none":
            return team_role, "team", team
        return "none", "direct", None

    def _check_team_floor(self, grants: dict[str, Any], login: str, role: str) -> None:
        team_role, team = self._team_role(grants, login)
        if _RANK[team_role] > _RANK[role]:
            raise ProviderError(
                "via-team",
                f"{self._name(login)} gets {_LABEL[team_role]} access through the {team} team, "
                f"so it can't go lower than {_LABEL[team_role]} here.",
                f"Change the {team} team's access on GitHub, or remove them from that team.",
            )

    def _name(self, login: str) -> str:
        person = self._person(login)
        return person.name if person else login

    def _person(self, login: str) -> Person | None:
        for raw in self.data["people"]:
            if raw["login"] == login:
                return self._to_person(raw)
        return None

    def _to_person(self, raw: dict[str, Any]) -> Person:
        return Person(login=raw["login"], name=raw.get("name") or raw["login"],
                      avatar_url=self.avatar(raw["login"]), title=raw.get("title"),
                      email=raw.get("email"))

    def _save(self) -> None:
        self.path.write_text(json.dumps(self.data, indent=2) + "\n", encoding="utf-8")


# ---------- real GitHub through `gh` ----------

GhRunner = Callable[[list[str]], Any]

_GH_PERMISSION = {"read": "pull", "write": "push", "admin": "admin"}


def run_gh(args: list[str]) -> Any:
    if shutil.which("gh") is None:
        raise ProviderError("gh-missing", "SelfHub can't reach GitHub from this computer: the "
                            "GitHub command-line app isn't installed.",
                            "Install GitHub CLI from cli.github.com and sign in to GitHub "
                            "with it.", status=503)
    process = subprocess.run(["gh", *args], check=False, capture_output=True, text=True)
    if process.returncode != 0:
        details = process.stderr.strip() or process.stdout.strip() or "gh failed"
        raise ProviderError("github", "GitHub didn't accept that request.",
                            "Check that you're signed in to GitHub on this computer and can "
                            "access this space.", status=502, technical=details)
    out = process.stdout.strip()
    return json.loads(out) if out else None


def _to_role(raw: dict[str, Any] | None) -> str:
    """GitHub has five repo roles; the dashboard shows three."""
    if not raw:
        return "none"
    name = str(raw.get("role_name") or raw.get("permission") or "").lower()
    if name in {"admin", "maintain"}:
        return "admin"
    if name in {"write", "push"}:
        return "write"
    if name in {"read", "pull", "triage"}:
        return "read"
    perms = raw.get("permissions") or {}
    if perms.get("admin") or perms.get("maintain"):
        return "admin"
    if perms.get("push"):
        return "write"
    if perms.get("pull") or perms.get("triage"):
        return "read"
    return "none"


class GhGitHubProvider:
    mode = "local"

    def __init__(self, org_login: str | None = None, runner: GhRunner = run_gh) -> None:
        self.run = runner
        self.org_login = org_login
        self._me: Person | None = None

    def _api(self, path: str, *extra: str, paginate: bool = False) -> Any:
        args = ["api", path, *extra]
        if paginate:
            args[2:2] = ["--paginate", "--slurp"]
        data = self.run(args)
        if paginate and isinstance(data, list):
            return [item for page in data for item in (page if isinstance(page, list) else [])]
        return data

    def me(self) -> Person:
        if self._me is None:
            try:
                raw = self._api("user")
            except ProviderError:
                # No GitHub CLI (gh), or not logged in: the dashboard still opens, as the
                # person on this computer, so they can see their spaces and connect them.
                return _local_person()
            self._me = Person(raw["login"], raw.get("name") or raw["login"],
                              raw.get("avatar_url") or f"https://github.com/{raw['login']}.png",
                              email=raw.get("email"))
        return self._me

    @property
    def signed_in(self) -> bool:
        """Whether `me()` is the GitHub account, not the fallback person on this computer."""
        self.me()
        return self._me is not None

    def org(self) -> tuple[str, str | None]:
        if not self.org_login:
            me = self.me()
            return me.name, me.avatar_url
        try:
            raw = self._api(f"orgs/{self.org_login}")
        except ProviderError:
            try:
                raw = self._api(f"users/{self.org_login}")
            except ProviderError:
                return self.org_login, None
        return str(raw.get("name") or raw["login"]), raw.get("avatar_url")

    def people(self) -> list[Person]:
        if not self.org_login:
            return [self.me()]
        try:
            raw = self._api(f"orgs/{self.org_login}/members?per_page=100", paginate=True)
        except ProviderError:
            return [self.me()]
        return [Person(p["login"], p["login"], p.get("avatar_url") or "") for p in raw]

    def teams(self) -> list[Team]:
        if not self.org_login:
            return []
        try:
            raw = self._api(f"orgs/{self.org_login}/teams?per_page=100", paginate=True)
        except ProviderError:
            return []
        teams = []
        for t in raw:
            members = self._api(f"orgs/{self.org_login}/teams/{t['slug']}/members?per_page=100",
                                paginate=True)
            teams.append(Team(t["slug"], t["name"], [m["login"] for m in members]))
        return teams

    def members(self, repo: RepoRef) -> list[Member]:
        everyone = self._api(f"repos/{repo.full_name}/collaborators?affiliation=all&per_page=100",
                             paginate=True)
        direct = {c["login"] for c in self._api(
            f"repos/{repo.full_name}/collaborators?affiliation=direct&per_page=100",
            paginate=True)}
        team_of: dict[str, str] = {}
        try:
            for t in self._api(f"repos/{repo.full_name}/teams?per_page=100", paginate=True):
                members = self._api(f"orgs/{repo.owner}/teams/{t['slug']}/members?per_page=100",
                                    paginate=True)
                for m in members:
                    team_of.setdefault(m["login"], t["name"])
        except ProviderError:
            pass
        out = []
        for c in everyone:
            login = c["login"]
            via_team = login not in direct and login in team_of
            out.append(Member(login, login, c.get("avatar_url") or "", _to_role(c),
                              "team" if via_team else "direct",
                              team_of.get(login) if via_team else None))
        return out

    def role(self, repo: RepoRef, login: str) -> str:
        try:
            raw = self._api(f"repos/{repo.full_name}/collaborators/{login}/permission")
        except ProviderError:
            return "none"
        return _to_role(raw.get("user") or raw) if raw else "none"

    def set_role(self, repo: RepoRef, login: str, role: str) -> None:
        check_role(role)
        self._api(f"repos/{repo.full_name}/collaborators/{login}", "-X", "PUT",
                  "-f", f"permission={_GH_PERMISSION[role]}")

    def invite(self, repo: RepoRef, login: str, role: str) -> None:
        self.set_role(repo, login, role)

    def remove(self, repo: RepoRef, login: str) -> None:
        self._api(f"repos/{repo.full_name}/collaborators/{login}", "-X", "DELETE")

    def open_prs(self, repo: RepoRef) -> list[PullRequest]:
        raw = self._api(f"repos/{repo.full_name}/pulls?state=open&per_page=100", paginate=True)
        return [PullRequest(p["number"], p["title"], p["html_url"], p["user"]["login"],
                            p["head"]["ref"]) for p in raw]

    def register_repo(self, repo: RepoRef, creator: str) -> None:
        return None

    def has_repo(self, repo: RepoRef) -> bool:
        try:
            self._api(f"repos/{repo.full_name}")
        except ProviderError:
            return False
        return True


def _local_person() -> Person:
    login = getpass.getuser()
    try:
        name = subprocess.run(["git", "config", "--global", "user.name"], check=False,
                              capture_output=True, text=True).stdout.strip()
    except OSError:
        name = ""
    return Person(login, name or login, "")
