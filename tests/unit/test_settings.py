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
            llm_provider="ollama",
            llm_model="llama3.1:8b",
            ollama_base_url="http://localhost:11434",
        )
    )

    assert saved.exists()

    loaded = load_settings()
    assert loaded.repo_path == "/tmp/selfhub"
    assert loaded.github_owner == "octocat"
    assert loaded.llm_provider == "ollama"
    assert loaded.llm_model == "llama3.1:8b"
    assert loaded.ollama_base_url == "http://localhost:11434"
