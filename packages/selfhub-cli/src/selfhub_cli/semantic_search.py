from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from urllib import error, request

from selfhub_core.contracts import SearchResult


class SemanticSearchError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class EmbeddingConfig:
    provider: str
    model: str
    openrouter_api_key: str | None
    ollama_base_url: str | None


@dataclass(frozen=True, slots=True)
class SemanticChunk:
    path: str
    start_line: int
    end_line: int
    text: str
    vector: list[float]


class EmbeddingClient(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]:
        ...


class SemanticSearchEngine:
    INDEX_VERSION = 1
    INDEX_DIR = ".selfhub"
    INDEX_FILE = "semantic-index.json"

    def __init__(
        self,
        repo_path: Path,
        config: EmbeddingConfig,
        client: EmbeddingClient | None = None,
    ) -> None:
        self.repo_path = repo_path
        self.config = config
        self.client = client or HTTPEmbeddingClient(config)

    def search(self, query: str, limit: int = 8) -> list[SearchResult]:
        cleaned_query = query.strip()
        if not cleaned_query:
            return []
        safe_limit = max(1, min(limit, 25))

        payload = self._load_or_build_index()
        chunks = self._parse_chunks(payload)
        if not chunks:
            return []

        query_vectors = self.client.embed([cleaned_query])
        if not query_vectors or not query_vectors[0]:
            return []
        query_vector = query_vectors[0]

        scored: list[SearchResult] = []
        for chunk in chunks:
            score = _cosine_similarity(query_vector, chunk.vector)
            if score <= 0:
                continue
            scored.append(
                SearchResult(
                    path=f"/{chunk.path}",
                    excerpt=_truncate_excerpt(chunk.text),
                    score=_normalize_score(score),
                )
            )
        scored.sort(key=lambda item: item.score, reverse=True)
        return _dedupe_results(scored, limit=safe_limit)

    def _load_or_build_index(self) -> dict[str, Any]:
        index_path = self.repo_path / self.INDEX_DIR / self.INDEX_FILE
        existing = self._read_json(index_path)
        file_state = self._markdown_file_state()
        if self._is_index_fresh(existing, file_state):
            return existing
        rebuilt = self._rebuild_index(file_state)
        index_path.parent.mkdir(parents=True, exist_ok=True)
        index_path.write_text(
            json.dumps(rebuilt, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return rebuilt

    def _rebuild_index(self, file_state: dict[str, str]) -> dict[str, Any]:
        chunks_without_vectors: list[dict[str, Any]] = []
        texts: list[str] = []

        for relative in sorted(file_state):
            source = self.repo_path / relative
            content = source.read_text(encoding="utf-8")
            for chunk in _chunk_markdown(relative, content):
                chunks_without_vectors.append(
                    {
                        "path": chunk.path,
                        "start_line": chunk.start_line,
                        "end_line": chunk.end_line,
                        "text": chunk.text,
                    }
                )
                texts.append(chunk.text)

        vectors: list[list[float]] = []
        for start in range(0, len(texts), 32):
            batch = texts[start : start + 32]
            vectors.extend(self.client.embed(batch))

        if len(vectors) != len(chunks_without_vectors):
            raise SemanticSearchError(
                "Embedding provider returned mismatched vector count while building semantic index."
            )

        chunks_with_vectors: list[dict[str, Any]] = []
        for chunk_item, vector in zip(chunks_without_vectors, vectors, strict=True):
            chunks_with_vectors.append({**chunk_item, "vector": vector})

        return {
            "version": self.INDEX_VERSION,
            "provider": self.config.provider,
            "model": self.config.model,
            "files": file_state,
            "chunks": chunks_with_vectors,
        }

    def _markdown_file_state(self) -> dict[str, str]:
        state: dict[str, str] = {}
        if not self.repo_path.exists():
            return state
        for path in self.repo_path.rglob("*.md"):
            if not path.is_file():
                continue
            relative = str(path.relative_to(self.repo_path))
            if relative.startswith(f"{self.INDEX_DIR}/"):
                continue
            content = path.read_text(encoding="utf-8")
            digest = hashlib.sha1(content.encode("utf-8")).hexdigest()
            state[relative] = digest
        return state

    def _is_index_fresh(self, payload: dict[str, Any], current_state: dict[str, str]) -> bool:
        if not payload:
            return False
        if payload.get("version") != self.INDEX_VERSION:
            return False
        if payload.get("provider") != self.config.provider:
            return False
        if payload.get("model") != self.config.model:
            return False
        indexed_files = payload.get("files")
        return isinstance(indexed_files, dict) and indexed_files == current_state

    def _parse_chunks(self, payload: dict[str, Any]) -> list[SemanticChunk]:
        raw_chunks = payload.get("chunks")
        if not isinstance(raw_chunks, list):
            return []

        parsed: list[SemanticChunk] = []
        for item in raw_chunks:
            if not isinstance(item, dict):
                continue
            path = item.get("path")
            start_line = item.get("start_line")
            end_line = item.get("end_line")
            text = item.get("text")
            vector = item.get("vector")
            if (
                isinstance(path, str)
                and isinstance(start_line, int)
                and isinstance(end_line, int)
                and isinstance(text, str)
                and isinstance(vector, list)
                and all(isinstance(v, (int, float)) for v in vector)
            ):
                parsed.append(
                    SemanticChunk(
                        path=path,
                        start_line=start_line,
                        end_line=end_line,
                        text=text,
                        vector=[float(v) for v in vector],
                    )
                )
        return parsed

    def _read_json(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}
        raw = path.read_text(encoding="utf-8")
        if not raw.strip():
            return {}
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        if isinstance(parsed, dict):
            return parsed
        return {}


class HTTPEmbeddingClient:
    def __init__(self, config: EmbeddingConfig) -> None:
        self.config = config

    def embed(self, texts: list[str]) -> list[list[float]]:
        if self.config.provider == "openrouter":
            return self._openrouter_embed(texts)
        if self.config.provider == "ollama":
            return self._ollama_embed(texts)
        raise SemanticSearchError(f"Unsupported embedding provider: {self.config.provider}")

    def _openrouter_embed(self, texts: list[str]) -> list[list[float]]:
        key = self.config.openrouter_api_key
        if not key:
            raise SemanticSearchError("Missing OpenRouter API key for semantic search.")
        payload = _http_json(
            method="POST",
            url="https://openrouter.ai/api/v1/embeddings",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://selfhub.local",
                "X-Title": "selfhub-cli",
            },
            body={"model": self.config.model, "input": texts},
        )
        raw_data = payload.get("data")
        if not isinstance(raw_data, list):
            raise SemanticSearchError("OpenRouter embeddings response missing data.")
        vectors: list[list[float]] = []
        for item in raw_data:
            if not isinstance(item, dict):
                continue
            embedding = item.get("embedding")
            if not isinstance(embedding, list) or not all(
                isinstance(v, (int, float)) for v in embedding
            ):
                continue
            vectors.append([float(v) for v in embedding])
        if len(vectors) != len(texts):
            raise SemanticSearchError("OpenRouter embeddings response has unexpected vector count.")
        return vectors

    def _ollama_embed(self, texts: list[str]) -> list[list[float]]:
        base_url = self.config.ollama_base_url
        if not base_url:
            raise SemanticSearchError("Missing Ollama base URL for semantic search.")

        response = _http_json(
            method="POST",
            url=f"{base_url.rstrip('/')}/api/embed",
            headers={"Content-Type": "application/json"},
            body={"model": self.config.model, "input": texts},
        )
        embeddings = response.get("embeddings")
        if isinstance(embeddings, list) and all(isinstance(item, list) for item in embeddings):
            vectors: list[list[float]] = []
            for item in embeddings:
                if not all(isinstance(v, (int, float)) for v in item):
                    continue
                vectors.append([float(v) for v in item])
            if len(vectors) == len(texts):
                return vectors

        vectors = []
        for text in texts:
            item = _http_json(
                method="POST",
                url=f"{base_url.rstrip('/')}/api/embeddings",
                headers={"Content-Type": "application/json"},
                body={"model": self.config.model, "prompt": text},
            )
            embedding = item.get("embedding")
            if not isinstance(embedding, list) or not all(
                isinstance(v, (int, float)) for v in embedding
            ):
                raise SemanticSearchError("Ollama embeddings response missing embedding vector.")
            vectors.append([float(v) for v in embedding])
        return vectors


def _http_json(
    method: str,
    url: str,
    headers: dict[str, str],
    body: dict[str, Any],
) -> dict[str, Any]:
    req = request.Request(
        url=url,
        data=json.dumps(body).encode("utf-8"),
        headers=headers,
        method=method,
    )
    try:
        with request.urlopen(req, timeout=60) as response:
            raw = response.read().decode("utf-8")
            parsed = json.loads(raw) if raw else {}
            if not isinstance(parsed, dict):
                raise SemanticSearchError("Embedding provider returned non-object JSON.")
            return parsed
    except error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="ignore")
        raise SemanticSearchError(f"Embedding provider HTTP {exc.code}: {body_text}") from exc
    except error.URLError as exc:
        raise SemanticSearchError(f"Embedding provider network error: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise SemanticSearchError("Embedding provider returned invalid JSON.") from exc


def _chunk_markdown(path: str, content: str, max_chars: int = 700) -> list[SemanticChunk]:
    lines = content.splitlines()
    chunks: list[SemanticChunk] = []
    start_line = 1
    buffer: list[str] = []

    def flush(end_line: int) -> None:
        nonlocal buffer, start_line
        text = "\n".join(part for part in buffer if part.strip()).strip()
        if text:
            chunks.append(
                SemanticChunk(
                    path=path,
                    start_line=start_line,
                    end_line=end_line,
                    text=text,
                    vector=[],
                )
            )
        buffer = []

    for line_number, line in enumerate(lines, start=1):
        if not buffer:
            start_line = line_number
        candidate = "\n".join([*buffer, line])
        if len(candidate) > max_chars and buffer:
            flush(line_number - 1)
            start_line = line_number
            buffer = [line]
            continue
        buffer.append(line)

    if buffer:
        flush(len(lines))
    return chunks


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    size = min(len(a), len(b))
    dot = sum(a[i] * b[i] for i in range(size))
    norm_a = math.sqrt(sum(a[i] * a[i] for i in range(size)))
    norm_b = math.sqrt(sum(b[i] * b[i] for i in range(size)))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _normalize_score(cosine: float) -> float:
    normalized = (cosine + 1.0) / 2.0
    return max(0.0, min(1.0, normalized))


def _truncate_excerpt(text: str, max_len: int = 280) -> str:
    collapsed = " ".join(text.split()).strip()
    if len(collapsed) <= max_len:
        return collapsed
    return f"{collapsed[: max_len - 3].rstrip()}..."


def _dedupe_results(results: list[SearchResult], limit: int) -> list[SearchResult]:
    deduped: list[SearchResult] = []
    seen: set[tuple[str, str]] = set()
    for item in results:
        key = (item.path, item.excerpt)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
        if len(deduped) >= limit:
            break
    return deduped
