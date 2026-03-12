from __future__ import annotations

import os
from pathlib import Path

from selfhub_core.save_intelligence import LLMConfig, LLMSaveIntelligence, SaveIntelligence

from selfhub_cli.chat_models import ChatClient, ChatModelConfig
from selfhub_cli.secrets import SECRET_OPENROUTER_API_KEY, KeyringSecretStore
from selfhub_cli.semantic_search import EmbeddingConfig, SemanticSearchEngine
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
    provider = (
        os.getenv("SELFHUB_THINKING_PROVIDER", "").strip().lower()
        or os.getenv("SELFHUB_LLM_PROVIDER", "").strip().lower()
        or (selected.thinking_provider or "")
    )
    if not provider:
        return None

    model = (
        os.getenv("SELFHUB_THINKING_MODEL", "").strip()
        or os.getenv("SELFHUB_LLM_MODEL", "").strip()
        or selected.thinking_model
    )

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


def resolve_chat_client(settings: CLISettings | None = None) -> ChatClient | None:
    selected = settings or load_settings()
    provider = os.getenv("SELFHUB_CHAT_PROVIDER", "").strip().lower() or (
        selected.chat_provider or selected.thinking_provider or ""
    )
    if not provider:
        return None

    model = (
        os.getenv("SELFHUB_CHAT_MODEL", "").strip()
        or selected.chat_model
        or selected.thinking_model
    )
    if not model:
        return None

    if provider == "openrouter":
        api_key: str | None = os.getenv("OPENROUTER_API_KEY", "").strip() or None
        if not api_key:
            api_key = _load_secret(SECRET_OPENROUTER_API_KEY)
        if not api_key:
            return None

        config = ChatModelConfig(
            provider="openrouter",
            model=model,
            openrouter_api_key=api_key,
            ollama_base_url=None,
        )
        return ChatClient(config)

    if provider == "ollama":
        base_url = (
            os.getenv("OLLAMA_BASE_URL", "").strip()
            or selected.ollama_base_url
            or "http://localhost:11434"
        ).rstrip("/")
        config = ChatModelConfig(
            provider="ollama",
            model=model,
            openrouter_api_key=None,
            ollama_base_url=base_url,
        )
        return ChatClient(config)

    return None


def resolve_semantic_search(
    repo_path: Path,
    settings: CLISettings | None = None,
) -> SemanticSearchEngine | None:
    selected = settings or load_settings()
    provider = (
        os.getenv("SELFHUB_EMBEDDING_PROVIDER", "").strip().lower()
        or (
            selected.embedding_provider
            or selected.thinking_provider
            or selected.chat_provider
            or ""
        )
    )
    if provider not in {"openrouter", "ollama"}:
        return None

    model_override = os.getenv("SELFHUB_EMBEDDING_MODEL", "").strip()
    configured_model = selected.embedding_model or selected.thinking_model or selected.chat_model
    if provider == "openrouter":
        api_key: str | None = os.getenv("OPENROUTER_API_KEY", "").strip() or None
        if not api_key:
            api_key = _load_secret(SECRET_OPENROUTER_API_KEY)
        if not api_key:
            return None
        model = model_override or configured_model or "openai/text-embedding-3-small"
        return SemanticSearchEngine(
            repo_path=repo_path,
            config=EmbeddingConfig(
                provider="openrouter",
                model=model,
                openrouter_api_key=api_key,
                ollama_base_url=None,
            ),
        )

    base_url = (
        os.getenv("OLLAMA_BASE_URL", "").strip()
        or selected.ollama_base_url
        or "http://localhost:11434"
    ).rstrip("/")
    model = model_override or configured_model or "nomic-embed-text"
    return SemanticSearchEngine(
        repo_path=repo_path,
        config=EmbeddingConfig(
            provider="ollama",
            model=model,
            openrouter_api_key=None,
            ollama_base_url=base_url,
        ),
    )


def _load_secret(name: str) -> str | None:
    try:
        store = KeyringSecretStore()
        return store.get_secret(name)
    except Exception:
        return None
