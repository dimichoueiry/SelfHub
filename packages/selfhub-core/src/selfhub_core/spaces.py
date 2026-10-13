"""Spaces: more than one SelfHub repo working together.

A person's own SelfHub is one space. A company adds more, each its own git repo:

- org:    the whole company (SOPs, brand, compliance). Usually has locked paths.
- team:   one team's shared workflows (e.g. the ads team).
- client: everything about one client. Only loaded when that client is named.

Every shared space carries a manifest at `.selfhub/space.json` that says what it is,
which paths are locked, how writes land (direct commit or pull request) and which
policies apply to everyone using it. GitHub enforces the locks for real (CODEOWNERS
plus branch protection); the CLI refuses locked writes so agents never try.

Which spaces a person has connected lives in their own config dir (`spaces.json`),
next to `config.json`, together with the policies they chose for themselves.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

MANIFEST_PATH = ".selfhub/space.json"
CODEOWNERS_PATH = ".github/CODEOWNERS"
REGISTRY_FILENAME = "spaces.json"

PERSONAL_SPACE = "me"
SPACE_KINDS: tuple[str, ...] = ("personal", "org", "team", "client")
SHARED_KINDS: tuple[str, ...] = ("org", "team", "client")
WRITE_POLICIES: tuple[str, ...] = ("direct", "pull-request", "read-only")
LEARN_POLICIES: tuple[str, ...] = ("propose", "direct")

# Shared spaces load in this order, and this is also precedence: earlier wins on conflict,
# except that locked org rules beat everything.
KIND_ORDER: dict[str, int] = {"org": 0, "team": 1, "client": 2, "personal": 3}

RULES_LEARNED = "rules/learned.md"
RULES_PROPOSED = "rules/proposed.md"


class SpaceError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class PolicySpec:
    name: str
    summary: str
    instruction: str


# Policies a person can switch on for themselves, or an org can force on for everyone.
# Each one is an instruction the agent receives with every context bundle; `learn-direct`
# also changes how `selfhub learn` writes to the personal space.
POLICY_CATALOG: tuple[PolicySpec, ...] = (
    PolicySpec(
        name="ask-before-save",
        summary="Agent asks before saving anything to memory.",
        instruction=(
            "Ask the user before every `selfhub save` or `selfhub learn`; never save silently."
        ),
    ),
    PolicySpec(
        name="cite-sources",
        summary="Agent lists which memory files it used for every output.",
        instruction="End every deliverable with the list of SelfHub files you used (space:path).",
    ),
    PolicySpec(
        name="learn-from-feedback",
        summary="Agent proposes a rule whenever the user corrects its work.",
        instruction=(
            "When the user says an output was wrong or bad, propose a rule with "
            "`selfhub learn` in the narrowest space it belongs to (client before team before org)."
        ),
    ),
    PolicySpec(
        name="learn-direct",
        summary="Rules learned in your personal space apply without approval.",
        instruction="Rules learned in the personal space take effect immediately.",
    ),
    PolicySpec(
        name="draft-only",
        summary="Agent drafts but never publishes, sends or posts anything.",
        instruction="Never publish, send, post or schedule anything. Produce drafts for a human.",
    ),
)

POLICY_NAMES: tuple[str, ...] = tuple(spec.name for spec in POLICY_CATALOG)


def policy_spec(name: str) -> PolicySpec:
    for spec in POLICY_CATALOG:
        if spec.name == name:
            return spec
    raise SpaceError(f"Unknown policy '{name}'. Known: {', '.join(POLICY_NAMES)}.")


@dataclass(slots=True)
class SpaceManifest:
    name: str
    kind: str
    aliases: list[str] = field(default_factory=list)
    locked: list[str] = field(default_factory=list)
    always_load: list[str] = field(default_factory=list)
    owners: list[str] = field(default_factory=list)
    write_policy: str = "direct"
    learn_policy: str = "propose"
    policies: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(slots=True)
class Space:
    """A connected repo plus what its manifest says about it."""

    name: str
    path: Path
    manifest: SpaceManifest

    @property
    def kind(self) -> str:
        return self.manifest.kind

    def to_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "path": str(self.path),
            "kind": self.kind,
            "aliases": list(self.manifest.aliases),
            "locked": list(self.manifest.locked),
            "write_policy": self.manifest.write_policy,
            "learn_policy": self.manifest.learn_policy,
            "policies": list(self.manifest.policies),
        }


@dataclass(slots=True)
class Registry:
    """What one person has connected, and the policies they chose."""

    spaces: list[dict[str, str]] = field(default_factory=list)
    policies: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        return {"spaces": self.spaces, "policies": self.policies}


# ---------- manifest ----------


def personal_manifest() -> SpaceManifest:
    return SpaceManifest(name=PERSONAL_SPACE, kind="personal", aliases=["personal", "mine"])


def load_manifest(repo_path: Path) -> SpaceManifest | None:
    path = repo_path / MANIFEST_PATH
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SpaceError(f"{path} is not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise SpaceError(f"{path} must hold a JSON object.")
    return _manifest_from_dict(raw, source=path)


def write_manifest(repo_path: Path, manifest: SpaceManifest) -> Path:
    path = repo_path / MANIFEST_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest.to_dict(), indent=2) + "\n", encoding="utf-8")
    return path


def _manifest_from_dict(raw: dict[str, Any], source: Path) -> SpaceManifest:
    name = _str(raw.get("name"))
    kind = _str(raw.get("kind"))
    if not name:
        raise SpaceError(f"{source}: 'name' is required.")
    if kind not in SHARED_KINDS:
        raise SpaceError(f"{source}: 'kind' must be one of {', '.join(SHARED_KINDS)}.")
    write_policy = _str(raw.get("write_policy")) or "direct"
    if write_policy not in WRITE_POLICIES:
        raise SpaceError(f"{source}: 'write_policy' must be one of {', '.join(WRITE_POLICIES)}.")
    learn_policy = _str(raw.get("learn_policy")) or "propose"
    if learn_policy not in LEARN_POLICIES:
        raise SpaceError(f"{source}: 'learn_policy' must be one of {', '.join(LEARN_POLICIES)}.")
    policies = _str_list(raw.get("policies"))
    for policy in policies:
        policy_spec(policy)
    return SpaceManifest(
        name=name,
        kind=kind,
        aliases=_str_list(raw.get("aliases")),
        locked=[normalize_rel_path(p) for p in _str_list(raw.get("locked"))],
        always_load=[normalize_rel_path(p) for p in _str_list(raw.get("always_load"))],
        owners=_str_list(raw.get("owners")),
        write_policy=write_policy,
        learn_policy=learn_policy,
        policies=policies,
    )


def normalize_rel_path(path: str) -> str:
    cleaned = path.strip().replace("\\", "/").lstrip("/")
    while cleaned.startswith("./"):
        cleaned = cleaned[2:]
    return cleaned


def is_locked(manifest: SpaceManifest, rel_path: str) -> bool:
    """Locked paths are prefixes (`locked/`) or exact files (`sops/brand.md`).

    The manifest and CODEOWNERS are always locked: whoever could edit them could unlock
    everything else.
    """
    target = normalize_rel_path(rel_path)
    if manifest.kind == "personal":
        return False
    if target in {MANIFEST_PATH, CODEOWNERS_PATH}:
        return True
    for entry in manifest.locked:
        if entry.endswith("/"):
            if target.startswith(entry):
                return True
        elif target == entry or target.startswith(f"{entry}/"):
            return True
    return False


# ---------- scaffolding a shared space ----------


def default_manifest(name: str, kind: str, owners: list[str], aliases: list[str]) -> SpaceManifest:
    if kind not in SHARED_KINDS:
        raise SpaceError(f"kind must be one of {', '.join(SHARED_KINDS)}.")
    if kind == "org":
        return SpaceManifest(
            name=name,
            kind=kind,
            aliases=aliases,
            locked=["locked/"],
            owners=owners,
            write_policy="pull-request",
            learn_policy="propose",
        )
    if kind == "team":
        return SpaceManifest(
            name=name,
            kind=kind,
            aliases=aliases,
            locked=["locked/"],
            owners=owners,
            write_policy="direct",
            learn_policy="propose",
        )
    return SpaceManifest(
        name=name,
        kind=kind,
        aliases=aliases,
        always_load=["brief.md"],
        owners=owners,
        write_policy="direct",
        learn_policy="propose",
    )


def scaffold_files(manifest: SpaceManifest) -> dict[str, str]:
    """Starter files for a new shared space. Existing files are never overwritten."""
    name = manifest.name
    files: dict[str, str] = {
        "README.md": _readme(manifest),
        RULES_LEARNED: (
            f"# Learned rules — {name}\n\n"
            "Rules the agents learned from feedback, approved by a human.\n"
            "Each one says why it exists and where it came from.\n"
        ),
        RULES_PROPOSED: (
            f"# Proposed rules — {name}\n\n"
            "Waiting for a human to approve (`selfhub rules approve`) or reject.\n"
        ),
    }
    if manifest.kind in {"org", "team"}:
        files["locked/README.md"] = (
            f"# Locked — {name}\n\n"
            "Non-negotiable rules. Agents load every file here in full on every task and\n"
            "follow them over anything else. Only this space's owners can change these\n"
            "files. When the space is connected to GitHub, each change is reviewed before\n"
            "it takes effect.\n"
        )
        files["sops/README.md"] = (
            f"# SOPs — {name}\n\n"
            "One file per standard operating procedure, e.g. `sops/ads.md`.\n"
            "Write the steps an agent should follow, in order.\n"
        )
    if manifest.kind == "client":
        files["brief.md"] = (
            f"# {name} — client brief\n\n"
            "## Who they are\n\n"
            "## Services and service area\n\n"
            "## Audience\n\n"
            "## Voice and tone\n\n"
            "## Never do\n\n"
            "## Contacts\n"
        )
        files["work/README.md"] = (
            f"# Work — {name}\n\n"
            "Past deliverables and how they performed. One file per piece of work.\n"
        )
    if manifest.owners:
        files[CODEOWNERS_PATH] = codeowners_text(manifest)
    return files


def codeowners_text(manifest: SpaceManifest) -> str:
    owners = " ".join(manifest.owners)
    lines = [
        "# Generated by SelfHub. Owners must approve every change to these paths",
        "# once branch protection requires code-owner review on main.",
        f"/{MANIFEST_PATH} {owners}",
        f"/{CODEOWNERS_PATH} {owners}",
    ]
    for entry in manifest.locked:
        lines.append(f"/{entry} {owners}")
    if manifest.learn_policy == "propose":
        lines.append(f"/{RULES_LEARNED} {owners}")
    return "\n".join(lines) + "\n"


def _readme(manifest: SpaceManifest) -> str:
    kind_line = {
        "org": "Company-wide memory: SOPs, brand, compliance. Loaded on every task.",
        "team": "One team's shared workflows. Loaded on every task for its members.",
        "client": "Everything about one client. Loaded only when the task names this client.",
    }[manifest.kind]
    return (
        f"# {manifest.name}\n\n"
        f"A SelfHub {manifest.kind} space. {kind_line}\n\n"
        "- `locked/`: non-negotiable rules (owners only)\n"
        "- `rules/learned.md`: rules learned from feedback, approved by a human\n"
        "- `rules/proposed.md`: rules waiting for approval\n"
        f"- `{MANIFEST_PATH}`: what this space is and how writes land\n\n"
        "Connect it with `selfhub space add <this repo's URL or path>`.\n"
    )


# ---------- the registry (per person) ----------


def registry_path(config_dir: Path) -> Path:
    return config_dir / REGISTRY_FILENAME


def load_registry(config_dir: Path) -> Registry:
    path = registry_path(config_dir)
    if not path.exists():
        return Registry()
    try:
        raw = json.loads(path.read_text(encoding="utf-8") or "{}")
    except json.JSONDecodeError as exc:
        raise SpaceError(f"{path} is not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        return Registry()
    spaces: list[dict[str, str]] = []
    for item in raw.get("spaces", []):
        if isinstance(item, dict):
            name = _str(item.get("name"))
            path_value = _str(item.get("path"))
            if name and path_value:
                spaces.append({"name": name, "path": path_value})
    policies = [p for p in _str_list(raw.get("policies")) if p in POLICY_NAMES]
    return Registry(spaces=spaces, policies=policies)


def save_registry(config_dir: Path, registry: Registry) -> Path:
    path = registry_path(config_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(registry.to_dict(), indent=2) + "\n", encoding="utf-8")
    return path


def resolve_spaces(registry: Registry, personal_path: Path) -> tuple[list[Space], list[str]]:
    """Every connected space with its manifest, plus problems worth telling the user."""
    spaces = [Space(name=PERSONAL_SPACE, path=personal_path, manifest=personal_manifest())]
    problems: list[str] = []
    for entry in registry.spaces:
        path = Path(entry["path"]).expanduser()
        if not path.exists():
            problems.append(f"Space '{entry['name']}' is missing at {path}.")
            continue
        try:
            manifest = load_manifest(path)
        except SpaceError as exc:
            problems.append(str(exc))
            continue
        if manifest is None:
            problems.append(f"Space '{entry['name']}' has no {MANIFEST_PATH} at {path}.")
            continue
        spaces.append(Space(name=entry["name"], path=path, manifest=manifest))
    spaces.sort(key=lambda s: (KIND_ORDER.get(s.kind, 9), s.name.lower()))
    return spaces, problems


def find_space(spaces: list[Space], name: str | None) -> Space:
    wanted = (name or PERSONAL_SPACE).strip().lower()
    for space in spaces:
        if wanted == space.name.lower() or wanted in (a.lower() for a in space.manifest.aliases):
            return space
    known = ", ".join(s.name for s in spaces)
    raise SpaceError(f"No space named '{name}'. Connected: {known}.")


def slug(text: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return cleaned or "space"


# ---------- which spaces a task gets ----------


@dataclass(slots=True)
class Scope:
    included: list[Space]
    # Clients that exist but were not named. Their memory is never loaded.
    other_clients: list[str]
    reasons: dict[str, str]


def mentions(text: str, space: Space) -> bool:
    lowered = f" {re.sub(r'[^a-z0-9]+', ' ', text.lower())} "
    for term in [space.name, *space.manifest.aliases]:
        words = re.sub(r"[^a-z0-9]+", " ", term.lower()).strip()
        if words and f" {words} " in lowered:
            return True
    return False


def resolve_scope(spaces: list[Space], task: str, clients: list[str] | None = None) -> Scope:
    """Personal, org and team spaces always apply. A client applies only when the task
    names it (by name or alias) or it is passed explicitly. One client's memory never
    rides along on another client's task."""
    explicit = {c.strip().lower() for c in (clients or []) if c.strip()}
    included: list[Space] = []
    other_clients: list[str] = []
    reasons: dict[str, str] = {}
    for space in spaces:
        if space.kind != "client":
            included.append(space)
            reasons[space.name] = f"{space.kind} space: always loaded"
            continue
        names = {space.name.lower(), *(a.lower() for a in space.manifest.aliases)}
        if names & explicit:
            included.append(space)
            reasons[space.name] = "client passed with --client"
        elif not explicit and mentions(task, space):
            included.append(space)
            reasons[space.name] = "client named in the task"
        else:
            other_clients.append(space.name)
    return Scope(included=included, other_clients=other_clients, reasons=reasons)


def _str(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _str_list(value: object) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]
