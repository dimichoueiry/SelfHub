"""The agent skill pack: how Claude Code and Codex should work inside a SelfHub space.

One source, two outputs. `render_body` builds the instructions from SelfHub's own
constants and the space's manifest; `render_skill` wraps them as a Claude Code skill
(`.claude/skills/selfhub/SKILL.md`) and `render_agents_section` as a Codex AGENTS.md
section. Both carry the same text, so they can't drift.

The admin tailors the pack per space with `.selfhub/agent-skills.json` (or a file passed
with `--overrides`, kept out of the client's repo). Re-run the install after changing it.

Installing writes only between the managed markers. Anything a person wrote outside them
is kept. In a git space the installed files are listed in `.git/info/exclude` unless
`share=True`, so the pack stays on this computer instead of showing up as unsaved changes
or landing in the client's repo.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from selfhub_core.git_ops import GitCommandError, is_git_repo, run_git
from selfhub_core.history import is_tracked
from selfhub_core.repo_layout import DEFAULT_DIRECTORIES, DEFAULT_MARKDOWN_FILES
from selfhub_core.rules import read_rules
from selfhub_core.spaces import (
    CODEOWNERS_PATH,
    MANIFEST_PATH,
    RULES_LEARNED,
    RULES_PROPOSED,
    SpaceError,
    SpaceManifest,
    load_manifest,
    policy_spec,
)

SKILL_NAME = "selfhub"
SKILL_REL = Path(".claude/skills/selfhub/SKILL.md")
AGENTS_REL = Path("AGENTS.md")
GLOBAL_CODEX_REL = Path(".codex/AGENTS.md")
OVERRIDES_PATH = ".selfhub/agent-skills.json"
RULES_REJECTED = "rules/rejected.md"

BEGIN = "<!-- BEGIN:selfhub-skill-pack -->"
END = "<!-- END:selfhub-skill-pack -->"
EXCLUDE_BEGIN = "# BEGIN selfhub-skill-pack"
EXCLUDE_END = "# END selfhub-skill-pack"

SKILL_DESCRIPTION = (
    "How to work inside a SelfHub space (a folder with .selfhub/space.json, or a personal "
    "SelfHub repo): find files and their latest version, name and create files and folders, "
    "what you may edit or must never touch, how to commit and sync, and how to follow the "
    "space's rules and the user's access. Use it before reading, creating, editing, "
    "deleting or committing anything in a SelfHub space."
)

# What each standard path is for, from the scaffold in selfhub_core.spaces and the
# personal layout in selfhub_core.repo_layout.
_RULE_FILES: tuple[tuple[str, str], ...] = (
    (RULES_LEARNED, "approved rules. Follow every one."),
    (RULES_PROPOSED, "rules waiting for a human. Not in force: don't follow or approve them."),
    (RULES_REJECTED, "rules a reviewer turned down, with the reason. Not in force."),
)
_LAYOUT: dict[str, tuple[tuple[str, str], ...]] = {
    "org": (
        ("README.md", "what this space is."),
        ("locked/", "non-negotiable rules. Read every file in full; they beat everything."),
        ("sops/", "one file per standard operating procedure, e.g. `sops/ads.md`."),
        *_RULE_FILES,
    ),
    "team": (
        ("README.md", "what this space is."),
        ("locked/", "non-negotiable rules. Read every file in full; they beat everything."),
        ("sops/", "one file per standard operating procedure, e.g. `sops/google-ads.md`."),
        *_RULE_FILES,
    ),
    "client": (
        ("README.md", "what this space is."),
        ("brief.md", "who the client is, audience, voice, never-do list. Read it every task."),
        ("work/", "past deliverables and how they performed. One file per piece of work."),
        *_RULE_FILES,
    ),
    "personal": tuple(
        (f"{d}/", ", ".join(
            f"`{f}`" for f in DEFAULT_MARKDOWN_FILES if f.startswith(f"{d}/")
        ) + ".")
        for d in DEFAULT_DIRECTORIES if "/" not in d
    ),
}
_SYSTEM: tuple[tuple[str, str], ...] = (
    (MANIFEST_PATH, "the manifest: kind, locked paths, write policy, policies. Read-only."),
    (CODEOWNERS_PATH, "who must approve changes to locked paths. Read-only."),
)
_PRECEDENCE = (
    "locked rules",
    "the user's instructions for this task",
    "client memory",
    "team, then org SOPs and learned rules",
    "the user's personal workflows and preferences",
)
_KNOWN_KEYS = {"company", "tone", "folders", "protect", "ask_first", "instructions"}


class SkillsError(RuntimeError):
    pass


@dataclass(slots=True)
class Overrides:
    """What an admin may change per space. Everything is optional."""

    company: str = ""
    tone: str = ""
    folders: dict[str, str] = field(default_factory=dict)
    protect: list[str] = field(default_factory=list)
    ask_first: list[str] = field(default_factory=list)
    instructions: list[str] = field(default_factory=list)


@dataclass(slots=True)
class PackContext:
    """The facts the pack is rendered from. `kind` None means a global, any-space pack."""

    kind: str | None = None
    name: str = ""
    locked: list[str] = field(default_factory=list)
    always_load: list[str] = field(default_factory=list)
    write_policy: str = "direct"
    learn_policy: str = "propose"
    policies: list[str] = field(default_factory=list)
    extra_folders: list[str] = field(default_factory=list)
    rule_count: int = 0
    overrides: Overrides = field(default_factory=Overrides)


@dataclass(slots=True)
class InstallAction:
    path: Path
    action: str  # "create" | "update" | "unchanged"

    def to_dict(self) -> dict[str, str]:
        return {"path": str(self.path), "action": self.action}


# ---------- overrides ----------


def load_overrides(path: Path) -> Overrides:
    if not path.exists():
        return Overrides()
    try:
        raw = json.loads(path.read_text(encoding="utf-8") or "{}")
    except json.JSONDecodeError as exc:
        raise SkillsError(f"{path} is not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise SkillsError(f"{path} must hold a JSON object.")
    unknown = sorted(set(raw) - _KNOWN_KEYS)
    if unknown:
        known = ", ".join(sorted(_KNOWN_KEYS))
        raise SkillsError(f"{path}: unknown setting {', '.join(unknown)}. Known: {known}.")
    folders = raw.get("folders", {})
    if not isinstance(folders, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in folders.items()
    ):
        raise SkillsError(f"{path}: 'folders' must map a path to what goes there.")
    return Overrides(
        company=_text(raw, "company", path),
        tone=_text(raw, "tone", path),
        folders={k.strip(): v.strip() for k, v in folders.items() if k.strip()},
        protect=_lines(raw, "protect", path),
        ask_first=_lines(raw, "ask_first", path),
        instructions=_lines(raw, "instructions", path),
    )


def _text(raw: dict[str, Any], key: str, path: Path) -> str:
    value = raw.get(key, "")
    if not isinstance(value, str):
        raise SkillsError(f"{path}: '{key}' must be text.")
    return value.strip()


def _lines(raw: dict[str, Any], key: str, path: Path) -> list[str]:
    value = raw.get(key, [])
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise SkillsError(f"{path}: '{key}' must be a list of text.")
    return [v.strip() for v in value if v.strip()]


# ---------- context ----------


def space_context(space: Path, overrides_path: Path | None = None) -> PackContext:
    """Read what the pack needs from a space folder: manifest, rules, folders, overrides."""
    try:
        manifest = load_manifest(space)
    except SpaceError as exc:
        raise SkillsError(str(exc)) from exc
    overrides = load_overrides(overrides_path or space / OVERRIDES_PATH)
    _, rules = read_rules(space / RULES_LEARNED)
    if manifest is None:
        ctx = PackContext(kind="personal", name="your personal SelfHub")
    else:
        ctx = _from_manifest(manifest)
    ctx.rule_count = len(rules)
    ctx.overrides = overrides
    known = {p.split("/")[0] for p, _ in _LAYOUT.get(ctx.kind or "", ())}
    known |= {p.split("/")[0] for p in overrides.folders}
    ctx.extra_folders = sorted(
        p.name for p in space.iterdir()
        if p.is_dir() and not p.name.startswith(".") and p.name not in known
    ) if space.is_dir() else []
    return ctx


def _from_manifest(manifest: SpaceManifest) -> PackContext:
    return PackContext(
        kind=manifest.kind,
        name=manifest.name,
        locked=list(manifest.locked),
        always_load=list(manifest.always_load),
        write_policy=manifest.write_policy,
        learn_policy=manifest.learn_policy,
        policies=list(manifest.policies),
    )


# ---------- rendering (the one source) ----------


def render_sections(ctx: PackContext) -> tuple[str, list[tuple[str, list[str]]]]:
    """The title and (heading, lines) sections both outputs are built from."""
    o = ctx.overrides
    label = o.company or ctx.name
    title = f"SelfHub space: {label}" if ctx.kind else "Working in a SelfHub space"
    sections: list[tuple[str, list[str]]] = [
        ("This space", _about(ctx)),
        ("Before any task", _before(ctx)),
        ("Where things live", _where(ctx)),
        ("Find things", _find(ctx)),
        ("Create files and folders", _create(ctx)),
        ("What you may change", _may(ctx)),
        ("Never", _never(ctx)),
        ("Ask the user first", _ask_first(ctx)),
        ("Record a change", _record(ctx)),
        ("Access", _access()),
        ("Only on this computer, or sync failed", _offline()),
    ]
    rules = _rules(ctx)
    if rules:
        sections.append(("Rules and policies", rules))
    admin = _admin(ctx)
    if admin:
        sections.append(("From the admin", admin))
    return title, sections


def render_body(ctx: PackContext, level: int = 1) -> str:
    title, sections = render_sections(ctx)
    hashes = "#" * level
    out = [f"{hashes} {title}", ""]
    for heading, lines in sections:
        out += [f"{hashes}# {heading}", "", *lines, ""]
    return "\n".join(out).rstrip() + "\n"


def _managed_note(ctx: PackContext) -> str:
    where = f"`{OVERRIDES_PATH}`" if ctx.kind else "an overrides file"
    return (
        "<!-- Managed by `selfhub skills install`. Edits inside this block are replaced on "
        f"the next install. Write outside it, or customise with {where}. -->"
    )


def render_skill(ctx: PackContext) -> str:
    """The managed block of the Claude Code skill (without front-matter)."""
    return f"{BEGIN}\n{_managed_note(ctx)}\n\n{render_body(ctx, level=1)}{END}\n"


def render_agents_section(ctx: PackContext) -> str:
    """The managed block for AGENTS.md. Same text, one heading level down."""
    return f"{BEGIN}\n{_managed_note(ctx)}\n\n{render_body(ctx, level=2)}{END}\n"


def skill_front_matter() -> str:
    return f"---\nname: {SKILL_NAME}\ndescription: {SKILL_DESCRIPTION}\n---\n\n"


def _about(ctx: PackContext) -> list[str]:
    if ctx.kind is None:
        return [
            "- A SelfHub space is a folder backed by a git repo. Shared spaces (org, team, "
            f"client) have `{MANIFEST_PATH}`; a personal SelfHub has `meta/profile.md`.",
            f"- Find the space root: the nearest parent folder with `{MANIFEST_PATH}` or "
            "`meta/profile.md`. Paths below are relative to it.",
            f"- Read `{MANIFEST_PATH}` first: its `kind`, `locked`, `always_load`, "
            "`write_policy` and `policies` apply to everything below.",
        ]
    lines = [f"- Name: {ctx.name}. Kind: {ctx.kind}. {_kind_line(ctx.kind)}"]
    if ctx.kind != "personal":
        lines.append(f"- Writes: {ctx.write_policy}. {_write_line(ctx.write_policy)}")
        lines.append(
            f"- `{MANIFEST_PATH}` is the source of truth. If it disagrees with this file, "
            "it wins."
        )
    return lines


def _kind_line(kind: str) -> str:
    return {
        "org": "Company-wide SOPs, brand and compliance. Loaded on every task.",
        "team": "One team's shared workflows. Loaded on every task for its members.",
        "client": "Everything about one client. Use it only on tasks for this client.",
        "personal": "One person's own memory. Loaded on every task.",
    }[kind]


def _write_line(policy: str) -> str:
    return {
        "direct": "Commit on the current branch and push.",
        "pull-request": "Every change goes on a new branch and a pull request. Never push "
        "to main.",
        "read-only": "Write nothing here.",
    }[policy]


def _before(ctx: PackContext) -> list[str]:
    full = _full_reads(ctx)
    return [
        f"1. Get the latest version: `{_sync_cmd(ctx)}`, or `git pull --ff-only`. If it "
        "fails, see \"Only on this computer, or sync failed\".",
        "2. If the `selfhub` CLI is installed, run `selfhub context \"<task, naming the "
        "client>\" --json` and follow it. It lists the locked rules, learned rules, policies "
        "and the files to read.",
        f"3. Without the CLI, read in this order: {full}.",
        "4. On conflict, follow the highest of: "
        + "; ".join(f"({i}) {p}" for i, p in enumerate(_PRECEDENCE, 1)) + ".",
    ]


def _sync_cmd(ctx: PackContext) -> str:
    if ctx.kind is None:
        return "selfhub sync --space <space>"
    return "selfhub sync" + (f" --space {_cli_name(ctx)}" if ctx.kind != "personal" else "")


def _full_reads(ctx: PackContext) -> str:
    if ctx.kind is None:
        return (
            f"every file under the `locked` paths in `{MANIFEST_PATH}`, every `always_load` "
            f"file, then `{RULES_LEARNED}`"
        )
    parts = [f"every file under `{p}`" for p in ctx.locked]
    parts += [f"`{p}`" for p in ctx.always_load]
    if ctx.kind != "personal":
        parts.append(f"`{RULES_LEARNED}`")
    else:
        parts.append("`meta/profile.md`")
    return ", then ".join(parts)


def _where(ctx: PackContext) -> list[str]:
    if ctx.kind is None:
        layout = [
            ("README.md", "what the space is."),
            ("locked/", "org and team spaces: non-negotiable rules, read in full."),
            ("sops/", "org and team spaces: one file per procedure."),
            ("brief.md", "client spaces: who the client is. Read it every task."),
            ("work/", "client spaces: past deliverables, one file each."),
            *_RULE_FILES,
            ("preferences/, voice/, experiences/, relationships/, goals/, meta/",
             "a personal SelfHub."),
        ]
    else:
        layout = list(_LAYOUT[ctx.kind])
    if ctx.kind != "personal":
        layout += list(_SYSTEM)
    layout += list(ctx.overrides.folders.items())
    lines = [_item(path, what) for path, what in layout]
    lines += [f"- `{name}/`: see its `README.md` if it has one." for name in ctx.extra_folders]
    return lines


def _item(path: str, what: str) -> str:
    shown = ", ".join(f"`{p.strip()}`" for p in path.split(","))
    return f"- {shown}: {what}" if what else f"- {shown}"


def _find(ctx: PackContext) -> list[str]:
    space = f" --space {_cli_name(ctx)}" if ctx.kind not in (None, "personal") else ""
    return [
        f"- Search: `selfhub search \"<words>\"{space}`, or `rg -n \"<words>\" --glob '!.git'`.",
        "- Latest version of a file: sync first, then `git log -1 --format='%h %ad %an' -- "
        f"<path>`. History: `selfhub log --file <path>{space}`.",
        "- Dated files (`work/YYYY-MM-DD-...`): the newest date prefix is the newest work.",
        "- In a file, newer entries are further down. `selfhub save` appends "
        "`- <text> (saved <time> via <tool>)`.",
        "- Use only spaces the task needs. Never use one client's files on another "
        "client's work.",
    ]


def _cli_name(ctx: PackContext) -> str:
    name = ctx.name
    return f'"{name}"' if " " in name else name


def _create(ctx: PackContext) -> list[str]:
    lines = [
        "- Search first. If a file on the topic exists, add to it instead of making a new one.",
        "- Names: lowercase words joined by hyphens, e.g. `notes/kickoff-call.md`. No spaces. "
        "Never use `? * : < > | \" \\`, and never end a name with a dot or a space.",
        "- Use `.md`. Use `.csv`, `.json` or `.yaml` only for tables or data.",
        "- Start every file with one `# Title` line. No YAML front-matter.",
        "- One topic per file. Put it in the existing folder that fits. Make a new top-level "
        "folder only when the user asks, and give it a `README.md` saying what goes in it.",
    ]
    if ctx.kind in (None, "client"):
        lines.append(
            "- Deliverables: `work/YYYY-MM-DD-<short-name>.md`, dated the day of the work, "
            "e.g. `work/2026-10-12-spring-promo.md`."
        )
    if ctx.kind in (None, "org", "team"):
        lines.append("- Procedures: `sops/<topic>.md`.")
    lines.append(
        "- If `templates/` exists, start from the matching template and keep its headings."
    )
    return lines


def _may(ctx: PackContext) -> list[str]:
    if ctx.kind is not None and ctx.kind != "personal" and ctx.write_policy == "read-only":
        return ["- Nothing. This space is read-only. Draft changes in chat for a human."]
    learn = ("selfhub learn \"<rule>\"" + (f" --space {_cli_name(ctx)}"
             if ctx.kind not in (None, "personal") else " --space <space>")
             + " --why \"<feedback>\" --source <path>")
    return [
        "- Append new facts, notes and results to the end of the right file or section.",
        "- Edit the section the user asked you to change. Leave the rest as it is.",
        "- Create new files in the folder that fits, following the naming rules above.",
        f"- Propose a rule when the user corrects your work: `{learn}`. It waits for a human.",
    ]


def _never(ctx: PackContext) -> list[str]:
    locked = [MANIFEST_PATH, CODEOWNERS_PATH, *ctx.locked]
    if ctx.kind is None:
        locked_line = (
            f"- Write to a locked path: `{MANIFEST_PATH}`, `{CODEOWNERS_PATH}`, or anything "
            "listed in the manifest's `locked`. Only its owners change those, through review."
        )
    elif ctx.kind == "personal":
        locked_line = ""
    else:
        locked_line = (
            "- Write to a locked path: " + ", ".join(f"`{p}`" for p in locked)
            + ". Only the owners change those, through review."
        )
    protect = ctx.overrides.protect
    lines = [
        locked_line,
        f"- Edit `{OVERRIDES_PATH}`, `.claude/skills/selfhub/` or the SelfHub block in "
        "`AGENTS.md`.",
        *([f"- Write to {', '.join(f'`{p}`' for p in protect)} (protected by the admin)."]
          if protect else []),
        f"- Hand-edit `{RULES_LEARNED}`, `{RULES_PROPOSED}` or `{RULES_REJECTED}`, or run "
        "`selfhub rules approve` / `reject`. Approving rules is a human's job.",
        "- Delete, rename, move or replace a whole file without the user's explicit yes.",
        "- Rewrite history: no `git push --force`, `git reset --hard`, or rebasing or "
        "amending commits that were pushed.",
        "- Stage everything with `git add -A` or `git add .`. Stage only the files you changed.",
        "- Commit changes you didn't make. Leave other people's unsaved edits alone.",
        "- Touch `.git/`, add a remote, create a GitHub repo or change who has access.",
    ]
    if "draft-only" in ctx.policies:
        lines.append("- Publish, send, post or schedule anything. Produce drafts for a human.")
    return [line for line in lines if line]


def _ask_first(ctx: PackContext) -> list[str]:
    lines = [
        "- Before deleting, renaming, moving, or rewriting more than the section you were "
        "asked to change.",
        "- Before creating a new top-level folder.",
        "- When the task needs a locked or protected file: draft the change in chat and say "
        "who can make it.",
        "- When it isn't clear which client or space the work belongs to.",
    ]
    if "ask-before-save" in ctx.policies:
        lines.append("- Before every `selfhub save` or `selfhub learn`. Never save silently.")
    lines += [f"- {item}" for item in ctx.overrides.ask_first]
    return lines


def _record(ctx: PackContext) -> list[str]:
    policy = ctx.write_policy if ctx.kind not in (None, "personal") else "direct"
    lines = [
        "- To add a fact, prefer `selfhub save \"<text>\" --file <path>"
        + (f" --space {_cli_name(ctx)}" if ctx.kind not in (None, "personal") else "")
        + "`. It commits and sends the change for you.",
        "- Otherwise: `git add <the files you changed>`, then `git commit -m \"<message>\"`.",
        "- Message: imperative, sentence case, under 72 characters, says what changed and "
        "where. Example: `Add spring promo results to work/2026-10-12-spring-promo.md`.",
        "- Don't start a message with `[SelfHub]`. That prefix marks SelfHub's own commits.",
        "- One change per commit. Tell the user the commit id and the files.",
    ]
    if ctx.kind is None:
        lines += [
            "- Then follow the manifest's `write_policy`:",
            f"  - `direct`: {_write_line('direct')}",
            "  - `pull-request`: " + _pr_steps(),
            f"  - `read-only`: {_write_line('read-only')}",
        ]
    elif policy == "pull-request":
        lines.append("- Then: " + _pr_steps())
    elif policy == "direct":
        lines.append("- Then push: `git push`.")
    return lines


def _pr_steps() -> str:
    return (
        "commit on a new branch `selfhub/<short-name>-<YYYYMMDD-HHMMSS>`, push it, open a "
        "pull request with `gh pr create`, then switch back. Never push to main."
    )


def _access() -> list[str]:
    return [
        "- You act with the access of the person you work for. It comes from their GitHub "
        "permission on the space's repo:",
        "  - Can view (read): read only. Don't write; draft changes in chat.",
        "  - Can edit (write): change anything that isn't locked.",
        "  - Admin: the same as Can edit, plus people and rule approval. You still never "
        "approve rules or change access.",
        "- Not sure? `gh api repos/<owner>/<repo> --jq .permissions`. If a push is refused "
        "for permission, stop and tell the user.",
    ]


def _offline() -> list[str]:
    return [
        "- No remote (`git remote` prints nothing): the space is only on this computer. "
        "Commit as usual and tell the user it isn't backed up or shared until they connect "
        "it to GitHub. Don't connect it yourself.",
        "- Pull or push failed (network, login): keep the commit. Don't retry in a loop. "
        "Tell the user: \"Saved on this computer; sending to GitHub failed. Sync again "
        "with `selfhub sync` or Sync in the dashboard.\"",
        "- Conflict, or the pull isn't a fast-forward: stop. Don't force, reset or guess at "
        "someone else's change. Show the user the files and ask.",
    ]


def _rules(ctx: PackContext) -> list[str]:
    lines: list[str] = []
    if ctx.kind not in (None, "personal"):
        count = f" ({ctx.rule_count} approved at install)" if ctx.rule_count else ""
        lines.append(
            f"- Read `{RULES_LEARNED}`{count} on every task. It changes; this file doesn't "
            "copy it."
        )
        if ctx.learn_policy == "propose":
            lines.append("- New rules wait for a human's approval before they apply.")
    for name in ctx.policies:
        try:
            lines.append(f"- Policy `{name}`: {policy_spec(name).instruction}")
        except SpaceError:
            continue
    return lines


def _admin(ctx: PackContext) -> list[str]:
    o = ctx.overrides
    lines = []
    if o.company:
        lines.append(f"- Company: {o.company}.")
    if o.tone:
        lines.append(f"- Tone for anything you write here: {o.tone}")
    lines += [f"- {item}" for item in o.instructions]
    return lines


# ---------- installing ----------


def upsert_block(existing: str, block: str) -> str:
    """Put the managed block in `existing`, replacing an older one, keeping the rest."""
    begins, ends = existing.count(BEGIN), existing.count(END)
    if begins == 0 and ends == 0:
        if not existing.strip():
            return block
        return existing.rstrip("\n") + "\n\n" + block
    if begins != 1 or ends != 1 or existing.index(BEGIN) > existing.index(END):
        raise SkillsError(
            "The SelfHub block markers are damaged (missing, repeated or out of order). "
            f"Fix them by hand: one {BEGIN} line, then one {END} line."
        )
    start = existing.index(BEGIN)
    stop = existing.index(END) + len(END)
    if existing[stop:stop + 1] == "\n":
        stop += 1
    return existing[:start] + block + existing[stop:]


def install_skills(
    space: Path | None = None,
    global_home: Path | None = None,
    overrides: Path | None = None,
    dry_run: bool = False,
    share: bool = False,
) -> list[InstallAction]:
    """Install the pack into a space and/or a home folder. Safe to run again.

    space:        writes `<space>/.claude/skills/selfhub/SKILL.md` and `<space>/AGENTS.md`.
    global_home:  writes `<home>/.claude/skills/selfhub/SKILL.md` and `<home>/.codex/AGENTS.md`
                  with the any-space version (pass `Path.home()` for the real one).
    overrides:    an admin's overrides file; defaults to `<space>/.selfhub/agent-skills.json`.
    share:        leave the installed files visible to git so they can be committed.
    """
    if space is None and global_home is None:
        raise SkillsError("Nothing to install: pass a space, a home folder, or both.")
    actions: list[InstallAction] = []
    if space is not None:
        if not space.is_dir():
            raise SkillsError(f"{space} is not a folder.")
        ctx = space_context(space, overrides)
        actions += _write_pair(space / SKILL_REL, space / AGENTS_REL, ctx, dry_run)
        if not share and is_git_repo(space):
            actions += _exclude(space, dry_run)
    if global_home is not None:
        ctx = PackContext(overrides=load_overrides(overrides) if overrides else Overrides())
        actions += _write_pair(
            global_home / SKILL_REL, global_home / GLOBAL_CODEX_REL, ctx, dry_run
        )
    return actions


def _write_pair(skill: Path, agents: Path, ctx: PackContext, dry_run: bool
                ) -> list[InstallAction]:
    return [
        _write(skill, render_skill(ctx), skill_front_matter(), dry_run),
        _write(agents, render_agents_section(ctx), "", dry_run),
    ]


def _write(path: Path, block: str, header: str, dry_run: bool) -> InstallAction:
    if path.exists():
        current = path.read_text(encoding="utf-8")
        updated = upsert_block(current, block)
        if updated == current:
            return InstallAction(path, "unchanged")
        action = "update"
    else:
        updated, action = header + block, "create"
    if not dry_run:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(updated, encoding="utf-8")
    return InstallAction(path, action)


def _exclude(space: Path, dry_run: bool) -> list[InstallAction]:
    """Keep the installed pack out of commits: list it in .git/info/exclude."""
    try:
        rel = run_git(["rev-parse", "--git-path", "info/exclude"], cwd=space).stdout
    except GitCommandError:
        return []
    path = Path(rel) if Path(rel).is_absolute() else space / rel
    entries = [f"/{SKILL_REL.parent.as_posix()}/"]
    if not is_tracked(space, AGENTS_REL.as_posix()):
        entries.append(f"/{AGENTS_REL.as_posix()}")
    block = "\n".join([EXCLUDE_BEGIN, *entries, EXCLUDE_END]) + "\n"
    current = path.read_text(encoding="utf-8") if path.exists() else ""
    if EXCLUDE_BEGIN in current and EXCLUDE_END in current:
        start = current.index(EXCLUDE_BEGIN)
        stop = current.index(EXCLUDE_END) + len(EXCLUDE_END)
        stop += 1 if current[stop:stop + 1] == "\n" else 0
        updated = current[:start] + block + current[stop:]
    else:
        updated = (current.rstrip("\n") + "\n" if current.strip() else "") + block
    if updated == current:
        return [InstallAction(path, "unchanged")]
    if not dry_run:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(updated, encoding="utf-8")
    return [InstallAction(path, "update" if current else "create")]
