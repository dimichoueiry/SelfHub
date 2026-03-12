#!/usr/bin/env bash
set -euo pipefail

uv venv
source .venv/bin/activate
uv sync --group dev --all-packages
uv run pre-commit install

echo "Development environment is ready."
