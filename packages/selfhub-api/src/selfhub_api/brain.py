"""The dashboard's view of a company brain, for one person.

A thin adapter: spaces come from `Workspace`, file writes go through `SelfHubService`
(`write_refusal`, then `publish`) via `selfhub_cli.space_files`, rules use
`selfhub_core.rules`, and every role comes from a GitHubProvider. Nothing here shells out
to the `selfhub` CLI. Every git-mutating call holds that space's lock.

All dicts returned here are already in the API's JSON shape (camelCase).
"""

from __future__ import annotations

import logging
import re
import threading
import time
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from selfhub_cli.service import SelfHubService
from selfhub_cli.space_files import (
    SpaceFileError,
    WriteOutcome,
    delete_file,
    move_file,
    safe_rel_path,
    search_spaces,
    tree,
    write_file,
)
from selfhub_cli.workspace import Workspace
from selfhub_core.git_ops import (
    GitCommandError,
    commit,
    current_branch,
    current_head,
    has_remote,
    has_staged_changes,
    init_repo,
    pull,
    push,
    run_git,
)
from selfhub_core.history import (
    CommitInfo,
    RepoStatus,
    branches_containing,
    commits,
    fetch,
    file_blob_sha,
    last_commit,
    repo_status,
    show_patch,
    stage_paths,
)
from selfhub_core.rules import Rule, RuleError, append_rule, read_rules, stamp, take_rule
from selfhub_core.spaces import (
    CODEOWNERS_PATH,
    MANIFEST_PATH,
    RULES_LEARNED,
    RULES_PROPOSED,
    SHARED_KINDS,
    WRITE_POLICIES,
    Space,
    is_locked,
    load_manifest,
    personal_manifest,
    slug,
    write_manifest,
)

from selfhub_api import connect_github
from selfhub_api.errors import ApiError, from_file_error, from_provider_error
from selfhub_api.github import (
    GitHubProvider,
    Member,
    Person,
    ProviderError,
    RepoRef,
    check_role,
    parse_github_remote,
)
from selfhub_api.store import Store, now_iso
from selfhub_api.text import (
    display_message,
    file_format,
    file_name,
    from_people,
    is_auto_message,
    is_system_path,
    parse_patch,
    plain_snippet,
    plural,
    role_label,
    rule_commit,
)

log = logging.getLogger("selfhub_api")

RULES_REJECTED = "rules/rejected.md"
PERSONAL_ID = "me"
_SHA = re.compile(r"^[0-9a-f]{4,40}$")
_STAMP = re.compile(r"^(.*?)\s*\((\d{4}-\d{2}-\d{2})\)\s*$")
_NOREPLY = re.compile(r"^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$")


class RepoFacts:
    """A short-lived cache of each clone's git status and file count, shared by every
    request. Facts don't depend on who is asking. Every git-mutating call holds the
    space lock, and releasing that lock drops the cached facts, so the API never serves
    its own stale writes; only edits made outside the API can take up to `ttl` to show."""

    def __init__(self, ttl: float = 3.0) -> None:
        self.ttl = ttl
        self._guard = threading.Lock()
        self._facts: dict[str, tuple[float, RepoStatus | None, int]] = {}

    def get(self, path: Path) -> tuple[RepoStatus | None, int]:
        key = str(path.resolve())
        with self._guard:
            hit = self._facts.get(key)
        if hit and time.monotonic() - hit[0] < self.ttl:
            return hit[1], hit[2]
        stamp = time.monotonic()
        status = repo_status(path)
        files = _file_count(path)
        with self._guard:
            self._facts[key] = (stamp, status, files)
        return status, files

    def warm(self, paths: list[Path]) -> None:
        """Fill the cache for many clones at once; git calls run in parallel."""
        if len(paths) > 1:
            with ThreadPoolExecutor(max_workers=min(8, len(paths))) as pool:
                list(pool.map(self.get, paths))

    def drop(self, path: Path) -> None:
        with self._guard:
            self._facts.pop(str(path.resolve()), None)


class SpaceLocks:
    """One lock per space repo, shared by every request."""

    def __init__(self) -> None:
        self._guard = threading.Lock()
        self._locks: dict[str, threading.Lock] = {}
        self.facts = RepoFacts()

    @contextmanager
    def hold(self, path: Path) -> Iterator[None]:
        key = str(path.resolve())
        with self._guard:
            lock = self._locks.setdefault(key, threading.Lock())
        with lock:
            try:
                yield
            finally:
                self.facts.drop(path)


@dataclass(slots=True)
class Context:
    """Everything shared across requests."""

    workspace: Workspace
    store: Store
    locks: SpaceLocks
    mode: str  # "demo" | "local"
    # Demo mode writes each commit as the person acting, via repo-local git config.
    commit_as_viewer: bool = False
    spaces_dir: Path | None = None


@dataclass(slots=True)
class Brain:
    ctx: Context
    gh: GitHubProvider
    _roles: dict[str, str] = field(default_factory=dict)
    _members: dict[str, list[Member]] = field(default_factory=dict)
    _people: list[Person] | None = None
    _titles: dict[str, dict[str, str]] = field(default_factory=dict)

    # ---------- who ----------

    def me(self) -> dict[str, Any]:
        me = self.gh.me()
        org_name, org_avatar = self.gh.org()
        return {
            "login": me.login,
            "name": me.name,
            "avatarUrl": me.avatar_url,
            "title": me.title,
            "mode": self.ctx.mode,
            "org": {"name": org_name, "avatarUrl": org_avatar},
        }

    def people(self) -> dict[str, Any]:
        people = self._all_people()
        shared = [s for s in self._spaces() if s.kind != "personal"]
        access: dict[str, dict[str, str]] = {p.login: {} for p in people}
        for space in shared:
            sid = space_id(space)
            roles = {m.login: m.role for m in self._space_members(space)}
            for login in access:
                access[login][sid] = roles.get(login, "none")
        return {
            "people": [
                {"login": p.login, "name": p.name, "avatarUrl": p.avatar_url, "title": p.title}
                for p in people
            ],
            "spaces": [{"id": space_id(s), "name": s.name, "kind": s.kind,
                        "myAccess": self.access(s), "owners": self._owners(s)} for s in shared],
            "access": access,
        }

    # ---------- spaces ----------

    def list_spaces(self) -> list[dict[str, Any]]:
        every, _ = self.ctx.workspace.spaces()
        self.ctx.locks.facts.warm([s.path for s in every])
        return [self.space_json(s) for s in self._spaces()]

    def get_space(self, sid: str) -> dict[str, Any]:
        return self.space_json(self._space(sid))

    def space_json(self, space: Space) -> dict[str, Any]:
        sid = space_id(space)
        repo = self._repo(space)
        status, files = self.ctx.locks.facts.get(space.path)
        head = status.head if status else None
        meta = self.ctx.store.space(sid)
        personal = self.ctx.store.personal()
        if space.kind == "personal":
            name = str(personal.get("name") or "My space")
            description = str(personal.get("description") or "Your own workflows and notes.")
        else:
            name = space.name
            description = str(meta.get("description") or _default_description(space.kind))
        return {
            "id": sid,
            "name": name,
            "kind": space.kind,
            "description": description,
            "repo": {"owner": repo.owner, "name": repo.name, "url": repo.url} if repo else None,
            "writePolicy": space.manifest.write_policy,
            "defaultBranch": status.branch if status else "main",
            "sync": self._sync_state(space, status),
            "myAccess": self.access(space),
            "owners": self._owners(space),
            "lockedPaths": _locked_paths(space),
            "fileCount": files,
            "memberCount": len(self._space_members(space)),
            "updatedAt": _utc(head.date) if head else None,
        }

    def create_space(
        self,
        name: str,
        kind: str,
        description: str | None,
        owners: list[str] | None,
        write_policy: str | None,
    ) -> dict[str, Any]:
        if kind not in SHARED_KINDS:
            raise ApiError(400, "invalid-kind", f"kind must be one of {', '.join(SHARED_KINDS)}.")
        if write_policy is not None and write_policy not in WRITE_POLICIES:
            raise ApiError(400, "invalid-write-policy",
                           f"writePolicy must be one of {', '.join(WRITE_POLICIES)}.")
        if not name.strip():
            raise ApiError(400, "invalid-name", "A space needs a name.")
        sid = slug(name)
        if any(space_id(s) == sid for s in self._spaces()):
            raise ApiError(409, "exists", f"A space called '{name}' is already connected.")
        base = self.ctx.spaces_dir or (self.ctx.workspace.config_dir / "spaces")
        path = base / sid
        if path.exists() and any(path.iterdir()):
            raise ApiError(409, "exists", f"There's already a folder for '{name.strip()}' on "
                           "this computer.", "Pick another name, or connect that folder "
                           "instead.")
        me = self.gh.me()
        handles = [o if o.startswith("@") else f"@{o}" for o in (owners or [me.login])]
        with self.ctx.locks.hold(path):
            init_repo(path)
            self._set_identity(path)
            result = self.ctx.workspace.create_space(
                path, name.strip(), kind, owners=handles, aliases=[sid]
            )
            if not result.success:
                log.warning("create space failed: %s", result.message)
                raise ApiError(400, "create-failed", "SelfHub couldn't create that space.",
                               "Try a different name.", {"technical": result.message})
            manifest = load_manifest(path)
            if manifest and write_policy and manifest.write_policy != write_policy:
                manifest.write_policy = write_policy
                write_manifest(path, manifest)
                stage_paths(path, [MANIFEST_PATH])
                commit(path, f"[SelfHub] set write policy to {write_policy}", as_user=True)
            if self.ctx.mode == "demo":
                self._add_demo_remote(path, sid)
        self.ctx.store.update_space(sid, description=description, createdAt=now_iso())
        if self.ctx.mode == "demo":
            self._register_demo_repo(sid, me.login)
        self.ctx.store.add_event("space", me.login, sid, f"{me.name} created the {kind} space "
                                 f"{name.strip()}")
        return self.get_space(sid)

    def connect_space(self, source: str, name: str | None) -> dict[str, Any]:
        source = source.strip()
        if not source:
            raise ApiError(400, "invalid-source", "Enter a GitHub link or a folder on this "
                           "computer.")
        remote = "://" in source or source.startswith("git@")
        if not remote:
            folder = Path(source).expanduser()
            if not folder.is_dir():
                raise ApiError(400, "not-found", f"There's no folder at {source}.",
                               "Check the location, or pick a different folder.")
            if load_manifest(folder.resolve()) is None:
                raise ApiError(400, "not-a-space", "This folder isn't a SelfHub space yet.",
                               "Pick a folder that was set up as a SelfHub space, or use "
                               "“Create a new space” to start one.")
        result = self.ctx.workspace.add_space(source, name=name)
        if not result.success:
            log.warning("connect %s failed: %s", source, result.message)
            text = result.message or ""
            if "already" in text.lower():
                raise ApiError(409, "exists", f"A space called '{name or source}' is already "
                               "connected.", "Give it a different name.")
            if remote:
                raise ApiError(400, "connect-failed", "SelfHub couldn't copy that space from "
                               "GitHub.", "Check the link, and that you have access to it.",
                               {"technical": text})
            raise ApiError(400, "connect-failed", "SelfHub couldn't connect that folder.",
                           "Pick a different folder.", {"technical": text})
        data = result.data or {}
        sid = slug(str(data.get("space") or name or source))
        me = self.gh.me()
        if self.ctx.mode == "demo":
            self._register_demo_repo(sid, me.login)
        self.ctx.store.add_event("space", me.login, sid,
                                 f"{me.name} connected {data.get('space') or source}")
        return self.get_space(sid)

    def remove_space(self, sid: str) -> dict[str, Any]:
        space = self._space(sid)
        if space.kind == "personal":
            raise ApiError(400, "personal", "Your personal space can't be disconnected.")
        result = self.ctx.workspace.remove_space(space.name)
        if not result.success:
            raise ApiError(400, "remove-failed", result.message or "Could not disconnect.")
        me = self.gh.me()
        self.ctx.store.add_event("space", me.login, sid,
                                 f"{me.name} disconnected {space.name} (files kept on disk)")
        return {"removed": sid, "path": str(space.path), "message": result.message}

    # ---------- connect to GitHub ----------

    def github_check(self, sid: str) -> dict[str, Any]:
        """Can this computer put the space on GitHub? Also gives the folder's real path,
        for the copy-paste prompt the dashboard offers when it can't."""
        space = self._local_only(sid)
        if self.ctx.mode == "demo":
            me = self.gh.me()
            org = self._org_login()
            found = connect_github.GhCheck(None, me.login, [org] if org != me.login else [])
        else:
            found = connect_github.check()
        owners = ([{"login": found.login, "kind": "user"}] if found.login else []) + [
            {"login": o, "kind": "org"} for o in found.orgs]
        usual = self._usual_owner() if found.ready else None
        return {
            "ready": found.ready,
            "problem": found.problem,
            "login": found.login,
            "owners": owners,
            "defaultOwner": usual if usual in [o["login"] for o in owners] else found.login,
            "suggestedName": _repo_name(space),
            "path": str(space.path.resolve()),
        }

    def connect_github(self, sid: str, owner: str, name: str,
                       visibility: str) -> dict[str, Any]:
        space = self._local_only(sid)
        label = space_label(space)
        owner, name = owner.strip(), name.strip()
        if visibility not in connect_github.VISIBILITIES:
            raise ApiError(400, "invalid-visibility", "Choose Private or Public.")
        if not connect_github.OWNER_NAME.match(owner):
            raise ApiError(400, "invalid-owner", "Choose who will own the repository.")
        if not connect_github.REPO_NAME.match(name) or name in {".", ".."}:
            raise ApiError(400, "invalid-name", "Repository names can only use letters, "
                           "numbers, hyphens (-), underscores (_) and dots.",
                           f"Pick a name like {_repo_name(space)}.")
        path = space.path
        if current_head(path) is None:
            raise ApiError(400, "empty", f"{label} has nothing saved yet, so there's nothing "
                           "to send to GitHub.", "Save a file in it first, then connect it.")
        repo = RepoRef(owner, name)
        me = self.gh.me()
        with self.ctx.locks.hold(path):
            if self.ctx.mode == "demo":
                # A demo space already has a placeholder repo of its own; that one is free.
                if self.gh.has_repo(repo) and repo != self._repo(space):
                    raise self._name_taken(repo)
                self._add_demo_remote(path, sid)
                self.gh.register_repo(repo, me.login)
            else:
                found = connect_github.check()
                if not found.ready:
                    raise _gh_not_ready(found.problem)
                done = connect_github.create_and_push(path, owner, name, visibility)
                if not done.ok:
                    if done.taken:
                        raise self._name_taken(repo)
                    if has_remote(path):  # created, but the files didn't go
                        self.ctx.store.update_space(sid, repo={"owner": owner, "name": name})
                        self.ctx.locks.facts.drop(path)
                        raise ApiError(502, "push-failed", f"SelfHub created {repo.full_name} "
                                       "on GitHub, but couldn't send your files to it yet.",
                                       "Check your internet connection, then use Sync now.",
                                       {"technical": done.technical, "url": repo.url})
                    log.warning("gh repo create %s failed: %s", repo.full_name, done.technical)
                    raise ApiError(502, "create-failed", "GitHub didn't create the "
                                   "repository.", "Check your internet connection and that "
                                   f"your GitHub account can create repositories for {owner}, "
                                   "then try again.", {"technical": done.technical})
        self.ctx.store.update_space(sid, repo={"owner": owner, "name": name},
                                    lastSyncAt=now_iso())
        self.ctx.locks.facts.drop(path)
        self._roles.pop(sid, None)
        self._members.pop(sid, None)
        self.ctx.store.add_event("space", me.login, sid, f"{me.name} connected {label} to "
                                 f"GitHub as {repo.full_name}")
        return {"space": self.get_space(sid),
                "repo": {"owner": owner, "name": name, "url": repo.url}}

    def _local_only(self, sid: str) -> Space:
        """A space only on this computer, that you are an admin of."""
        space = self._readable(sid)
        label = space_label(space)
        if self.access(space) != "admin":
            raise ApiError(403, "forbidden", f"Only admins of {label} can connect it to "
                           "GitHub.", "Ask an admin to connect this space to GitHub.")
        if has_remote(space.path):
            raise ApiError(409, "already-connected", f"{label} is already connected to "
                           "GitHub.", "Use Sync now to send your latest changes.")
        return space

    def _name_taken(self, repo: RepoRef) -> ApiError:
        other = next((f"{repo.name}-{n}" for n in range(2, 7)
                      if not self.gh.has_repo(RepoRef(repo.owner, f"{repo.name}-{n}"))), None)
        return ApiError(409, "name-taken", f"{repo.owner} already has a repository called "
                        f"{repo.name} on GitHub.",
                        f"Try {other}, or pick another name." if other else
                        "Pick another name.", {"suggestion": other} if other else None)

    def _usual_owner(self) -> str | None:
        """Where the company's other spaces live on GitHub, if any."""
        for space in self._spaces():
            repo = self._repo(space)
            if repo:
                return repo.owner
        return None

    def sync(self, sid: str) -> dict[str, Any]:
        space = self._readable(sid)
        path = space.path
        me = self.gh.me()
        incoming: list[CommitInfo] = []
        pushed = 0
        conflict: dict[str, str] | None = None
        with self.ctx.locks.hold(path):
            remote = has_remote(path)
            if not remote:
                result = "up-to-date"
            else:
                try:
                    result, incoming, pushed, before = _sync_repo(path)
                    if result == "conflict" and before is not None:
                        conflict = self._conflict(before)
                except GitCommandError as exc:
                    log.warning("sync of %s failed: %s", path, exc)
                    result = "error"
            after = repo_status(path)
        pulled = len(incoming) if result in {"pulled", "pushed"} else 0
        names = list(dict.fromkeys(
            self._author(c.author_name, c.author_email)["name"] for c in incoming))
        message = _sync_message(result, remote, pulled, names, pushed, conflict)
        unsaved = len(after.changes) if after else 0
        if unsaved and result in {"up-to-date", "pulled", "pushed"}:
            if result == "up-to-date":
                message = "Nothing new on GitHub." if remote else message
            result = "local-changes"
            message += " " + _local_files_text(unsaved, remote)
        if remote and result in {"up-to-date", "pulled", "pushed", "local-changes"}:
            self.ctx.store.update_space(sid, lastSyncAt=now_iso())
        self._log_sync(space, me.name, pulled, names, pushed, result)
        body = {"space": self.space_json(space), "result": result, "message": message,
                "pulled": pulled, "pushed": pushed, "pulledBy": names}
        return body

    def save_local(self, sid: str, message: str) -> dict[str, Any]:
        """Save every unsaved change on this computer as one change, then send it on like
        a normal save would. Refused as a whole if any changed file is locked for you."""
        space = self._space(sid)
        role = self.access(space)
        label = space_label(space)
        path = space.path
        service = self._service(space)
        with self.ctx.locks.hold(path):
            status = repo_status(path)
            changes = status.changes if status else []
            if not changes:
                raise ApiError(422, "no-change", f"Nothing in {label} is waiting to be saved.")
            if role in {"none", "read"}:
                _, reason, code = self._edit_check(space, changes[0].path, role)
                raise ApiError(403, code or "forbidden", reason or "You can't save here.")
            for change in changes:
                editable, _, code = self._edit_check(space, change.path, role)
                refusal = service.write_refusal(change.path)
                if editable and refusal is None:
                    continue
                owners = _either(self._names(self._owners(space))) or "the space owners"
                if code == "read-only" or (space.kind != "personal"
                                           and space.manifest.write_policy == "read-only"):
                    raise ApiError(403, "read-only", f"{label} is set to view-only, so "
                                   "nothing can be saved here.", None, {"path": change.path})
                raise ApiError(
                    403, "locked",
                    f"{change.path} is locked in {label}, so these changes can't be saved. "
                    f"Only {owners} can change it, through a reviewed change. Nothing was "
                    "saved.",
                    f"Undo your edit to {change.path} on this computer, then save the rest. "
                    f"Or ask {owners} to make that change.",
                    {"path": change.path},
                )
            self._set_identity(path)
            before = current_head(path)
            sha: str | None = None
            try:
                service.prepare_write()
                stage_paths(path, [c.path for c in changes])
                if not has_staged_changes(path):
                    raise ApiError(422, "no-change", f"Nothing in {label} is waiting to be saved.")
                sha, note = service.publish(
                    message.strip() or f"Save {plural(len(changes), 'change')} made on this "
                    "computer", failed_push_note="push-failed")
            except GitCommandError as exc:
                log.warning("save-local in %s failed: %s", path, exc)
                raise ApiError(409, "conflict", f"These changes overlap with newer changes on "
                               f"GitHub, so nothing was saved in {label}.",
                               "Sync now, then save again.", {"technical": str(exc)}) from exc
            finally:
                pulled_infos = self._pulled_since(path, before, sha)
            remote = has_remote(path)
            branch = current_branch(path)
        is_pr = space.kind != "personal" and space.manifest.write_policy == "pull-request"
        sent = remote and ("failed" not in (note or "") if is_pr else note is None)
        names = list(dict.fromkeys(
            self._author(c.author_name, c.author_email)["name"] for c in pulled_infos))
        saved = [c.path for c in changes]
        count = plural(len(saved), "change")
        them = _them(len(saved))
        got = f" Got {plural(len(pulled_infos), 'change')}{from_people(names)} first." \
            if pulled_infos else ""
        if is_pr:
            result = "pull-request"
            owners = _either(self._names(self._owners(space))) or "a reviewer"
            become = "It becomes" if len(saved) == 1 else "They become"
            text = (f"Sent {count} for review. {become} part of {label} once {owners} "
                    f"approves {them}." if sent else
                    f"Saved {count} for review on this computer, but sending {them} to GitHub "
                    "failed. Sync now to try again.")
        elif sent:
            result, text = "pushed", f"Saved {count} and sent {them} to GitHub."
        elif remote:
            result, text = "saved", (f"Saved {count} on this computer, but sending {them} to "
                                     "GitHub failed. Sync now to try again.")
        else:
            result, text = "saved", f"Saved {count} on this computer."
        if pulled_infos or (sent and not is_pr):
            self.ctx.store.update_space(sid, lastSyncAt=now_iso())
        info = commits(path, limit=1, rev=sha)[0] if sha else None
        pr_url = None
        if note and "http" in note:
            match = re.search(r"(https?://\S+)", note)
            pr_url = match.group(1) if match else None
        if is_pr:
            branch = next((b for b in branches_containing(path, sha)
                           if b.startswith("selfhub/")), branch) if sha else branch
            me = self.gh.me()
            self.ctx.store.add_event("edit", me.login, sid, f"{me.name} sent {count} in "
                                     f"{label} for review")
        return {
            "space": self.space_json(space), "result": result, "message": text + got,
            "pulled": len(pulled_infos), "pushed": 1 if sent and not is_pr else 0,
            "pulledBy": names, "saved": saved,
            "outcome": "pull-request" if is_pr else "committed",
            "commit": self._commit_json(info, space) if info else None,
            "branch": branch, "prUrl": pr_url,
        }

    def _pulled_since(self, path: Path, before: str | None, own: str | None) -> list[CommitInfo]:
        """Commits a save pulled in on the current branch, excluding the save itself."""
        if before is None:
            return []
        try:
            found = commits(path, limit=500, rev=f"{before}..HEAD")
        except GitCommandError:
            return []
        return [c for c in found if c.sha != own]

    def _log_sync(self, space: Space, who: str, pulled: int, names: list[str], pushed: int,
                  result: str) -> None:
        label = space_label(space)
        parts = []
        if pushed:
            parts.append(f"sent {plural(pushed, 'change')}")
        if pulled:
            parts.append(f"got {plural(pulled, 'change')}{from_people(names)}")
        if parts:
            summary = f"{who} synced {label} and {' and '.join(parts)}"
        elif result == "conflict":
            summary = f"{who} tried to sync {label}, but their changes overlapped with GitHub's"
        else:
            return
        self.ctx.store.add_event("sync", self.gh.me().login, space_id(space), summary)

    # ---------- files ----------

    def tree(self, sid: str) -> list[dict[str, Any]]:
        space = self._readable(sid)
        role = self.access(space)
        out = []
        for entry in tree(space.path):
            check_path = f"{entry.path}/" if entry.type == "dir" else entry.path
            editable, reason, _ = self._edit_check(space, check_path, role)
            item: dict[str, Any] = {
                "path": entry.path,
                "name": entry.name,
                "type": entry.type,
                "locked": is_locked(space.manifest, check_path),
                "editable": editable,
            }
            if reason:
                item["reason"] = reason
            if is_system_path(entry.path):
                item["system"] = True
            if entry.type == "file":
                item["size"] = entry.size
            if entry.updated_at:
                item["updatedAt"] = _utc(entry.updated_at)
                item["updatedBy"] = self._author(entry.updated_by_name or "",
                                                 entry.updated_by_email or "")["login"]
            out.append(item)
        return out

    def read_file(self, sid: str, rel_path: str) -> dict[str, Any]:
        space = self._readable(sid)
        rel = _safe(rel_path)
        target = space.path / rel
        if not target.is_file():
            raise ApiError(404, "not-found", f"{rel} does not exist in {space_label(space)}.")
        return self._file_json(space, rel)

    def write(self, sid: str, rel_path: str, content: str, message: str,
              base_sha: str | None, create: bool) -> dict[str, Any]:
        space = self._space(sid)
        rel = _safe(rel_path)
        self._ensure_writable(space, rel)
        outcome, pulled = self._run_save(
            space, rel, lambda service: write_file(service, rel, content, message,
                                                   base_sha=base_sha, create=create))
        self._log_write(space, rel, "added" if create else "edited", outcome.outcome)
        body = self._outcome_json(space, outcome, pulled)
        if (space.path / rel).is_file():
            body["file"] = self._file_json(space, rel)
        else:  # a new file proposed for review is not in the space yet
            body["file"] = {"path": rel, "content": content, "locked": False, "editable": True,
                            "sha": None, "lastCommit": None, "format": file_format(rel, False)}
        return body

    def delete(self, sid: str, rel_path: str, message: str) -> dict[str, Any]:
        space = self._space(sid)
        rel = _safe(rel_path)
        self._ensure_writable(space, rel)
        outcome, pulled = self._run_save(space, rel,
                                         lambda service: delete_file(service, rel, message))
        self._log_write(space, rel, "deleted", outcome.outcome)
        return self._outcome_json(space, outcome, pulled)

    def move(self, sid: str, from_path: str, to_path: str, message: str) -> dict[str, Any]:
        space = self._space(sid)
        old, new = _safe(from_path), _safe(to_path)
        self._ensure_writable(space, old)
        self._ensure_writable(space, new)
        outcome, pulled = self._run_save(
            space, old, lambda service: move_file(service, old, new, message))
        self._log_write(space, new, f"renamed from {file_name(old)}", outcome.outcome)
        body = self._outcome_json(space, outcome, pulled)
        if (space.path / new).is_file():
            body["file"] = self._file_json(space, new)
        return body

    def _run_save(self, space: Space, rel: str,
                  op: Callable[[SelfHubService], WriteOutcome]
                  ) -> tuple[WriteOutcome, list[CommitInfo]]:
        """Run one file save under the space lock. Records what the save pulled in first,
        and updates lastSyncAt whenever it got or sent anything, even on a conflict."""
        service = self._service(space)
        path = space.path
        sid = space_id(space)
        outcome: WriteOutcome | None = None
        with self.ctx.locks.hold(path):
            self._set_identity(path)
            before = current_head(path)
            try:
                outcome = op(service)
            except SpaceFileError as exc:
                err = from_file_error(exc)
                if exc.code == "conflict":
                    self._explain_conflict(space, rel, err)
                raise err from exc
            finally:
                pulled = self._pulled_since(path, before, outcome.sha if outcome else None)
                pushed = bool(outcome and outcome.outcome == "committed" and outcome.sha
                              and outcome.note is None and has_remote(path))
                if pulled or pushed:
                    self.ctx.store.update_space(sid, lastSyncAt=now_iso())
                if pulled:
                    names = list(dict.fromkeys(
                        self._author(c.author_name, c.author_email)["name"] for c in pulled))
                    self._log_sync(space, self.gh.me().name, len(pulled), names, 0, "pulled")
        return outcome, pulled

    def _explain_conflict(self, space: Space, rel: str, err: ApiError) -> None:
        last = last_commit(space.path, rel)
        if last is None:
            return
        who = self._author(last.author_name, last.author_email)
        me = self.gh.me()
        by = "You" if who["login"] == me.login else who["name"]
        err.message = (f"{rel} changed since you opened it. {by} saved a newer version "
                       f"{_ago(last.date)}.")
        err.hint = "Reload to see the newer version, then make your edit again. Your edit " \
            "wasn't saved."
        err.details = {"path": rel, "byName": who["name"], "byLogin": who["login"]}

    def history(self, sid: str, rel_path: str | None, limit: int) -> list[dict[str, Any]]:
        space = self._readable(sid)
        rel = _safe(rel_path) if rel_path else None
        return [self._commit_json(c, space, stats=True)
                for c in commits(space.path, file_path=rel, limit=max(1, min(limit, 500)))]

    def diff(self, sid: str, sha: str, rel_path: str | None) -> dict[str, Any]:
        space = self._readable(sid)
        if not _SHA.match(sha.strip().lower()):
            raise ApiError(400, "invalid-sha", "That isn't a valid change id.")
        rel = _safe(rel_path) if rel_path else None
        try:
            patch = show_patch(space.path, sha.strip(), rel)
        except GitCommandError as exc:
            raise ApiError(404, "not-found",
                           f"That change isn't in {space_label(space)}'s history.") from exc
        return {"sha": sha.strip(), "path": rel, "patch": patch, "files": parse_patch(patch)}

    def search(self, query: str, sid: str | None, limit: int = 30) -> list[dict[str, Any]]:
        if not query.strip():
            return []
        spaces = [self._readable(sid)] if sid else [
            s for s in self._spaces() if self.access(s) != "none"
        ]
        services = [(space_id(s), self._service(s)) for s in spaces]
        by_id = {space_id(s): s for s in spaces}
        out = []
        for found_id, hit in search_spaces(services, query, limit=limit):
            rel = hit.path.lstrip("/")
            out.append({
                "spaceId": found_id,
                "path": rel,
                "title": _title(by_id[found_id].path / rel),
                "snippet": plain_snippet(hit.excerpt),
                "score": round(hit.score, 3),
            })
        return out

    # ---------- members ----------

    def members(self, sid: str) -> list[dict[str, Any]]:
        space = self._readable(sid)
        owners = set(self._owners(space))
        return [
            {"login": m.login, "name": m.name, "avatarUrl": m.avatar_url, "role": m.role,
             "via": m.via, "team": m.team, "isOwner": m.login in owners,
             "pending": m.pending}
            for m in self._space_members(space)
        ]

    def set_member(self, sid: str, login: str, role: str, invite: bool) -> list[dict[str, Any]]:
        space, repo = self._admin_repo(sid)
        me = self.gh.me()
        try:
            check_role(role)
            if invite:
                self.gh.invite(repo, login, role)
            else:
                self.gh.set_role(repo, login, role)
        except ProviderError as exc:
            raise from_provider_error(exc) from exc
        who = self._names([login])[0]
        summary = (f"{me.name} gave {who} {role_label(role)} access to {space.name}" if invite
                   else f"{me.name} changed {who}'s access to {space.name} to "
                   f"{role_label(role)}")
        self.ctx.store.add_event("access", me.login, sid, summary)
        self._members.pop(sid, None)
        return self.members(sid)

    def remove_member(self, sid: str, login: str) -> list[dict[str, Any]]:
        space, repo = self._admin_repo(sid)
        me = self.gh.me()
        try:
            self.gh.remove(repo, login)
        except ProviderError as exc:
            raise from_provider_error(exc) from exc
        self.ctx.store.add_event("access", me.login, sid,
                                 f"{me.name} removed {self._names([login])[0]} from {space.name}")
        self._members.pop(sid, None)
        return self.members(sid)

    # ---------- rules ----------

    def rules(self, status: str | None, sid: str | None) -> list[dict[str, Any]]:
        files = {"pending": RULES_PROPOSED, "active": RULES_LEARNED, "rejected": RULES_REJECTED}
        if status and status not in files:
            raise ApiError(400, "invalid-status", "status must be pending, active or rejected.")
        spaces = [self._readable(sid)] if sid else [
            s for s in self._spaces() if self.access(s) != "none"
        ]
        out: list[dict[str, Any]] = []
        for space in spaces:
            for state, rel in files.items():
                if status and state != status:
                    continue
                _, found = read_rules(space.path / rel)
                out.extend(self._rule_json(space, rule, state) for rule in found)
        out.sort(key=lambda r: (r["proposedAt"] or "", r["id"]), reverse=True)
        return out

    def settle_rule(self, rule_id: str, approve: bool, reason: str | None = None
                    ) -> dict[str, Any]:
        space = self._space_with_pending(rule_id)
        me = self.gh.me()
        if self.access(space) != "admin" and me.login not in self._owners(space):
            owners = _either(self._names(self._owners(space))) or "its admins"
            raise ApiError(403, "forbidden",
                           f"Only {space_label(space)}'s owners ({owners}) or admins can "
                           f"{'approve' if approve else 'reject'} its rules.")
        service = self._service(space)
        target = RULES_LEARNED if approve else RULES_REJECTED
        if service.write_refusal(target) or service.write_refusal(RULES_PROPOSED):
            owners = _either(self._names(self._owners(space))) or "the space owners"
            raise ApiError(403, "locked", f"The rules in {space_label(space)} are locked, so "
                           "they can't be changed here.", f"Ask {owners} for a change.")
        verb = "approve" if approve else "reject"
        with self.ctx.locks.hold(space.path):
            self._set_identity(space.path)
            try:
                service.prepare_write()
                rule = take_rule(space.path / RULES_PROPOSED, rule_id)
                if approve:
                    rule.approved_by = stamp(me.name)
                    header = (f"# Learned rules — {space.name}\n\n"
                              "Rules the agents learned from feedback, approved by a human.\n")
                else:
                    rule.extra.append(f"- rejected by: {stamp(me.name)}")
                    if reason and reason.strip():
                        rule.extra.append(f"- reason: {' '.join(reason.split())}")
                    header = (f"# Rejected rules — {space.name}\n\n"
                              "Proposed rules a reviewer turned down, kept with the reason.\n")
                append_rule(space.path / target, rule, header)
                stage_paths(space.path, [RULES_PROPOSED, target])
                if not has_staged_changes(space.path):
                    raise ApiError(409, "no-change", "Nothing changed.")
                sha, note = service.publish(
                    f"[SelfHub] {verb} {rule.id} in {space.name}",
                    failed_push_note="Saved locally; the push failed. Sync now to retry.",
                )
            except RuleError as exc:
                raise ApiError(404, "not-found", "That rule isn't waiting for review any more. "
                               "Someone may have approved or rejected it already.") from exc
            except GitCommandError as exc:
                raise ApiError(500, "git", "SelfHub couldn't record that decision. Nothing "
                               "was changed.", "Sync now, then try again.",
                               {"technical": str(exc)}) from exc
        proposed = space.manifest.write_policy == "pull-request"
        state = "pending" if proposed else ("active" if approve else "rejected")
        body = self._rule_json(space, rule, state)
        body["commit"] = sha
        decided = "approved" if approve else "rejected"
        if proposed:
            owners = _either(self._names(self._owners(space))) or "a reviewer"
            body["message"] = (f"You {decided} the rule. Because changes to {space.name} are "
                               f"reviewed, it takes effect once {owners} approves the change.")
        elif note:
            body["message"] = (f"You {decided} the rule. It's saved on this computer, but "
                               "sending it to GitHub failed. Sync now to try again.")
        else:
            body["message"] = f"You {decided} the rule."
        self._titles.pop(space_id(space), None)
        return body

    # ---------- activity ----------

    def activity(self, limit: int) -> list[dict[str, Any]]:
        limit = max(1, min(limit, 200))
        readable = [s for s in self._spaces() if self.access(s) != "none"]
        ids = {space_id(s) for s in readable}
        items: list[dict[str, Any]] = []
        for space in readable:
            for info in commits(space.path, limit=limit):
                items.append(self._commit_event(space, info))
        for event in self.ctx.store.events():
            if event.get("spaceId") in ids or event.get("spaceId") is None:
                items.append(dict(event))
        items.sort(key=lambda e: _when(str(e["date"])), reverse=True)
        return items[:limit]

    # ---------- access ----------

    def access(self, space: Space) -> str:
        sid = space_id(space)
        if sid not in self._roles:
            me = self.gh.me()
            if space.kind == "personal":
                owner = self.ctx.store.personal().get("owner")
                role = "admin" if owner in (None, me.login) else "none"
            else:
                repo = self._repo(space)
                # Not on GitHub: it's a local clone on this machine, so it's yours.
                role = self.gh.role(repo, me.login) if repo else "admin"
            self._roles[sid] = role
        return self._roles[sid]

    # ---------- internals ----------

    def _spaces(self) -> list[Space]:
        spaces, _ = self.ctx.workspace.spaces()
        visible = []
        for space in spaces:
            if space.kind == "personal":
                if self.ctx.locks.facts.get(space.path)[0] is None or \
                        self.access(space) == "none":
                    continue
            visible.append(space)
        return visible

    def _space(self, sid: str) -> Space:
        for space in self._spaces():
            if space_id(space) == sid:
                return space
        raise ApiError(404, "not-found", f"There's no space called '{sid}'.",
                       "It may have been disconnected or renamed. Pick one from your spaces.")

    def _readable(self, sid: str) -> Space:
        space = self._space(sid)
        if self.access(space) == "none":
            raise ApiError(403, "no-access", f"You don't have access to {space_label(space)}.",
                           self._ask_admins(space))
        return space

    def _ensure_writable(self, space: Space, rel: str) -> None:
        role = self.access(space)
        editable, reason, code = self._edit_check(space, rel, role)
        if editable:
            return
        label = space_label(space)
        hint = None
        message = reason or "You can't change this file."
        if code == "locked":
            owners = _either(self._names(self._owners(space))) or "the space owners"
            message = (f"{rel} is locked in {label}. Only {owners} can change it, through a "
                       "reviewed change. Nothing was saved.")
            hint = f"Ask {owners} for a change."
        raise ApiError(403, code or "forbidden", message, hint)

    def _edit_check(self, space: Space, rel: str, role: str) -> tuple[bool, str | None, str | None]:
        label = space_label(space)
        if role == "none":
            return False, f"You don't have access to {label}.", "no-access"
        if space.kind != "personal":
            if space.manifest.write_policy == "read-only":
                return False, f"{label} is set to view-only, so nothing can be saved here.", \
                    "read-only"
            if is_locked(space.manifest, rel):
                owners = _either(self._names(self._owners(space))) or "the space owners"
                return (False, f"Locked. Only {owners} can change it, through a reviewed "
                        "change.", "locked")
        if role == "read":
            admins = sorted(m.name for m in self._space_members(space) if m.role == "admin")[:2]
            ask = f" To edit, ask {_either(admins)} for Can edit access." if admins else ""
            return False, f"You can view {label}.{ask}", "read-only"
        return True, None, None

    def _service(self, space: Space) -> SelfHubService:
        manifest = personal_manifest() if space.kind == "personal" else space.manifest
        return SelfHubService(space.path, save_intelligence=None, manifest=manifest)

    def _set_identity(self, path: Path) -> None:
        if not self.ctx.commit_as_viewer:
            return
        me = self.gh.me()
        run_git(["config", "user.name", me.name], cwd=path)
        run_git(["config", "user.email", me.email or f"{me.login}@users.noreply.github.com"],
                cwd=path)

    def _repo(self, space: Space) -> RepoRef | None:
        if space.kind == "personal":
            return None
        meta = self.ctx.store.space(space_id(space)).get("repo")
        if isinstance(meta, dict) and meta.get("owner") and meta.get("name"):
            return RepoRef(str(meta["owner"]), str(meta["name"]))
        status = self.ctx.locks.facts.get(space.path)[0]
        return parse_github_remote(status.remote_url) if status else None

    def _add_demo_remote(self, path: Path, sid: str) -> None:
        """Demo only: a local stand-in for the new GitHub repo, with the first version sent,
        so a space we just "created on GitHub" doesn't read as not connected."""
        remotes = self.ctx.workspace.config_dir / "remotes"
        bare = remotes / f"{sid}.git"
        n = 2
        while bare.exists():
            bare, n = remotes / f"{sid}-{n}.git", n + 1
        bare.parent.mkdir(parents=True, exist_ok=True)
        run_git(["init", "-q", "--bare", "-b", "main", str(bare)], cwd=bare.parent)
        run_git(["remote", "add", "origin", str(bare)], cwd=path)
        push(path, set_upstream=True)
        self.ctx.store.update_space(sid, lastSyncAt=now_iso())

    def _register_demo_repo(self, sid: str, creator: str) -> None:
        """Give a new or newly connected demo space a repo in the fake org, with its
        creator as admin. Without one, roles and members would fall back to "whoever is
        asking", so each viewer would see a different member list."""
        space = self._space(sid)
        repo = self._repo(space)
        if repo is None:
            repo = RepoRef(self._org_login(), sid)
            self.ctx.store.update_space(sid, repo={"owner": repo.owner, "name": repo.name})
        self.gh.register_repo(repo, creator)
        self._roles.pop(sid, None)
        self._members.pop(sid, None)

    def _org_login(self) -> str:
        for space in self._spaces():
            repo = self._repo(space)
            if repo:
                return repo.owner
        return self.gh.me().login

    def _space_members(self, space: Space) -> list[Member]:
        sid = space_id(space)
        if sid not in self._members:
            repo = self._repo(space)
            if repo is None:
                owner = self._person(str(self.ctx.store.personal().get("owner") or "")) \
                    if space.kind == "personal" else None
                person = owner or self.gh.me()
                self._members[sid] = [Member(person.login, person.name, person.avatar_url,
                                             "admin", "direct")]
            else:
                try:
                    self._members[sid] = self.gh.members(repo)
                except ProviderError:
                    self._members[sid] = []
        return self._members[sid]

    def _admin_repo(self, sid: str) -> tuple[Space, RepoRef]:
        space = self._readable(sid)
        if self.access(space) != "admin":
            admins = sorted(m.name for m in self._space_members(space) if m.role == "admin")
            ask = _either(self._names(self._owners(space))[:2] or admins[:2])
            raise ApiError(403, "forbidden",
                           f"Only admins of {space_label(space)} can change who has access.",
                           f"Ask {ask} to add someone." if ask else None)
        repo = self._repo(space)
        if repo is None:
            raise ApiError(400, "no-repo",
                           f"{space_label(space)} is only on this computer, so there's no "
                           "access to manage.", "Connect it to GitHub first.")
        return space, repo

    def _ask_admins(self, space: Space) -> str:
        owners = self._names(self._owners(space))[:2] if space.kind != "personal" else []
        return f"Ask {_either(owners)} to add you." if owners else \
            "Ask one of its admins to add you."

    def _owners(self, space: Space) -> list[str]:
        if space.kind == "personal":
            owner = self.ctx.store.personal().get("owner") or self.gh.me().login
            return [str(owner)]
        teams = {t.slug: t for t in self._teams()}
        out: list[str] = []
        for handle in space.manifest.owners:
            name = handle.lstrip("@")
            if "/" in name:
                team = teams.get(name.split("/", 1)[1])
                out.extend(team.members if team else [name])
            else:
                out.append(name)
        return list(dict.fromkeys(out))

    def _teams(self) -> list[Any]:
        try:
            return list(self.gh.teams())
        except ProviderError:
            return []

    def _all_people(self) -> list[Person]:
        if self._people is None:
            try:
                self._people = self.gh.people()
            except ProviderError:
                self._people = [self.gh.me()]
        return self._people

    def _person(self, login: str) -> Person | None:
        return next((p for p in self._all_people() if p.login == login), None)

    def _names(self, logins: list[str]) -> list[str]:
        return [(self._person(login) or Person(login, login, "")).name for login in logins]

    def _author(self, name: str, email: str) -> dict[str, Any]:
        lowered_email, lowered_name = email.lower(), name.lower()
        for person in self._all_people():
            if (person.email and person.email.lower() == lowered_email) or \
                    person.name.lower() == lowered_name or person.login.lower() == lowered_name:
                return {"login": person.login, "name": person.name,
                        "avatarUrl": person.avatar_url}
        noreply = _NOREPLY.match(lowered_email)
        login = noreply.group(1) if noreply else slug(name or email or "unknown")
        avatar = f"https://github.com/{login}.png" if noreply else ""
        return {"login": login, "name": name or login, "avatarUrl": avatar}

    def _commit_json(self, info: CommitInfo, space: Space,
                     stats: bool = False) -> dict[str, Any]:
        text, rule_id = display_message(info.message, self._rule_titles(space))
        body: dict[str, Any] = {
            "sha": info.sha,
            "author": self._author(info.author_name, info.author_email),
            "date": _utc(info.date),
            "message": text,
            "rawMessage": info.message,
        }
        if rule_id:
            body["ruleId"] = rule_id
        if stats:
            body["additions"] = info.additions
            body["deletions"] = info.deletions
        return body

    def _rule_titles(self, space: Space) -> dict[str, str]:
        sid = space_id(space)
        if sid not in self._titles:
            titles: dict[str, str] = {}
            for rel in (RULES_PROPOSED, RULES_LEARNED, RULES_REJECTED):
                try:
                    _, found = read_rules(space.path / rel)
                except (OSError, RuleError):
                    continue
                titles.update({r.id: r.title or r.rule for r in found})
            self._titles[sid] = titles
        return self._titles[sid]

    def _file_json(self, space: Space, rel: str) -> dict[str, Any]:
        target = space.path / rel
        raw = target.read_bytes()
        try:
            content, binary = raw.decode("utf-8"), False
        except UnicodeDecodeError:
            content, binary = "", True
        editable, reason, _ = self._edit_check(space, rel, self.access(space))
        last = last_commit(space.path, rel)
        body: dict[str, Any] = {
            "path": rel,
            "content": content,
            "locked": is_locked(space.manifest, rel),
            "editable": editable and not binary,
            "sha": file_blob_sha(target),
            "lastCommit": self._commit_json(last, space) if last else None,
            "format": file_format(rel, binary),
        }
        if binary:
            body["binary"] = True
            reason = reason or "Binary file; it can't be edited here."
        if reason:
            body["reason"] = reason
        return body

    def _outcome_json(self, space: Space, outcome: WriteOutcome,
                      pulled: list[CommitInfo]) -> dict[str, Any]:
        info = commits(space.path, limit=1, rev=outcome.sha)[0] if outcome.sha else None
        names = list(dict.fromkeys(
            self._author(c.author_name, c.author_email)["name"] for c in pulled))
        label = space_label(space)
        note = outcome.note or ""
        if outcome.outcome == "pull-request":
            owners = _either(self._names(self._owners(space))) or "a reviewer"
            if "failed" in note:
                text = ("Saved for review on this computer, but sending it to GitHub failed. "
                        "Sync now to try again.")
            elif "No remote" in note:
                text = (f"Saved for review on this computer. It becomes part of {label} once "
                        f"{owners} approves it.")
            else:
                text = f"Sent for review. It becomes part of {label} once {owners} approves it."
        elif outcome.sha is None:
            text = "Removed. It was never saved in the space's history."
        elif note:
            text = "Saved on this computer, but sending it to GitHub failed. Sync now to try again."
        elif has_remote(space.path):
            text = "Saved and sent to GitHub."
        else:
            text = "Saved on this computer. This space isn't connected to GitHub."
        if pulled:
            text += f" Got {plural(len(pulled), 'change')}{from_people(names)} first."
        return {
            "outcome": outcome.outcome,
            "commit": self._commit_json(info, space) if info else None,
            "prUrl": outcome.pr_url,
            "branch": outcome.branch,
            "message": text,
            "pulled": len(pulled),
            "pulledBy": names,
            "space": self.space_json(space),
        }

    def _log_write(self, space: Space, rel: str, verb: str, outcome: str) -> None:
        if outcome != "pull-request":
            return  # commits on the main branch already show up in activity
        me = self.gh.me()
        self.ctx.store.add_event("edit", me.login, space_id(space),
                                 f"{me.name} {verb} {file_name(rel)} in {space_label(space)} "
                                 "and sent it for review", path=rel)

    def _rule_json(self, space: Space, rule: Rule, status: str) -> dict[str, Any]:
        proposed_by, proposed_at = _parse_stamp(rule.proposed_by)
        approved_by, approved_at = _parse_stamp(rule.approved_by)
        rejected = next((line.split(":", 1)[1].strip() for line in rule.extra
                         if line.strip().startswith("- rejected by:")), "")
        rejected_by, rejected_at = _parse_stamp(rejected)
        reject_reason = next((line.split(":", 1)[1].strip() for line in rule.extra
                              if line.strip().startswith("- reason:")), None)
        body: dict[str, Any] = {
            "id": rule.id,
            "spaceId": space_id(space),
            "title": rule.title,
            "text": rule.rule,
            "why": rule.why,
            "source": rule.source,
            "proposedBy": self._login_for(proposed_by),
            "proposedAt": proposed_at,
            "status": status,
            "prUrl": None,
        }
        if approved_by:
            body["approvedBy"] = self._login_for(approved_by)
            body["approvedAt"] = approved_at
        if rejected_by:
            body["rejectedBy"] = self._login_for(rejected_by)
            body["rejectedAt"] = rejected_at
            body["rejectReason"] = reject_reason
        return body

    def _login_for(self, name: str) -> str:
        if not name:
            return ""
        return str(self._author(name, "")["login"])

    def _space_with_pending(self, rule_id: str) -> Space:
        for space in self._spaces():
            if self.access(space) == "none":
                continue
            _, rules = read_rules(space.path / RULES_PROPOSED)
            if any(r.id == rule_id for r in rules):
                return space
        raise ApiError(404, "not-found", "That rule isn't waiting for review in any of your "
                       "spaces. Someone may have approved or rejected it already.")

    def _commit_event(self, space: Space, info: CommitInfo) -> dict[str, Any]:
        author = self._author(info.author_name, info.author_email)
        name, label = author["name"], space_label(space)
        titles = self._rule_titles(space)
        text, rule_id = display_message(info.message, titles)
        rule = rule_commit(info.message)
        is_rule = rule is not None or (bool(info.paths)
                                       and all(p.startswith("rules/") for p in info.paths))
        if rule:
            verb, rule_id = rule
            title = titles.get(rule_id)
            summary = f"{name} {verb} a rule for {label}" + (f": {title}" if title else "")
        elif is_rule and info.message.startswith("[SelfHub]"):
            summary = f"{name} {text[0].lower()}{text[1:]} for {label}"
        else:
            summary = _change_summary(name, label, info)
            if not is_auto_message(info.message) and text:
                summary += f": {text}"
        event: dict[str, Any] = {
            "id": f"{space_id(space)}:{info.sha[:12]}",
            "type": "rule" if is_rule else "edit",
            "actor": author["login"],
            "spaceId": space_id(space),
            "summary": summary,
            "date": _utc(info.date),
            "sha": info.sha,
        }
        if rule_id:
            event["ruleId"] = rule_id
        if len(info.paths) == 1:
            event["path"] = info.paths[0]
        return event

    def _sync_state(self, space: Space, status: RepoStatus | None) -> dict[str, Any]:
        last = self.ctx.store.space(space_id(space)).get("lastSyncAt")
        state: dict[str, Any] = {"state": "synced", "ahead": 0, "behind": 0,
                                 "lastSyncAt": last, "message": "", "changedPaths": [],
                                 "changes": [], "incomingBy": [], "conflict": None}
        if status is None:
            return {**state, "state": "error",
                    "message": "SelfHub can't read this space's folder. It may have been moved "
                    "or deleted."}
        state["changedPaths"] = [c.path for c in status.changes]
        state["changes"] = [{"path": c.path, "status": c.status} for c in status.changes]
        incoming = self._incoming_names(status)
        state["incomingBy"] = incoming
        state["conflict"] = self._conflict(status)
        unsaved = len(status.changes)
        unsaved_text = _local_files_text(unsaved, bool(status.remote_url))
        if not status.remote_url:
            state.update(state="no-remote",
                         message="This space is only on this computer. It isn't connected to "
                         "GitHub.")
            if unsaved:
                state["message"] += " " + unsaved_text
            return state
        if not status.has_upstream:
            count = status.commit_count or 0
            state.update(state="ahead", ahead=count,
                         message=f"This space isn't on GitHub yet. {plural(count, 'saved change')}"
                         f" {'is' if count == 1 else 'are'} only on this computer. Sync now to "
                         "send them.")
            if unsaved:
                state["message"] += " " + unsaved_text
            return state
        ahead, behind = status.ahead, status.behind
        state.update(ahead=ahead, behind=behind)
        newer = f"GitHub has {plural(behind, 'newer change')}{from_people(incoming)}"
        not_sent = (f"{plural(ahead, 'saved change')} on this computer "
                    f"{'isn' if ahead == 1 else 'aren'}'t on GitHub yet")
        if ahead and behind:
            state.update(state="diverged",
                         message=f"{not_sent}, and {newer}. Sync now to combine them.")
            if unsaved:
                state["message"] += " " + unsaved_text
        elif unsaved:
            extra = f" {newer}." if behind else (f" {not_sent}." if ahead else "")
            state.update(state="local-changes", message=f"{unsaved_text}{extra}")
        elif ahead:
            state.update(state="ahead", message=f"{not_sent}. Sync now to send them.")
        elif behind:
            state.update(state="behind", message=f"{newer}. Sync now to get them.")
        else:
            state["message"] = "Up to date with GitHub."
        conflict = state["conflict"]
        if conflict:
            state["message"] += (f" {conflict['byName']} also changed {conflict['path']} on "
                                 "GitHub.")
        return state

    def _incoming_names(self, status: RepoStatus) -> list[str]:
        names = [self._author(c.author_name, c.author_email)["name"] for c in status.incoming]
        return list(dict.fromkeys(names))

    def _conflict(self, status: RepoStatus) -> dict[str, str] | None:
        """The first file changed both here (saved or not) and on GitHub."""
        if not status.incoming:
            return None
        local = {c.path for c in status.changes} | set(status.outgoing_paths)
        for info in status.incoming:  # newest first
            for path in info.paths:
                if path in local:
                    who = self._author(info.author_name, info.author_email)
                    return {"path": path, "byName": who["name"], "byLogin": who["login"]}
        return None


# ---------- helpers ----------


def space_id(space: Space) -> str:
    return PERSONAL_ID if space.kind == "personal" else slug(space.name)


def _repo_name(space: Space) -> str:
    return "my-selfhub" if space.kind == "personal" else space_id(space)


def _gh_not_ready(problem: str | None) -> ApiError:
    if problem == "gh-missing":
        return ApiError(503, "gh-missing", "The GitHub CLI (gh) isn't installed on this "
                        "computer.", "Install it, log in, then choose Check again.",
                        {"problem": problem})
    return ApiError(401, "logged-out", "You're not logged in to GitHub on this computer.",
                    "Log in with the GitHub CLI (gh), then choose Check again.",
                    {"problem": "logged-out"})


def space_label(space: Space) -> str:
    return "your personal space" if space.kind == "personal" else space.name


def _either(names: list[str]) -> str:
    if len(names) <= 1:
        return "".join(names)
    return f"{', '.join(names[:-1])} or {names[-1]}"


def _safe(rel_path: str) -> str:
    try:
        return safe_rel_path(rel_path)
    except SpaceFileError as exc:
        raise from_file_error(exc) from exc


def _locked_paths(space: Space) -> list[str]:
    if space.kind == "personal":
        return []
    return [*space.manifest.locked, MANIFEST_PATH, CODEOWNERS_PATH]


def _default_description(kind: str) -> str:
    return {
        "org": "Company-wide SOPs, brand and compliance. Loaded on every task.",
        "team": "One team's shared workflows. Loaded on every task for its members.",
        "client": "Everything about one client. Loaded only when a task names it.",
    }.get(kind, "")


def _title(path: Path) -> str:
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("# "):
                return line[2:].strip()
    except (OSError, UnicodeDecodeError):
        pass
    return path.stem.replace("-", " ").replace("_", " ").capitalize()


def _parse_stamp(value: str) -> tuple[str, str | None]:
    if not value:
        return "", None
    match = _STAMP.match(value.strip())
    if not match:
        return value.strip(), None
    who = match.group(1).replace("(direct policy)", "").strip()
    return who, match.group(2)


def _when(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return datetime.min.replace(tzinfo=UTC)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _utc(value: str) -> str:
    try:
        return datetime.fromisoformat(value).astimezone(UTC).isoformat()
    except ValueError:
        return value


def _change_summary(name: str, label: str, info: CommitInfo) -> str:
    paths = info.paths
    if len(paths) == 1:
        path = paths[0]
        if path in info.renamed:
            return (f"{name} renamed {file_name(info.renamed[path])} to {file_name(path)} in "
                    f"{label}")
        if path in info.created:
            return f"{name} added {file_name(path)} to {label}"
        if path in info.deleted:
            return f"{name} deleted {file_name(path)} from {label}"
        return f"{name} edited {file_name(path)} in {label}"
    if paths and all(p in info.created for p in paths):
        return f"{name} added {plural(len(paths), 'file')} to {label}"
    if paths:
        return f"{name} changed {plural(len(paths), 'file')} in {label}"
    return f"{name} made a change in {label}"


def _local_files_text(count: int, remote: bool) -> str:
    """Files edited on this computer that aren't in the space's history yet. Never called
    "unsaved": that word is for editor drafts."""
    if not count:
        return ""
    files = plural(count, "file")
    if remote:
        verb = "isn't" if count == 1 else "aren't"
        return f"{files} on this computer {verb} on GitHub yet. Save {_them(count)} to send " \
            f"{_them(count)}."
    verb = "has" if count == 1 else "have"
    return f"{files} {verb} changes that aren't saved in this space yet. Save {_them(count)} " \
        f"to keep {_them(count)}."


def _them(count: int) -> str:
    return "it" if count == 1 else "them"


def _ago(value: str) -> str:
    when = _when(value)
    days = (datetime.now(UTC) - when).total_seconds() / 86400
    if days < 1 / 24:
        return "a few minutes ago"
    if days < 1:
        return f"{plural(max(1, round(days * 24)), 'hour')} ago"
    if days < 2:
        return "yesterday"
    return f"{round(days)} days ago"


def _file_count(path: Path) -> int:
    """Files in the space outside `.git`, counted the same way `tree()` lists them."""
    if not path.is_dir():
        return 0
    return sum(1 for p in path.rglob("*")
               if p.relative_to(path).parts[0] != ".git" and not p.is_dir())


def _sync_repo(path: Path) -> tuple[str, list[CommitInfo], int, RepoStatus | None]:
    """Fetch, pull (rebase) what's new, push what's local. Returns result, the commits that
    came in (or would have, on a conflict), the number pushed, and the status before."""
    fetch(path)
    status = repo_status(path)
    if status is None:
        raise GitCommandError("not a git repo")
    if not status.has_upstream:
        count = status.commit_count or 0
        if count == 0:
            return "up-to-date", [], 0, status
        push(path, set_upstream=True)
        return "pushed", [], count, status
    pushed = 0
    incoming = status.incoming
    if status.behind:
        try:
            pull(path)
        except GitCommandError:
            try:
                run_git(["rebase", "--abort"], cwd=path)
            except GitCommandError:
                pass
            return "conflict", incoming, 0, status
    if status.ahead:
        push(path)
        pushed = status.ahead
    if pushed:
        return "pushed", incoming, pushed, status
    if incoming:
        return "pulled", incoming, 0, status
    return "up-to-date", [], 0, status


def _sync_message(result: str, remote: bool, pulled: int, names: list[str], pushed: int,
                  conflict: dict[str, str] | None) -> str:
    if not remote:
        return "This space is only on this computer, so there's nothing to sync."
    got = f"got {plural(pulled, 'change')}{from_people(names)}"
    if result == "pushed":
        return f"Sent {plural(pushed, 'change')} to GitHub" + (f" and {got}." if pulled else ".")
    if result == "pulled":
        return f"{got[0].upper()}{got[1:]}."
    if result == "conflict":
        if conflict:
            return (f"Your changes to {conflict['path']} overlap with {conflict['byName']}'s "
                    "on GitHub, so nothing was changed. Open the file to combine them.")
        return "Your changes overlap with newer changes on GitHub, so nothing was changed."
    if result == "error":
        return "Couldn't reach GitHub, so nothing was synced. Try again in a moment."
    return "Already up to date with GitHub."
