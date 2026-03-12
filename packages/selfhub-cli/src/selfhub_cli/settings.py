from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

CONFIG_DIR_ENV = "SELFHUB_CONFIG_HOME"
CONFIG_FILENAME = "config.json"


@dataclass(slots=True)
class CLISettings:
    repo_path: str | None = None
    github_owner: str | None = None
    llm_provider: str | None = None
    llm_model: str | None = None
    ollama_base_url: str | None = None


def config_dir() -> Path:
    configured = os.getenv(CONFIG_DIR_ENV, "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".selfhub"


def config_path() -> Path:
    return config_dir() / CONFIG_FILENAME


def load_settings() -> CLISettings:
    path = config_path()
    if not path.exists():
        return CLISettings()

    raw = path.read_text(encoding="utf-8")
    if not raw.strip():
        return CLISettings()

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return CLISettings()

    if not isinstance(parsed, dict):
        return CLISettings()

    return CLISettings(
        repo_path=_as_optional_str(parsed.get("repo_path")),
        github_owner=_as_optional_str(parsed.get("github_owner")),
        llm_provider=_normalized_provider(_as_optional_str(parsed.get("llm_provider"))),
        llm_model=_as_optional_str(parsed.get("llm_model")),
        ollama_base_url=_as_optional_str(parsed.get("ollama_base_url")),
    )


def save_settings(settings: CLISettings) -> Path:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = _clean_dict(asdict(settings))
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def _as_optional_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped if stripped else None


def _normalized_provider(value: str | None) -> str | None:
    if value is None:
        return None
    lowered = value.lower()
    if lowered in {"openrouter", "ollama"}:
        return lowered
    return None


def _clean_dict(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}
