from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Annotated

import typer

from selfhub_cli.service import SelfHubService

app = typer.Typer(help="SelfHub CLI")


def _emit(payload: dict[str, object], as_json: bool) -> None:
    if as_json:
        typer.echo(json.dumps(payload, indent=2))
    else:
        message = payload.get("message")
        if isinstance(message, str):
            typer.echo(message)
        else:
            typer.echo("Done.")


def _service(repo_path: Path | None) -> SelfHubService:
    root = repo_path or Path.home() / "selfhub"
    return SelfHubService(root)


@app.command("init")
def init_command(
    repo_path: Annotated[Path | None, typer.Option(help="Local SelfHub clone path")] = None,
    remote_url: Annotated[str | None, typer.Option(help="Optional git remote URL")] = None,
    github_owner: Annotated[str | None, typer.Option(help="GitHub owner for bootstrap")] = None,
    github_token_env: Annotated[
        str, typer.Option(help="Env var name holding GitHub token")
    ] = "GITHUB_TOKEN",
    bootstrap_github: Annotated[
        bool, typer.Option(help="Create/find GitHub repo before local initialization")
    ] = False,
    as_json: Annotated[bool, typer.Option("--json", help="Emit JSON output")] = False,
) -> None:
    result = _service(repo_path).init_repo(
        remote_url=remote_url,
        github_owner=github_owner,
        github_token_env=github_token_env,
        bootstrap_github=bootstrap_github,
    )
    _emit(result.to_dict(), as_json)


@app.command("save")
def save_command(
    content: Annotated[str, typer.Argument(help="Content to save")],
    file_path: Annotated[
        str | None, typer.Option("--file", help="Optional target file path")
    ] = None,
    tool_name: Annotated[str, typer.Option(help="Tool name attributed in commit metadata")] = (
        "SelfHub CLI"
    ),
    on_duplicate: Annotated[
        str | None, typer.Option(help="Duplicate behavior: add | update")
    ] = None,
    repo_path: Annotated[Path | None, typer.Option(help="Local SelfHub clone path")] = None,
    as_json: Annotated[bool, typer.Option("--json", help="Emit JSON output")] = False,
) -> None:
    service = _service(repo_path)
    result = service.save(
        content=content,
        file_path=file_path,
        tool_name=tool_name,
        on_duplicate=on_duplicate,
    )

    interactive = (not as_json) and sys.stdin.isatty()
    while interactive and not result.success:
        data = result.data
        if not data:
            break

        if data.get("needs_target_confirmation") is True:
            suggested = data.get("suggested_file")
            default_choice = str(suggested) if isinstance(suggested, str) else "meta/profile.md"
            use_default = typer.confirm(
                f"Save to '{default_choice}'?",
                default=True,
            )
            chosen = default_choice
            if not use_default:
                chosen = typer.prompt("Enter target file path")
            result = service.save(
                content=content,
                file_path=chosen,
                tool_name=tool_name,
                on_duplicate=on_duplicate,
            )
            continue

        if data.get("needs_duplicate_resolution") is True:
            choice = typer.prompt(
                "Potential duplicate detected. Choose action (add/update)",
                default="update",
            ).strip().lower()
            if choice not in {"add", "update"}:
                typer.echo("Invalid choice. Use 'add' or 'update'.")
                raise typer.Exit(code=1)
            target_file = data.get("target_file")
            forced_file = str(target_file) if isinstance(target_file, str) else file_path
            result = service.save(
                content=content,
                file_path=forced_file,
                tool_name=tool_name,
                on_duplicate=choice,
            )
            continue

        break

    _emit(result.to_dict(), as_json)


@app.command("read")
def read_command(
    target: Annotated[str | None, typer.Argument(help="Optional folder or file path")] = None,
    repo_path: Annotated[Path | None, typer.Option(help="Local SelfHub clone path")] = None,
    as_json: Annotated[bool, typer.Option("--json", help="Emit JSON output")] = False,
) -> None:
    result = _service(repo_path).read(target=target)
    _emit(result.to_dict(), as_json)


@app.command("status")
def status_command(
    repo_path: Annotated[Path | None, typer.Option(help="Local SelfHub clone path")] = None,
    as_json: Annotated[bool, typer.Option("--json", help="Emit JSON output")] = False,
) -> None:
    result = _service(repo_path).status()
    _emit(result.to_dict(), as_json)


@app.command("sync")
def sync_command(
    repo_path: Annotated[Path | None, typer.Option(help="Local SelfHub clone path")] = None,
    as_json: Annotated[bool, typer.Option("--json", help="Emit JSON output")] = False,
) -> None:
    result = _service(repo_path).sync()
    _emit(result.to_dict(), as_json)


@app.command("log")
def log_command(
    file_path: Annotated[
        str | None, typer.Option("--file", help="Optional file path filter")
    ] = None,
    limit: Annotated[int, typer.Option(help="Maximum number of commits to return")] = 20,
    repo_path: Annotated[Path | None, typer.Option(help="Local SelfHub clone path")] = None,
    as_json: Annotated[bool, typer.Option("--json", help="Emit JSON output")] = False,
) -> None:
    result = _service(repo_path).log(file_path=file_path, limit=limit)
    _emit(result.to_dict(), as_json)


@app.command("search")
def search_command(
    query: Annotated[str, typer.Argument(help="Search query")],
    mode: Annotated[str, typer.Option(help="Search mode: exact | semantic | hybrid")] = "hybrid",
    repo_path: Annotated[Path | None, typer.Option(help="Local SelfHub clone path")] = None,
    as_json: Annotated[bool, typer.Option("--json", help="Emit JSON output")] = False,
) -> None:
    results = _service(repo_path).search(query=query, mode=mode)
    payload = {
        "success": True,
        "message": f"Found {len(results)} result(s)",
        "results": [item.to_dict() for item in results],
    }
    _emit(payload, as_json)


def main() -> None:
    app()
