from __future__ import annotations

from pathlib import Path

from _pytest.monkeypatch import MonkeyPatch
from selfhub_cli.runtime import resolve_semantic_search
from selfhub_cli.settings import CLISettings


def test_resolve_semantic_search_openrouter_with_env_key(
    monkeypatch: MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    settings = CLISettings(
        embedding_provider="openrouter",
        embedding_model="openai/text-embedding-3-small",
    )

    engine = resolve_semantic_search(tmp_path, settings)

    assert engine is not None
    assert engine.config.provider == "openrouter"
    assert engine.config.model == "openai/text-embedding-3-small"


def test_resolve_semantic_search_falls_back_to_chat_provider(tmp_path: Path) -> None:
    settings = CLISettings(
        chat_provider="ollama",
        chat_model="qwen2.5:14b",
        ollama_base_url="http://localhost:11434",
    )

    engine = resolve_semantic_search(tmp_path, settings)

    assert engine is not None
    assert engine.config.provider == "ollama"
    assert engine.config.model == "qwen2.5:14b"


def test_resolve_semantic_search_openrouter_requires_api_key(tmp_path: Path) -> None:
    settings = CLISettings(
        embedding_provider="openrouter",
        embedding_model="openai/text-embedding-3-small",
    )

    engine = resolve_semantic_search(tmp_path, settings)

    assert engine is None
