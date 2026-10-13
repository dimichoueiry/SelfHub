"""The config half of `scripts/setup.sh`: writes every file a user would otherwise make by hand.

setup.sh checks the tools (git, gh, uv, Node) and installs the code, then runs this:

    uv run python -m selfhub_cli.onboarding [flags]

It writes, and only when they are missing:

- `config.json` in the config dir: where your own SelfHub folder is, and your GitHub login.
- your own SelfHub folder (a git repo with the standard files), if it doesn't exist yet.
- a shared space, if you want one: its `.selfhub/space.json` plus starter files, connected in
  `spaces.json`.

Running it again changes nothing. An existing config or `space.json` is only replaced after
asking, or with `--replace` when nobody is there to ask.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

import typer
from selfhub_core.git_ops import GitCommandError, commit, is_git_repo, run_git
from selfhub_core.spaces import (
    MANIFEST_PATH,
    SHARED_KINDS,
    SpaceError,
    default_manifest,
    load_manifest,
    load_registry,
    slug,
    write_manifest,
)

from selfhub_cli.service import SelfHubService
from selfhub_cli.settings import config_dir, config_path, load_settings, save_settings
from selfhub_cli.workspace import Workspace

KIND_HELP = {
    "team": "a team's shared notes, how-tos and rules",
    "client": "everything about one client: brief, rules, past work",
    "org": "company-wide rules and policies; changes go through a review",
}


@dataclass(slots=True)
class Options:
    interactive: bool
    replace: bool
    personal_path: Path | None
    github_owner: str | None
    space: bool | None
    space_name: str | None
    space_kind: str | None
    space_path: Path | None


@dataclass(slots=True)
class Report:
    written: list[str] = field(default_factory=list)
    kept: list[str] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)


def _env(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    return value or None


def parse_args(argv: list[str]) -> Options:
    parser = argparse.ArgumentParser(
        prog="selfhub-onboarding",
        description="Write SelfHub's config files. Every flag also has an env var.",
    )
    parser.add_argument(
        "--yes", "--non-interactive", dest="yes", action="store_true",
        help="Never ask; use flags, env vars and defaults (SELFHUB_NONINTERACTIVE=1)",
    )
    parser.add_argument("--replace", action="store_true",
                        help="Allow replacing an existing config.json value or space.json")
    parser.add_argument("--personal-path", type=Path,
                        help="Your own SelfHub folder (SELFHUB_PERSONAL_PATH, default ~/selfhub)")
    parser.add_argument("--github-owner",
                        help="Your GitHub username or org (SELFHUB_GITHUB_OWNER)")
    parser.add_argument("--space-name", help="Shared space name (SELFHUB_SPACE_NAME)")
    parser.add_argument("--space-kind", choices=SHARED_KINDS,
                        help="team | client | org (SELFHUB_SPACE_KIND, default team)")
    parser.add_argument("--space-path", type=Path,
                        help="Folder for the space (SELFHUB_SPACE_PATH, "
                             "default <config dir>/spaces/<name>)")
    parser.add_argument("--no-space", action="store_true",
                        help="Don't set up a shared space now (SELFHUB_NO_SPACE=1)")
    args = parser.parse_args(argv)

    kind = args.space_kind or _env("SELFHUB_SPACE_KIND")
    if kind is not None and kind not in SHARED_KINDS:
        parser.error(f"SELFHUB_SPACE_KIND must be one of {', '.join(SHARED_KINDS)}.")
    space_path = args.space_path or (Path(p) if (p := _env("SELFHUB_SPACE_PATH")) else None)
    personal = args.personal_path or (Path(p) if (p := _env("SELFHUB_PERSONAL_PATH")) else None)
    name = args.space_name or _env("SELFHUB_SPACE_NAME")
    if args.no_space or _env("SELFHUB_NO_SPACE") in {"1", "true", "yes"}:
        space: bool | None = False
    elif name or space_path:
        space = True
    else:
        space = None  # ask; non-interactive runs skip it
    noninteractive = args.yes or _env("SELFHUB_NONINTERACTIVE") in {"1", "true", "yes"}
    return Options(
        interactive=not noninteractive and sys.stdin.isatty(),
        replace=args.replace,
        personal_path=personal.expanduser() if personal else None,
        github_owner=args.github_owner or _env("SELFHUB_GITHUB_OWNER"),
        space=space,
        space_name=name,
        space_kind=kind,
        space_path=space_path.expanduser() if space_path else None,
    )


def _say(text: str = "") -> None:
    typer.echo(text)


def _ask_yes(opts: Options, question: str, default: bool) -> bool:
    if not opts.interactive:
        return default
    return bool(typer.confirm(question, default=default))


def _ask(opts: Options, question: str, default: str) -> str:
    if not opts.interactive:
        return default
    return str(typer.prompt(question, default=default)).strip() or default


# ---------- your own SelfHub ----------


def setup_personal(opts: Options, report: Report) -> Path | None:
    settings = load_settings()
    current = Path(settings.repo_path).expanduser() if settings.repo_path else None
    wanted = opts.personal_path

    if current and wanted and wanted.resolve() != current.resolve():
        replace = opts.replace or _ask_yes(
            opts,
            f"Your config says your SelfHub folder is {current}. Change it to {wanted}?",
            default=False,
        )
        path = wanted if replace else current
    elif current:
        path = current
    else:
        path = wanted or Path(
            _ask(opts, "Where should your own SelfHub folder be?", str(Path.home() / "selfhub"))
        ).expanduser()

    while path.exists() and any(path.iterdir()) and not is_git_repo(path):
        message = (
            f"{path} already has files in it and isn't a SelfHub folder. "
            "SelfHub won't touch it."
        )
        if not opts.interactive:
            report.problems.append(f"{message} Choose another folder with --personal-path.")
            return None
        _say(message)
        path = Path(typer.prompt("Choose another folder")).expanduser()

    if is_git_repo(path):
        # Never commit into an existing repo here: it may hold the user's unsaved edits.
        report.kept.append(f"Your SelfHub folder: {path} (already there, left as it is)")
    else:
        result = SelfHubService(path).init_repo()
        if not result.success:
            report.problems.append(
                f"Couldn't create your SelfHub folder at {path}: {result.message}"
            )
            return None
        report.written.append(f"Your SelfHub folder: {path}")

    changed = False
    if settings.repo_path is None or Path(settings.repo_path).expanduser() != path:
        settings.repo_path = str(path)
        changed = True
    if opts.github_owner and settings.github_owner != opts.github_owner:
        if settings.github_owner is None or opts.replace:
            settings.github_owner = opts.github_owner
            changed = True
    if changed:
        save_settings(settings)
        report.written.append(f"Settings: {config_path()}")
    else:
        report.kept.append(f"Settings: {config_path()} (already up to date)")
    return path


# ---------- a shared space ----------


def setup_space(opts: Options, personal: Path, report: Report) -> None:
    want = opts.space
    if want is None:
        if not opts.interactive:
            return
        _say("")
        _say("A space is a shared SelfHub workspace, stored as a GitHub repo: for a team,")
        _say("a client or the whole company. You can add more later from the dashboard.")
        want = _ask_yes(opts, "Set up a shared space now?", default=True)
    if not want:
        return

    workspace = Workspace(config_dir(), personal)
    name = opts.space_name or _ask(opts, "Space name", "Team")
    kind = opts.space_kind
    if kind is None:
        if opts.interactive:
            for k in ("team", "client", "org"):
                _say(f"  {k:<7}{KIND_HELP[k]}")
        kind = _ask(opts, "Kind of space (team, client or org)", "team")
        while kind not in SHARED_KINDS:
            kind = _ask(opts, "Please type team, client or org", "team")
    default_path = config_dir() / "spaces" / slug(name)
    path = opts.space_path or Path(
        _ask(opts, "Folder for this space", str(default_path))
    ).expanduser()

    registered = {s["name"].lower(): Path(s["path"]) for s in load_registry(config_dir()).spaces}
    existing = load_manifest(path) if path.exists() else None
    if existing is not None:
        same = existing.name == name and existing.kind == kind
        label = f"{path / MANIFEST_PATH}"
        if same or not (opts.replace or _ask_yes(
            opts,
            f"{label} already says this is the {existing.kind} space '{existing.name}'. "
            f"Replace it with the {kind} space '{name}'?",
            default=False,
        )):
            report.kept.append(f"Space settings: {label} (kept as it is)")
            name = existing.name
        else:
            _replace_manifest(path, name, kind, existing.owners, existing.aliases)
            report.written.append(
                f"Space settings: {label} (replaced; the old one is in git history)"
            )
        if registered.get(name.lower()) == path:
            report.kept.append(f"Space '{name}' is already connected")
            return
        result = workspace.add_space(str(path), name=name)
    elif registered.get(name.lower()) is not None:
        report.problems.append(
            f"A space named '{name}' is already connected at {registered[name.lower()]}. "
            "Pick another name."
        )
        return
    else:
        result = workspace.create_space(path, name=name, kind=kind)
        if result.success:
            report.written.append(f"Space settings: {path / MANIFEST_PATH}")
    registry_file = config_dir() / "spaces.json"
    if result.success:
        report.written.append(f"Connected space '{name}' ({kind}) in {registry_file}")
    else:
        report.problems.append(result.message or f"Couldn't set up the space '{name}'.")


def _replace_manifest(
    path: Path, name: str, kind: str, owners: list[str], aliases: list[str]
) -> None:
    write_manifest(path, default_manifest(name, kind, owners, aliases))
    if is_git_repo(path):
        try:
            run_git(["add", MANIFEST_PATH], cwd=path)
            commit(path, f"[SelfHub] set up {kind} space {name}", as_user=True)
        except GitCommandError:
            pass  # nothing changed on disk; the file is still correct


def main(argv: list[str] | None = None) -> int:
    opts = parse_args(sys.argv[1:] if argv is None else argv)
    report = Report()
    try:
        personal = setup_personal(opts, report)
        if personal is not None:
            setup_space(opts, personal, report)
    except SpaceError as exc:
        report.problems.append(str(exc))

    for line in report.written:
        _say(f"  created  {line}")
    for line in report.kept:
        _say(f"  kept     {line}")
    for line in report.problems:
        _say(f"  problem  {line}")
    return 1 if report.problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
