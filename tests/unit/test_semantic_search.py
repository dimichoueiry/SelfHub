from __future__ import annotations

from pathlib import Path

from selfhub_cli.semantic_search import EmbeddingConfig, SemanticSearchEngine


class FakeEmbeddingClient:
    def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for text in texts:
            lowered = text.lower()
            vector = [0.0, 0.0, 0.0]
            if any(token in lowered for token in {"work", "career", "engineer", "building"}):
                vector[0] = 1.0
            if any(token in lowered for token in {"study", "education", "university"}):
                vector[1] = 1.0
            if any(token in lowered for token in {"color", "teal", "preference"}):
                vector[2] = 1.0
            if vector == [0.0, 0.0, 0.0]:
                vector = [0.2, 0.2, 0.2]
            vectors.append(vector)
        return vectors


def _build_engine(tmp_path: Path) -> SemanticSearchEngine:
    repo = tmp_path / "selfhub"
    (repo / "experiences").mkdir(parents=True, exist_ok=True)
    (repo / "preferences").mkdir(parents=True, exist_ok=True)

    (repo / "experiences/career.md").write_text(
        "# Career\n- I build AI developer tools.\n",
        encoding="utf-8",
    )
    (repo / "experiences/education.md").write_text(
        "# Education\n- I studied computer science at university.\n",
        encoding="utf-8",
    )
    (repo / "preferences/lifestyle.md").write_text(
        "# Lifestyle\n- My favorite color is teal.\n",
        encoding="utf-8",
    )

    return SemanticSearchEngine(
        repo_path=repo,
        config=EmbeddingConfig(
            provider="ollama",
            model="fake-embeddings",
            openrouter_api_key=None,
            ollama_base_url="http://localhost:11434",
        ),
        client=FakeEmbeddingClient(),
    )


def test_semantic_search_returns_relevant_path(tmp_path: Path) -> None:
    engine = _build_engine(tmp_path)

    results = engine.search("What do I do for work?", limit=3)

    assert results
    assert results[0].path == "/experiences/career.md"
    assert "build ai developer tools" in results[0].excerpt.lower()


def test_semantic_search_builds_index_file(tmp_path: Path) -> None:
    engine = _build_engine(tmp_path)

    _ = engine.search("Where did I study?", limit=3)
    index_path = tmp_path / "selfhub/.selfhub/semantic-index.json"

    assert index_path.exists()


def test_semantic_search_rebuilds_when_file_changes(tmp_path: Path) -> None:
    engine = _build_engine(tmp_path)
    repo = tmp_path / "selfhub"

    first = engine.search("What do I do for work?", limit=3)
    assert first and "build ai developer tools" in first[0].excerpt.lower()

    (repo / "experiences/career.md").write_text(
        "# Career\n- I am now focused on platform engineering.\n",
        encoding="utf-8",
    )

    second = engine.search("What do I do for work?", limit=3)
    assert second
    assert "platform engineering" in second[0].excerpt.lower()
