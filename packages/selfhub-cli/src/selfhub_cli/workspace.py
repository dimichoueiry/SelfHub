"""Many SelfHub spaces working as one company brain.

The personal SelfHub stays exactly as it was. This adds org, team and client spaces
next to it (see selfhub_core.spaces), and three things on top:

- context: everything an agent needs for one task, from every space that applies and
  none that doesn't, with locked rules first and every source named.
- learn / approve: feedback becomes a rule, a human approves it, and it is loaded from
  then on.
- policies: switches a person picks for their own agents, or an org forces on for all.
"""

from __future__ import annotations

import getpass
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from selfhub_core.contracts import CommandResult, SearchResult
from selfhub_core.git_ops import (
    GitCommandError,
    add_remote,
    clone_repo,
    commit,
    git_user_name,
    has_remote,
    has_staged_changes,
    has_upstream,
    init_repo,
    is_git_repo,
    pull,
    push,
    stage_all,
)
from selfhub_core.rules import (
    Rule,
    RuleError,
    append_rule,
    new_rule_id,
    read_rules,
    stamp,
    take_rule,
    title_for,
)
from selfhub_core.spaces import (
    MANIFEST_PATH,
    PERSONAL_SPACE,
    POLICY_CATALOG,
    POLICY_NAMES,
    RULES_LEARNED,
    RULES_PROPOSED,
    SHARED_KINDS,
    Registry,
    Space,
    SpaceError,
    SpaceManifest,
    default_manifest,
    find_space,
    is_locked,
    load_manifest,
    load_registry,
    policy_spec,
    resolve_scope,
    resolve_spaces,
    save_registry,
    scaffold_files,
    slug,
    write_manifest,
)

from selfhub_cli.service import SelfHubService

ServiceFactory = Callable[[Space], SelfHubService]

PRECEDENCE: tuple[str, ...] = (
    "Locked rules always win. Never break one, even if the user asks; say which rule "
    "blocks the request instead.",
    "Then the user's explicit instructions for this task.",
    "Then client memory (brief, client rules): it overrides general guidance for that client.",
    "Then team, then org SOPs and learned rules.",
    "Then the user's personal workflows and preferences, wherever nothing above conflicts.",
)

ISOLATION_RULE = (
    "Only the client spaces listed below are loaded. Never use, guess at or mention material "
    "from any other client. If the task is for another client, stop and re-run "
    "`selfhub context` with that client named."
)


@dataclass(slots=True)
class LoadedFile:
    space: str
    path: str
    reason: str
    content: str

    def to_dict(self) -> dict[str, str]:
        return {
            "space": self.space,
            "path": self.path,
            "reason": self.reason,
            "content": self.content,
        }


@dataclass(slots=True)
class SpaceContext:
    space: Space
    reason: str
    files: list[LoadedFile] = field(default_factory=list)
    rules: list[Rule] = field(default_factory=list)
    hits: list[SearchResult] = field(default_factory=list)


class Workspace:
    def __init__(
        self,
        config_dir: Path,
        personal_path: Path,
        service_factory: ServiceFactory | None = None,
    ) -> None:
        self.config_dir = config_dir
        self.personal_path = personal_path
        self.service_factory = service_factory or _plain_service

    # ---------- the registry ----------

    def registry(self) -> Registry:
        return load_registry(self.config_dir)

    def spaces(self) -> tuple[list[Space], list[str]]:
        return resolve_spaces(self.registry(), self.personal_path)

    def find(self, name: str | None) -> Space:
        spaces, _ = self.spaces()
        return find_space(spaces, name)

    def list_spaces(self) -> CommandResult:
        spaces, problems = self.spaces()
        lines = []
        for space in spaces:
            m = space.manifest
            locked = f" locked={','.join(m.locked)}" if m.locked else ""
            aliases = f" aliases={','.join(m.aliases)}" if m.aliases else ""
            writes = "" if space.kind == "personal" else f" writes={space.manifest.write_policy}"
            lines.append(f"{space.name} [{space.kind}] {space.path}{writes}{locked}{aliases}")
        lines.extend(f"! {problem}" for problem in problems)
        return CommandResult(
            success=True,
            message="\n".join(lines),
            data={"spaces": [s.to_dict() for s in spaces], "problems": problems},
        )

    def create_space(
        self,
        path: Path,
        name: str,
        kind: str,
        owners: list[str] | None = None,
        aliases: list[str] | None = None,
        remote_url: str | None = None,
    ) -> CommandResult:
        if kind not in SHARED_KINDS:
            return _fail(f"kind must be one of {', '.join(SHARED_KINDS)}.")
        path = path.expanduser()
        try:
            if load_manifest(path) is not None:
                return _fail(f"{path} is already a SelfHub space. Use `selfhub space add {path}`.")
            self._check_new_name(name)
        except SpaceError as exc:
            return _fail(str(exc))

        manifest = default_manifest(name, kind, owners or [], aliases or [])
        try:
            if not is_git_repo(path):
                init_repo(path)
            if remote_url and not has_remote(path):
                add_remote(path, remote_url)
            write_manifest(path, manifest)
            created = [MANIFEST_PATH]
            for rel_path, content in scaffold_files(manifest).items():
                target = path / rel_path
                if target.exists():
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
                created.append(rel_path)
            stage_all(path)
            sha = commit(path, f"[SelfHub] create {kind} space {name}", as_user=True)
            push_note = ""
            if has_remote(path):
                try:
                    push(path, set_upstream=not has_upstream(path))
                except GitCommandError:
                    push_note = " Push failed; run `selfhub space sync` once the remote exists."
        except GitCommandError as exc:
            return _fail(str(exc))

        self._register(name, path)
        steps = protection_steps(manifest)
        message = f"Created {kind} space '{name}' at {path}.{push_note}"
        if steps:
            message = f"{message}\n\nTo enforce locks on GitHub:\n" + "\n".join(
                f"{i}. {step}" for i, step in enumerate(steps, start=1)
            )
        return CommandResult(
            success=True,
            message=message,
            data={"space": name, "path": str(path), "files_created": created, "commit_sha": sha,
                  "manifest": manifest.to_dict(), "protection_steps": steps},
        )

    def add_space(
        self,
        source: str,
        name: str | None = None,
        into: Path | None = None,
    ) -> CommandResult:
        try:
            if _looks_like_remote(source):
                dest = (into or self.config_dir / "spaces" / slug(_repo_name(source))).expanduser()
                if not dest.exists() or not any(dest.iterdir()):
                    clone_repo(source, dest)
                path = dest
            else:
                path = Path(source).expanduser().resolve()
            manifest = load_manifest(path)
            if manifest is None:
                return _fail(
                    f"{path} has no {MANIFEST_PATH}, so it is not a SelfHub space yet. "
                    f"Make it one with `selfhub space create {path} --kind org|team|client`."
                )
            space_name = name or manifest.name
            self._check_new_name(space_name)
        except (GitCommandError, SpaceError) as exc:
            return _fail(str(exc))
        self._register(space_name, path)
        return CommandResult(
            success=True,
            message=f"Connected {manifest.kind} space '{space_name}' at {path}.",
            data={"space": space_name, "path": str(path), "manifest": manifest.to_dict()},
        )

    def remove_space(self, name: str) -> CommandResult:
        registry = self.registry()
        kept = [s for s in registry.spaces if s["name"].lower() != name.strip().lower()]
        if len(kept) == len(registry.spaces):
            return _fail(f"No connected space named '{name}'.")
        registry.spaces = kept
        save_registry(self.config_dir, registry)
        return CommandResult(
            success=True,
            message=f"Disconnected '{name}'. Its files were left where they are.",
        )

    def sync_spaces(self) -> CommandResult:
        spaces, problems = self.spaces()
        lines: list[str] = []
        failed = False
        for space in spaces:
            if not is_git_repo(space.path) or not has_remote(space.path):
                lines.append(f"{space.name}: no remote, nothing to sync")
                continue
            try:
                if has_upstream(space.path):
                    lines.append(f"{space.name}: {pull(space.path) or 'up to date'}")
                else:
                    push(space.path, set_upstream=True)
                    lines.append(f"{space.name}: pushed and set upstream")
            except GitCommandError as exc:
                failed = True
                lines.append(f"{space.name}: FAILED {exc}")
        lines.extend(f"! {problem}" for problem in problems)
        return CommandResult(success=not failed, message="\n".join(lines))

    # ---------- context for one task ----------

    def context(self, task: str, clients: list[str] | None = None, limit: int = 5) -> CommandResult:
        spaces, problems = self.spaces()
        try:
            for client in clients or []:
                if find_space(spaces, client).kind != "client":
                    return _fail(f"'{client}' is not a client space.")
        except SpaceError as exc:
            return _fail(str(exc))
        scope = resolve_scope(spaces, task, clients)

        loaded: list[SpaceContext] = []
        for space in scope.included:
            loaded.append(self._space_context(space, scope.reasons[space.name], task, limit))

        policies = self._policies(scope.included)
        bundle = render_context(task, loaded, scope.other_clients, policies, problems)
        sources = [f"{f.space}:{f.path}" for c in loaded for f in c.files]
        sources += [f"{c.space.name}:{RULES_LEARNED}" for c in loaded if c.rules]
        return CommandResult(
            success=True,
            message=bundle,
            data={
                "task": task,
                "precedence": list(PRECEDENCE),
                "isolation": ISOLATION_RULE,
                "spaces": [
                    {
                        "name": c.space.name,
                        "kind": c.space.kind,
                        "reason": c.reason,
                        "write_policy": c.space.manifest.write_policy,
                        "files": [f.to_dict() for f in c.files],
                        "rules": [r.to_dict() for r in c.rules],
                        "hits": [h.to_dict() for h in c.hits],
                    }
                    for c in loaded
                ],
                "not_loaded_clients": scope.other_clients,
                "policies": [{"name": n, "from": src, "instruction": policy_spec(n).instruction}
                             for n, src in policies],
                "sources": sources,
                "problems": problems,
            },
        )

    def _space_context(self, space: Space, reason: str, task: str, limit: int) -> SpaceContext:
        ctx = SpaceContext(space=space, reason=reason)
        full: set[str] = set()
        for rel_path in _markdown_paths(space.path):
            if rel_path in {RULES_LEARNED, RULES_PROPOSED}:
                continue
            if is_locked(space.manifest, rel_path):
                if rel_path.rsplit("/", 1)[-1].lower() == "readme.md":
                    continue  # explains the folder; not a rule
                why = "locked: non-negotiable"
            elif rel_path in space.manifest.always_load:
                why = "always loaded for this space"
            else:
                continue
            text = (space.path / rel_path).read_text(encoding="utf-8").strip()
            if text:
                ctx.files.append(LoadedFile(space.name, rel_path, why, text))
                full.add(rel_path)
        _, ctx.rules = read_rules(space.path / RULES_LEARNED)
        if task.strip():
            skip = full | {RULES_LEARNED, RULES_PROPOSED}
            hits = self.service_factory(space).search(task, mode="hybrid", limit=limit + len(skip))
            ctx.hits = [h for h in hits if h.path.lstrip("/") not in skip][:limit]
        return ctx

    def _policies(self, included: list[Space]) -> list[tuple[str, str]]:
        """Every policy in force: (name, where it comes from). Spaces' policies can't be
        switched off by a person; a person's own add to them."""
        out: list[tuple[str, str]] = []
        seen: set[str] = set()
        for space in included:
            for name in space.manifest.policies:
                if name not in seen:
                    out.append((name, f"enforced by {space.name}"))
                    seen.add(name)
        for name in self.registry().policies:
            if name not in seen:
                out.append((name, "your choice"))
                seen.add(name)
        return out

    # ---------- learning from feedback ----------

    def learn(
        self,
        rule_text: str,
        space_name: str | None,
        why: str = "",
        source: str = "",
        title: str | None = None,
    ) -> CommandResult:
        if not rule_text.strip():
            return _fail("The rule can't be empty.")
        try:
            space = self.find(space_name)
        except SpaceError as exc:
            return _fail(str(exc))
        service = self.service_factory(space)
        target = self._learn_target(space)
        refusal = service.write_refusal(target)
        if refusal:
            return _fail(refusal)

        who = self._who(space)
        rule = Rule(
            id=new_rule_id(),
            title=title or title_for(rule_text),
            rule=rule_text.strip(),
            why=why.strip(),
            source=source.strip(),
            proposed_by=stamp(who),
        )
        applies_now = target == RULES_LEARNED
        if applies_now and space.manifest.write_policy != "pull-request":
            rule.approved_by = stamp(f"{who} (direct policy)")
        header = _rules_header(space, proposed=not applies_now)
        try:
            service.prepare_write()
            append_rule(space.path / target, rule, header)
            sha, note = self._commit(service, space, f"[SelfHub] learn {rule.id} in {space.name}")
        except GitCommandError as exc:
            return _fail(str(exc))

        if space.manifest.write_policy == "pull-request":
            status = "goes through review"
        elif applies_now:
            status = "applies from now on"
        else:
            status = (f"waiting for approval: `selfhub rules approve {rule.id} "
                      f"--space {_quoted(space.name)}`")
        message = f"Rule {rule.id} in '{space.name}' {status}."
        if note:
            message = f"{message} {note}"
        return CommandResult(
            success=True,
            message=message,
            data={"rule": rule.to_dict(), "space": space.name, "file": target,
                  "applies_now": applies_now and space.manifest.write_policy != "pull-request",
                  "commit_sha": sha},
        )

    def _learn_target(self, space: Space) -> str:
        if space.kind == "personal":
            return RULES_LEARNED if "learn-direct" in self.registry().policies else RULES_PROPOSED
        # With pull requests, the review is the approval: write the rule where it will live.
        if space.manifest.write_policy == "pull-request" or space.manifest.learn_policy == "direct":
            return RULES_LEARNED
        return RULES_PROPOSED

    def list_rules(self, space_name: str | None = None, pending: bool = False) -> CommandResult:
        spaces, problems = self.spaces()
        try:
            chosen = [find_space(spaces, space_name)] if space_name else spaces
        except SpaceError as exc:
            return _fail(str(exc))
        target = RULES_PROPOSED if pending else RULES_LEARNED
        lines: list[str] = []
        found: list[dict[str, object]] = []
        for space in chosen:
            _, rules = read_rules(space.path / target)
            for rule in rules:
                lines.append(f"{space.name} {rule.id}: {rule.rule}")
                found.append({"space": space.name, **rule.to_dict()})
        label = "pending" if pending else "approved"
        message = "\n".join(lines) if lines else f"No {label} rules."
        return CommandResult(success=True, message=message,
                             data={"rules": found, "problems": problems})

    def approve(self, rule_id: str, space_name: str | None) -> CommandResult:
        return self._settle(rule_id, space_name, approve=True)

    def reject(self, rule_id: str, space_name: str | None) -> CommandResult:
        return self._settle(rule_id, space_name, approve=False)

    def _settle(self, rule_id: str, space_name: str | None, approve: bool) -> CommandResult:
        try:
            space = self.find(space_name)
        except SpaceError as exc:
            return _fail(str(exc))
        service = self.service_factory(space)
        refusal = service.write_refusal(RULES_LEARNED if approve else RULES_PROPOSED)
        if refusal:
            return _fail(refusal)
        try:
            service.prepare_write()
            rule = take_rule(space.path / RULES_PROPOSED, rule_id)
            verb = "approve" if approve else "reject"
            if approve:
                rule.approved_by = stamp(self._who(space))
                append_rule(space.path / RULES_LEARNED, rule, _rules_header(space, proposed=False))
            sha, note = self._commit(service, space, f"[SelfHub] {verb} {rule.id} in {space.name}")
        except (RuleError, GitCommandError) as exc:
            return _fail(str(exc))
        done = "Approved" if approve else "Rejected"
        message = f"{done} {rule.id} in '{space.name}': {rule.rule}"
        if note:
            message = f"{message} {note}"
        return CommandResult(success=True, message=message,
                             data={"rule": rule.to_dict(), "space": space.name, "commit_sha": sha})

    def _commit(
        self, service: SelfHubService, space: Space, message: str
    ) -> tuple[str | None, str | None]:
        stage_all(space.path)
        if not has_staged_changes(space.path):
            return None, None
        return service.publish(
            message, failed_push_note="Saved locally; push failed. Run `selfhub space sync`."
        )

    # ---------- personal policies ----------

    def policies(self) -> CommandResult:
        spaces, _ = self.spaces()
        mine = set(self.registry().policies)
        enforced = {n: s.name for s in spaces for n in s.manifest.policies}
        lines = []
        rows = []
        for spec in POLICY_CATALOG:
            if spec.name in enforced:
                state = f"on (enforced by {enforced[spec.name]})"
            elif spec.name in mine:
                state = "on"
            else:
                state = "off"
            lines.append(f"{spec.name:<22} {state:<28} {spec.summary}")
            rows.append({"name": spec.name, "state": state, "summary": spec.summary})
        return CommandResult(success=True, message="\n".join(lines), data={"policies": rows})

    def set_policy(self, name: str, on: bool) -> CommandResult:
        if name not in POLICY_NAMES:
            return _fail(f"Unknown policy '{name}'. Known: {', '.join(POLICY_NAMES)}.")
        registry = self.registry()
        current = [p for p in registry.policies if p != name]
        registry.policies = [*current, name] if on else current
        save_registry(self.config_dir, registry)
        spaces, _ = self.spaces()
        enforcer = next((s.name for s in spaces if name in s.manifest.policies), None)
        message = f"{name} is {'on' if on else 'off'} for you."
        if not on and enforcer:
            message = f"{message} It stays on anyway: {enforcer} enforces it for everyone."
        return CommandResult(success=True, message=message)

    # ---------- helpers ----------

    def _register(self, name: str, path: Path) -> None:
        registry = self.registry()
        registry.spaces = [s for s in registry.spaces if s["name"].lower() != name.lower()]
        registry.spaces.append({"name": name, "path": str(path)})
        save_registry(self.config_dir, registry)

    def _check_new_name(self, name: str) -> None:
        if not name.strip():
            raise SpaceError("A space needs a name.")
        if name.strip().lower() in {PERSONAL_SPACE, "personal"}:
            raise SpaceError(f"'{name}' is reserved for your personal SelfHub.")
        if any(s["name"].lower() == name.strip().lower() for s in self.registry().spaces):
            raise SpaceError(f"A space named '{name}' is already connected.")

    def _who(self, space: Space) -> str:
        return git_user_name(space.path) or git_user_name(self.personal_path) or getpass.getuser()


def render_context(
    task: str,
    loaded: list[SpaceContext],
    other_clients: list[str],
    policies: list[tuple[str, str]],
    problems: list[str],
) -> str:
    out = ["# SelfHub context", "", f"Task: {task}" if task.strip() else "Task: (none given)", ""]
    out.append("## How to apply this")
    out.extend(f"{i}. {line}" for i, line in enumerate(PRECEDENCE, start=1))
    out.append("")
    clients = [c.space.name for c in loaded if c.space.kind == "client"]
    out.append("## Client isolation")
    out.append(ISOLATION_RULE)
    out.append(f"Loaded clients: {', '.join(clients) if clients else 'none'}.")
    if other_clients:
        out.append(f"Not loaded: {', '.join(other_clients)}.")
    out.append("")

    locked = [(c, f) for c in loaded for f in c.files if f.reason.startswith("locked")]
    if locked:
        out.append("## Locked rules (non-negotiable)")
        for _, f in locked:
            out.extend([f"### {f.space}:{f.path}", f.content, ""])

    if policies:
        out.append("## Policies in force")
        for name, src in policies:
            out.append(f"- {name} ({src}): {policy_spec(name).instruction}")
        out.append("")

    for c in loaded:
        out.append(f"## {c.space.kind.capitalize()} space: {c.space.name}")
        out.append(f"Why loaded: {c.reason}. Writes: {c.space.manifest.write_policy}.")
        for f in c.files:
            if f.reason.startswith("locked"):
                continue
            out.extend([f"### {f.space}:{f.path} ({f.reason})", f.content])
        if c.rules:
            out.append("### Learned rules")
            for rule in c.rules:
                why = f" Why: {rule.why}" if rule.why else ""
                out.append(f"- [{rule.id}] {rule.rule}{why}")
        if c.hits:
            out.append("### Relevant files (excerpts; read in full with "
                       f"`selfhub read <path> --space {_quoted(c.space.name)}`)")
            for hit in c.hits:
                where = f"{c.space.name}:{hit.path.lstrip('/')}"
                out.append(f"- {where} [{hit.score:.2f}] {hit.excerpt}")
        out.append("")

    out.append("## After the task")
    out.append("- List the files above that you used (space:path).")
    out.append("- When the user corrects the output, propose a rule: "
               "`selfhub learn \"<rule>\" --space <narrowest space> --why \"<feedback>\" "
               "--source <deliverable>`. Never approve rules yourself.")
    if problems:
        out.append("")
        out.append("## Problems")
        out.extend(f"- {p}" for p in problems)
    return "\n".join(out).rstrip() + "\n"


def protection_steps(manifest: SpaceManifest) -> list[str]:
    """What an admin does on GitHub so the locks hold for people, not just agents."""
    if not manifest.owners:
        return [
            "Re-create with --owner @your-org/your-team, or add .github/CODEOWNERS by hand, "
            "so locked paths need an owner's review.",
        ] if manifest.locked else []
    return [
        "Push this repo to a private repo in your GitHub organization.",
        "Give each team the access it needs (Settings > Collaborators and teams): "
        "read for everyone who uses it, write only where people should save directly.",
        "Protect main (Settings > Rules > Rulesets): require a pull request, require review "
        "from Code Owners, block force pushes.",
        f"CODEOWNERS already routes {', '.join(manifest.locked) or 'the manifest'} "
        f"to {', '.join(manifest.owners)}.",
    ]


def _rules_header(space: Space, proposed: bool) -> str:
    if proposed:
        return (f"# Proposed rules — {space.name}\n\n"
                "Waiting for a human to approve (`selfhub rules approve`) or reject.\n")
    return (f"# Learned rules — {space.name}\n\n"
            "Rules the agents learned from feedback, approved by a human.\n")


def _markdown_paths(root: Path) -> list[str]:
    paths = []
    for path in sorted(root.rglob("*.md")):
        rel = path.relative_to(root)
        if path.is_file() and not any(part.startswith(".") for part in rel.parts):
            paths.append(rel.as_posix())
    return paths


def _quoted(name: str) -> str:
    return f'"{name}"' if " " in name else name


def _looks_like_remote(source: str) -> bool:
    return "://" in source or source.startswith("git@")


def _repo_name(url: str) -> str:
    tail = url.rstrip("/").rsplit("/", 1)[-1].rsplit(":", 1)[-1]
    return tail.removesuffix(".git")


def _plain_service(space: Space) -> SelfHubService:
    manifest = None if space.kind == "personal" else space.manifest
    return SelfHubService(space.path, manifest=manifest)


def _fail(message: str) -> CommandResult:
    return CommandResult(success=False, message=message)
