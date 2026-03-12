from __future__ import annotations

from pathlib import Path

from _pytest.monkeypatch import MonkeyPatch
from selfhub_cli.settings import CLISettings, load_settings, save_settings


def test_save_and_load_settings(monkeypatch: MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SELFHUB_CONFIG_HOME", str(tmp_path / "cfg"))

    saved = save_settings(
        CLISettings(
            repo_path="/tmp/selfhub",
            github_owner="octocat",
            thinking_provider="ollama",
            thinking_model="llama3.1:8b",
            embedding_provider="openrouter",
            embedding_model="openai/text-embedding-3-small",
            chat_provider="openrouter",
            chat_model="openai/gpt-4o-mini",
            ollama_base_url="http://localhost:11434",
        )
    )

    assert saved.exists()

    loaded = load_settings()
    assert loaded.repo_path == "/tmp/selfhub"
    assert loaded.github_owner == "octocat"
    assert loaded.thinking_provider == "ollama"
    assert loaded.thinking_model == "llama3.1:8b"
    assert loaded.embedding_provider == "openrouter"
    assert loaded.embedding_model == "openai/text-embedding-3-small"
    assert loaded.chat_provider == "openrouter"
    assert loaded.chat_model == "openai/gpt-4o-mini"
    assert loaded.ollama_base_url == "http://localhost:11434"


def test_load_settings_supports_legacy_llm_fields(monkeypatch: MonkeyPatch, tmp_path: Path) -> None:
    config_dir = tmp_path / "cfg"
    monkeypatch.setenv("SELFHUB_CONFIG_HOME", str(config_dir))
    config_dir.mkdir(parents=True, exist_ok=True)
    (config_dir / "config.json").write_text(
        '{"llm_provider":"openrouter","llm_model":"openai/gpt-4o-mini"}\n',
        encoding="utf-8",
    )

    loaded = load_settings()
    assert loaded.thinking_provider == "openrouter"
    assert loaded.thinking_model == "openai/gpt-4o-mini"
    assert loaded.embedding_provider == "openrouter"
    assert loaded.embedding_model == "openai/gpt-4o-mini"
