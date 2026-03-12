from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from difflib import get_close_matches
from pathlib import Path
from typing import Annotated

import click
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

COMMAND_NAMES: tuple[str, ...] = (
    "init",
    "setup",
    "save",
    "read",
    "status",
    "sync",
    "log",
    "search",
)

OPTION_COMMAND_ALIASES: dict[str, str] = {
    "--init": "init",
    "--setup": "setup",
    "--save": "save",
    "--read": "read",
    "--status": "status",
    "--sync": "sync",
    "--log": "log",
    "--search": "search",
}


@dataclass(frozen=True, slots=True)
class ChoiceOption:
    value: str
    label: str
    description: str


REPO_MODE_OPTIONS: tuple[ChoiceOption, ...] = (
    ChoiceOption(
        value="local",
        label="Local only",
        description="Initialize a local SelfHub repository with no remote configured.",
    ),
    ChoiceOption(
        value="remote",
        label="Existing remote",
        description="Connect to an existing Git remote URL you already control.",
    ),
    ChoiceOption(
        value="github",
        label="GitHub bootstrap",
        description="Create or find private repo 'selfhub' on GitHub, then connect automatically.",
    ),
)

PROVIDER_OPTIONS: tuple[ChoiceOption, ...] = (
    ChoiceOption(
        value="openrouter",
        label="OpenRouter",
        description="Cloud models with broad choices and easy key-based setup.",
    ),
    ChoiceOption(
        value="ollama",
        label="Ollama local",
        description="Run local models on your machine for privacy and offline development.",
    ),
    ChoiceOption(
        value="skip",
        label="Skip for now",
        description="Finish repo setup now and configure AI models later.",
    ),
)

OPENROUTER_MODEL_OPTIONS: tuple[ChoiceOption, ...] = (
    ChoiceOption(
        value="openai/gpt-4o-mini",
        label="GPT-4o mini (cheap)",
        description="Low cost and fast. Great default for frequent save classification calls.",
    ),
    ChoiceOption(
        value="anthropic/claude-3.5-haiku",
        label="Claude 3.5 Haiku (cheap)",
        description="Very fast and affordable with strong instruction-following.",
    ),
    ChoiceOption(
        value="openai/gpt-4.1-mini",
        label="GPT-4.1 mini (balanced)",
        description="Balanced cost and quality for general-purpose daily usage.",
    ),
    ChoiceOption(
        value="anthropic/claude-3.5-sonnet",
        label="Claude 3.5 Sonnet (premium)",
        description="Higher quality reasoning and writing at higher cost.",
    ),
    ChoiceOption(
        value="openai/gpt-4o",
        label="GPT-4o (premium)",
        description="Strong all-around quality with higher per-token pricing.",
    ),
    ChoiceOption(
        value="__custom__",
        label="Custom model id",
        description="Enter any OpenRouter model identifier manually.",
    ),
)

OLLAMA_MODEL_OPTIONS: tuple[ChoiceOption, ...] = (
    ChoiceOption(
        value="llama3.1:8b",
        label="Llama 3.1 8B (lightweight)",
        description="Fast local baseline with minimal hardware requirements.",
    ),
    ChoiceOption(
        value="qwen2.5:14b",
        label="Qwen 2.5 14B (balanced)",
        description="Good local quality/latency balance for broader tasks.",
    ),
    ChoiceOption(
        value="mistral-nemo:12b",
        label="Mistral Nemo 12B (balanced)",
        description="Solid local performer with moderate resource usage.",
    ),
    ChoiceOption(
        value="llama3.1:70b",
        label="Llama 3.1 70B (powerful)",
        description="High quality local model for strong hardware setups.",
    ),
    ChoiceOption(
        value="__custom__",
        label="Custom model id",
        description="Enter any Ollama model tag manually.",
    ),
)


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
    typer.secho("SelfHub Setup Wizard", fg=typer.colors.CYAN, bold=True)
    typer.echo("This step-by-step flow configures your repository, model provider, and secrets.")
    typer.echo("Nothing is pushed remotely unless you choose a remote/GitHub mode.")

    _print_step(
        1,
        4,
        "Workspace",
        "Choose where your local SelfHub files should live on this machine.",
    )
    default_path = str(resolve_repo_path(None, settings))
    repo_input = typer.prompt("Local SelfHub path", default=default_path).strip()
    repo_path = Path(repo_input).expanduser()

    _print_step(
        2,
        4,
        "Repository Connection",
        "Pick how SelfHub should connect your local repo to a remote (if any).",
    )
    setup_mode = _choose_option(
        prompt="Repository mode",
        options=REPO_MODE_OPTIONS,
        default_value="github" if settings.github_owner else "local",
    )
    remote_url: str | None = None
    github_owner: str | None = settings.github_owner
    github_token: str | None = None

    if setup_mode == "remote":
        typer.echo("Using an existing remote keeps your current hosting setup unchanged.")
        remote_url = typer.prompt("Remote URL (SSH or HTTPS)").strip()
    elif setup_mode == "github":
        typer.echo("GitHub bootstrap will create/find private repo 'selfhub' for this account.")
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

    _print_step(
        3,
        4,
        "Model Provider",
        "Choose the model backend for save classification and duplicate detection.",
    )
    provider_default = settings.llm_provider or "skip"
    model_choice = _choose_option(
        prompt="Model provider",
        options=PROVIDER_OPTIONS,
        default_value=provider_default,
    )

    configured_provider: str | None = None
    configured_model: str | None = None
    configured_ollama_url: str | None = None
    key_saved = False

    if model_choice == "openrouter":
        configured_provider = "openrouter"
        typer.echo("OpenRouter model options (cheap, balanced, premium):")
        configured_model = _choose_model(
            provider="openrouter",
            current_model=settings.llm_model,
        )
        openrouter_key = _resolve_or_prompt_secret(
            secret_name=SECRET_OPENROUTER_API_KEY,
            prompt_label="OpenRouter API key",
        )
        if openrouter_key:
            key_saved = _store_secret(SECRET_OPENROUTER_API_KEY, openrouter_key)
    elif model_choice == "ollama":
        configured_provider = "ollama"
        typer.echo("Ollama local model options (includes Qwen):")
        configured_model = _choose_model(
            provider="ollama",
            current_model=settings.llm_model,
        )
        configured_ollama_url = typer.prompt(
            "Ollama base URL",
            default=settings.ollama_base_url or "http://localhost:11434",
        ).strip().rstrip("/")
    else:
        typer.echo("Skipping model configuration for now. You can rerun `selfhub setup` anytime.")

    _print_step(
        4,
        4,
        "Confirmation",
        "Review your choices. Setup will initialize repo structure and persist configuration.",
    )
    _print_summary(
        repo_path=repo_path,
        setup_mode=setup_mode,
        remote_url=remote_url,
        github_owner=github_owner,
        model_provider=configured_provider,
        model=configured_model,
        ollama_url=configured_ollama_url,
    )
    proceed = typer.confirm("Apply this setup now?", default=True)
    if not proceed:
        typer.echo("Setup canceled. No changes were applied.")
        raise typer.Exit(code=0)

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
    raw_args = sys.argv[1:]
    normalized_args, upfront_hint = _normalize_argv(raw_args)
    if upfront_hint:
        typer.secho(upfront_hint, fg=typer.colors.YELLOW)

    try:
        app(
            args=normalized_args,
            prog_name="selfhub",
            standalone_mode=False,
        )
    except click.ClickException as exc:
        exc.show()
        hint = _build_error_hint(exc, normalized_args)
        if hint:
            typer.secho(f"Hint: {hint}", fg=typer.colors.YELLOW)
        raise SystemExit(exc.exit_code) from exc


def _print_step(step_number: int, total_steps: int, title: str, description: str) -> None:
    typer.secho(
        f"\nStep {step_number}/{total_steps}: {title}",
        fg=typer.colors.BRIGHT_CYAN,
        bold=True,
    )
    typer.echo(description)


def _choose_option(
    prompt: str,
    options: tuple[ChoiceOption, ...],
    default_value: str,
) -> str:
    default_index = _default_option_index(options, default_value)
    for index, option in enumerate(options, start=1):
        typer.secho(f"  {index}. {option.label}", fg=typer.colors.GREEN)
        typer.echo(f"     {option.description}")

    raw_choice = typer.prompt(
        f"{prompt} (number or value)",
        default=str(default_index),
    ).strip()
    selected = _parse_option_choice(raw_choice, options)
    if selected is None:
        typer.echo("Invalid selection. Please rerun setup and choose a valid option.")
        raise typer.Exit(code=1)
    return selected


def _choose_model(provider: str, current_model: str | None) -> str:
    if provider == "openrouter":
        options = OPENROUTER_MODEL_OPTIONS
        default_model = current_model or "openai/gpt-4o-mini"
    elif provider == "ollama":
        options = OLLAMA_MODEL_OPTIONS
        default_model = current_model or "llama3.1:8b"
    else:
        raise typer.Exit(code=1)

    selected_value = _choose_option(
        prompt="Model option",
        options=options,
        default_value=default_model,
    )
    if selected_value == "__custom__":
        custom_value = typer.prompt(
            "Custom model id",
            default=current_model or "",
        )
        custom = str(custom_value).strip()
        if not custom:
            typer.echo("Model id cannot be empty.")
            raise typer.Exit(code=1)
        return custom
    return selected_value


def _print_summary(
    repo_path: Path,
    setup_mode: str,
    remote_url: str | None,
    github_owner: str | None,
    model_provider: str | None,
    model: str | None,
    ollama_url: str | None,
) -> None:
    typer.secho("Setup summary:", fg=typer.colors.BRIGHT_WHITE, bold=True)
    typer.echo(f"  repo_path: {repo_path}")
    typer.echo(f"  repository_mode: {setup_mode}")
    if remote_url:
        typer.echo(f"  remote_url: {remote_url}")
    if github_owner and setup_mode == "github":
        typer.echo(f"  github_owner: {github_owner}")
    typer.echo(f"  model_provider: {model_provider or 'none'}")
    if model:
        typer.echo(f"  model: {model}")
    if ollama_url:
        typer.echo(f"  ollama_base_url: {ollama_url}")


def _default_option_index(options: tuple[ChoiceOption, ...], value: str) -> int:
    for index, option in enumerate(options, start=1):
        if option.value == value:
            return index
    return 1


def _parse_option_choice(raw_choice: str, options: tuple[ChoiceOption, ...]) -> str | None:
    if raw_choice.isdigit():
        index = int(raw_choice)
        if 1 <= index <= len(options):
            return options[index - 1].value

    lowered = raw_choice.strip().lower()
    for option in options:
        if option.value == lowered:
            return option.value
    return None


def _normalize_argv(argv: list[str]) -> tuple[list[str], str | None]:
    if not argv:
        return (argv, None)

    first = argv[0]
    alias_target = OPTION_COMMAND_ALIASES.get(first)
    if alias_target:
        return (
            [alias_target, *argv[1:]],
            f"Interpreting `{first}` as `selfhub {alias_target}`.",
        )

    if first.startswith("--"):
        candidate = first[2:]
        if candidate in COMMAND_NAMES:
            return (
                [candidate, *argv[1:]],
                f"Interpreting `{first}` as `selfhub {candidate}`.",
            )

    if argv[-1] == "--read" and len(argv) >= 2 and not argv[0].startswith("-"):
        path = argv[0]
        remainder = argv[1:-1]
        if not remainder:
            return (
                ["read", path],
                "Interpreting trailing `--read` as `selfhub read <path>`.",
            )

    return (argv, None)


def _build_error_hint(exc: click.ClickException, argv: list[str]) -> str | None:
    if isinstance(exc, click.NoSuchOption):
        option = f"--{exc.option_name}" if exc.option_name else None
        if option and option in OPTION_COMMAND_ALIASES:
            command = OPTION_COMMAND_ALIASES[option]
            return f"`{option}` is a command-style alias. Try `selfhub {command} ...`."
        return None

    message = exc.format_message()
    if "No such command" not in message or not argv:
        return None

    token = argv[0]
    if token.startswith("--"):
        candidate = token[2:]
        if candidate in COMMAND_NAMES:
            return f"Use `selfhub {candidate} ...` (without `--`)."

    if "/" in token or token.endswith(".md"):
        return f"Looks like a file path. Try `selfhub read {token}`."

    close = get_close_matches(token, COMMAND_NAMES, n=1)
    if close:
        return f"Did you mean `selfhub {close[0]}`?"
    return None


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
