# SelfHub

SelfHub is a CLI-first personal identity platform.

This repository currently contains **Phase 0 foundations**:

- Python uv workspace monorepo
- `selfhub-core` shared domain package
- `selfhub-cli` command package
- CI, linting, typing, and test scaffolding

## Monorepo Layout

```text
packages/
  selfhub-core/      # domain contracts and shared logic
  selfhub-cli/       # CLI entrypoint and command orchestration
tests/
  unit/
  integration/
  e2e/
docs/
.github/workflows/
```

## Quickstart (uv)

```bash
uv venv
source .venv/bin/activate
uv sync --group dev --all-packages
uv run pre-commit install
uv run pytest
uv run ruff check .
uv run mypy packages
```

## Save Classification Setup

`selfhub save` uses a dedicated **thinking model** unless `--file` is provided.

Custom folders/files are supported:

- `selfhub read` and `selfhub search` include custom markdown files.
- `selfhub save --file custom/notes.md "..."` creates and writes to custom paths.
- LLM classification can route into existing custom markdown files.
- Saves create git commits and push when a remote is configured.

## Onboarding Wizard

Run:

```bash
UV_CACHE_DIR=.uv-cache uv run selfhub setup
```

The wizard walks through:

- local repo path selection
- local/remote/GitHub bootstrap setup
- thinking model setup (backend save intelligence)
- chat model setup (interactive `/chat` mode)
- keychain storage for GitHub/OpenRouter secrets when available

Thinking model overrides via env:

```bash
export SELFHUB_THINKING_PROVIDER=openrouter
export OPENROUTER_API_KEY=...
export SELFHUB_THINKING_MODEL=anthropic/claude-3.5-haiku
```

Chat model overrides via env:

```bash
export SELFHUB_CHAT_PROVIDER=ollama
export OLLAMA_BASE_URL=http://localhost:11434
export SELFHUB_CHAT_MODEL=qwen2.5:14b
```

## Console Mode

Run:

```bash
selfhub console
```

Discover available automation-friendly commands at any time:

```bash
selfhub tools
```

In console mode:

- command mode accepts normal commands (`read`, `save`, `status`, ...)
- use `selfhub delete --file <path> --index <n>` to remove a bad saved bullet entry
- `/tools` shows all CLI and slash tools available to the current session
- `/chat` switches to conversational agent mode
- `/unchat` returns to command mode
- `/save <content>` in chat mode saves immediately
- `/save --file <path> <content>` saves to an explicit file from chat mode
- save suggestions support `1` save, `2` edit then save, `3` dismiss

## Current Status

- Phase 0: in progress
- Commands are scaffolded and intentionally minimal.
- Core product behavior from the PRD will be implemented incrementally in upcoming phases.
