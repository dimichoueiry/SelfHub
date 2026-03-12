from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Annotated

import typer

from selfhub_cli.runtime import resolve_repo_path, resolve_save_intelligence
from selfhub_cli.secrets import (
    SECRET_GITHUB_TOKEN,
    SECRET_OPENROUTER_API_KEY,
    KeyringSecretStore,
    SecretStoreError,
)
from selfhub_cli.service import SelfHubService
from selfhub_cli.settings import load_settings, save_settings

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
    settings = load_settings()
    root = resolve_repo_path(repo_path, settings)
    intelligence = resolve_save_intelligence(settings)
    return SelfHubService(root, save_intelligence=intelligence)


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


@app.command("setup")
def setup_command(
    as_json: Annotated[bool, typer.Option("--json", help="Emit JSON output")] = False,
) -> None:
    settings = load_settings()
    typer.echo("SelfHub setup wizard")
    typer.echo("This wizard configures your local repo and model provider.")

    default_path = str(resolve_repo_path(None, settings))
    repo_input = typer.prompt("Local SelfHub path", default=default_path).strip()
    repo_path = Path(repo_input).expanduser()

    setup_mode = typer.prompt(
        "Repo setup mode [local|remote|github]",
        default="github" if settings.github_owner else "local",
    ).strip().lower()
    if setup_mode not in {"local", "remote", "github"}:
        typer.echo("Invalid setup mode. Use local, remote, or github.")
        raise typer.Exit(code=1)

    remote_url: str | None = None
    github_owner: str | None = settings.github_owner
    github_token: str | None = None

    if setup_mode == "remote":
        remote_url = typer.prompt("Remote URL (SSH or HTTPS)").strip()
    elif setup_mode == "github":
        github_owner = typer.prompt(
            "GitHub owner (username or org)",
            default=settings.github_owner or "",
        ).strip()
        if not github_owner:
            typer.echo("GitHub owner is required for github bootstrap.")
            raise typer.Exit(code=1)
        github_token = _resolve_or_prompt_secret(
            secret_name=SECRET_GITHUB_TOKEN,
            prompt_label="GitHub token",
        )
        if github_token is None:
            typer.echo("GitHub token is required for github bootstrap.")
            raise typer.Exit(code=1)
        _store_secret(SECRET_GITHUB_TOKEN, github_token)

    service = SelfHubService(repo_path)
    init_result = service.init_repo(
        remote_url=remote_url,
        github_owner=github_owner,
        github_token=github_token,
        bootstrap_github=(setup_mode == "github"),
    )
    if not init_result.success:
        _emit(init_result.to_dict(), as_json)
        raise typer.Exit(code=1)

    model_choice = typer.prompt(
        "Model provider [openrouter|ollama|skip]",
        default=settings.llm_provider or "skip",
    ).strip().lower()
    if model_choice not in {"openrouter", "ollama", "skip"}:
        typer.echo("Invalid model provider. Use openrouter, ollama, or skip.")
        raise typer.Exit(code=1)

    configured_provider: str | None = None
    configured_model: str | None = None
    configured_ollama_url: str | None = None
    key_saved = False

    if model_choice == "openrouter":
        configured_provider = "openrouter"
        configured_model = typer.prompt(
            "OpenRouter model",
            default=settings.llm_model or "anthropic/claude-3.5-haiku",
        ).strip()
        openrouter_key = _resolve_or_prompt_secret(
            secret_name=SECRET_OPENROUTER_API_KEY,
            prompt_label="OpenRouter API key",
        )
        if openrouter_key:
            key_saved = _store_secret(SECRET_OPENROUTER_API_KEY, openrouter_key)
    elif model_choice == "ollama":
        configured_provider = "ollama"
        configured_model = typer.prompt(
            "Ollama model",
            default=settings.llm_model or "llama3.1:8b",
        ).strip()
        configured_ollama_url = typer.prompt(
            "Ollama base URL",
            default=settings.ollama_base_url or "http://localhost:11434",
        ).strip().rstrip("/")

    settings.repo_path = str(repo_path)
    settings.github_owner = github_owner
    settings.llm_provider = configured_provider
    settings.llm_model = configured_model
    settings.ollama_base_url = configured_ollama_url
    config_file = save_settings(settings)

    health_service = SelfHubService(
        repo_path,
        save_intelligence=resolve_save_intelligence(settings),
    )
    status_result = health_service.status()

    payload = {
        "success": True,
        "message": "Setup complete.",
        "data": {
            "config_path": str(config_file),
            "repo_path": str(repo_path),
            "setup_mode": setup_mode,
            "model_provider": configured_provider,
            "model": configured_model,
            "key_saved": key_saved,
            "status": status_result.data,
        },
    }
    _emit(payload, as_json)


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


def _resolve_or_prompt_secret(secret_name: str, prompt_label: str) -> str | None:
    store = _load_secret_store()
    existing: str | None = None
    if store is not None:
        try:
            existing = store.get_secret(secret_name)
        except SecretStoreError:
            existing = None

    if existing:
        use_existing = typer.confirm(
            f"Use existing {prompt_label} from keychain?",
            default=True,
        )
        if use_existing:
            return existing

    entered_value = typer.prompt(f"{prompt_label}", hide_input=True)
    entered = str(entered_value).strip()
    if not entered:
        return None
    return entered


def _store_secret(secret_name: str, value: str) -> bool:
    store = _load_secret_store()
    if store is None:
        typer.echo(
            "Warning: keychain unavailable. Set this key in environment variables for now.",
        )
        return False
    try:
        store.set_secret(secret_name, value)
        return True
    except SecretStoreError:
        typer.echo(
            "Warning: failed to store secret in keychain. Use environment variables as fallback.",
        )
        return False


def _load_secret_store() -> KeyringSecretStore | None:
    return KeyringSecretStore()
