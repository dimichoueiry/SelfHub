from __future__ import annotations

import os
from pathlib import Path

from selfhub_core.save_intelligence import LLMConfig, LLMSaveIntelligence, SaveIntelligence

from selfhub_cli.secrets import SECRET_OPENROUTER_API_KEY, KeyringSecretStore
from selfhub_cli.settings import CLISettings, load_settings


def resolve_repo_path(explicit_path: Path | None, settings: CLISettings | None = None) -> Path:
    if explicit_path is not None:
        return explicit_path

    selected = settings or load_settings()
    if selected.repo_path:
        return Path(selected.repo_path).expanduser()
    return Path.home() / "selfhub"


def resolve_save_intelligence(settings: CLISettings | None = None) -> SaveIntelligence | None:
    selected = settings or load_settings()
    provider = os.getenv("SELFHUB_LLM_PROVIDER", "").strip().lower() or (
        selected.llm_provider or ""
    )
    if not provider:
        return None

    model = os.getenv("SELFHUB_LLM_MODEL", "").strip() or selected.llm_model

    if provider == "openrouter":
        api_key: str | None = os.getenv("OPENROUTER_API_KEY", "").strip() or None
        if not api_key:
            api_key = _load_secret(SECRET_OPENROUTER_API_KEY)
        if not api_key:
            return None

        config = LLMConfig(
            provider="openrouter",
            model=model or "anthropic/claude-3.5-haiku",
            openrouter_api_key=api_key,
            ollama_base_url=None,
        )
        return LLMSaveIntelligence(config)

    if provider == "ollama":
        base_url = (
            os.getenv("OLLAMA_BASE_URL", "").strip()
            or selected.ollama_base_url
            or "http://localhost:11434"
        )
        config = LLMConfig(
            provider="ollama",
            model=model or "llama3.1:8b",
            openrouter_api_key=None,
            ollama_base_url=base_url.rstrip("/"),
        )
        return LLMSaveIntelligence(config)

    return None


def _load_secret(name: str) -> str | None:
    try:
        store = KeyringSecretStore()
        return store.get_secret(name)
    except Exception:
        return None
