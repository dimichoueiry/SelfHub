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

## Current Status

- Phase 0: in progress
- Commands are scaffolded and intentionally minimal.
- Core product behavior from the PRD will be implemented incrementally in upcoming phases.
