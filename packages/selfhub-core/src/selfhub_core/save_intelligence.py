from __future__ import annotations

import json
import os
import re
from collections.abc import Sequence
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any, Protocol
from urllib import error, request


class SaveIntelligenceError(RuntimeError):
    pass


@dataclass(slots=True)
class ClassificationDecision:
    target_file: str
    confidence: float
    action: str
    reason: str | None = None


@dataclass(slots=True)
class DuplicateDecision:
    is_duplicate: bool
    confidence: float
    existing_entry: str | None = None
    reason: str | None = None


class SaveIntelligence(Protocol):
    def classify(self, content: str, allowed_files: Sequence[str]) -> ClassificationDecision:
        ...

    def detect_duplicate(
        self,
        content: str,
        existing_entries: Sequence[str],
        target_file: str,
    ) -> DuplicateDecision:
        ...


@dataclass(slots=True)
class LLMConfig:
    provider: str
    model: str
    openrouter_api_key: str | None
    ollama_base_url: str | None


def load_llm_config_from_env() -> LLMConfig | None:
    provider = os.getenv("SELFHUB_LLM_PROVIDER", "").strip().lower()
    if not provider:
        return None

    model = os.getenv("SELFHUB_LLM_MODEL", "").strip()
    if provider == "openrouter":
        api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        if not api_key:
            raise SaveIntelligenceError("OPENROUTER_API_KEY is required for openrouter provider")
        return LLMConfig(
            provider="openrouter",
            model=model or "anthropic/claude-3.5-haiku",
            openrouter_api_key=api_key,
            ollama_base_url=None,
        )

    if provider == "ollama":
        base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").strip().rstrip("/")
        return LLMConfig(
            provider="ollama",
            model=model or "llama3.1:8b",
            openrouter_api_key=None,
            ollama_base_url=base_url,
        )

    raise SaveIntelligenceError(
        "Unsupported SELFHUB_LLM_PROVIDER. Use 'openrouter' or 'ollama'."
    )


def build_default_save_intelligence() -> SaveIntelligence | None:
    config = load_llm_config_from_env()
    if config is None:
        return None
    return LLMSaveIntelligence(config)


class LLMSaveIntelligence:
    def __init__(self, config: LLMConfig) -> None:
        self.config = config

    def classify(self, content: str, allowed_files: Sequence[str]) -> ClassificationDecision:
        files = "\n".join(f"- {path}" for path in allowed_files)
        system_prompt = (
            "You route personal identity notes into the right markdown file. "
            "Return strict JSON only."
        )
        user_prompt = (
            "Classify this content into exactly one file from the allowed list.\n"
            "Allowed files:\n"
            f"{files}\n\n"
            "Return JSON with keys: target_file, confidence, action, reason.\n"
            "confidence must be between 0 and 1. action must be append or update.\n"
            "Content:\n"
            f"{content}"
        )
        response = self._chat_json(system_prompt=system_prompt, user_prompt=user_prompt)

        target = str(response.get("target_file", "")).strip().lstrip("/")
        if target not in allowed_files:
            target = "meta/profile.md"

        confidence = _coerce_float(response.get("confidence"), default=0.5)
        confidence = min(max(confidence, 0.0), 1.0)

        action = str(response.get("action", "append")).strip().lower()
        if action not in {"append", "update"}:
            action = "append"

        reason = response.get("reason")
        reason_text = str(reason).strip() if isinstance(reason, str) else None

        return ClassificationDecision(
            target_file=target,
            confidence=confidence,
            action=action,
            reason=reason_text,
        )

    def detect_duplicate(
        self,
        content: str,
        existing_entries: Sequence[str],
        target_file: str,
    ) -> DuplicateDecision:
        if not existing_entries:
            return DuplicateDecision(is_duplicate=False, confidence=0.0)

        candidate = self._select_candidate(content, existing_entries)
        if candidate is None:
            return DuplicateDecision(is_duplicate=False, confidence=0.0)

        system_prompt = (
            "You detect whether two personal notes are semantic duplicates. "
            "Return JSON only."
        )
        user_prompt = (
            f"Target file: {target_file}\n"
            "Determine if these two entries mean the same thing.\n"
            "Return JSON with keys: is_duplicate, confidence, reason.\n\n"
            "New entry:\n"
            f"{content}\n\n"
            "Existing entry:\n"
            f"{candidate}"
        )
        response = self._chat_json(system_prompt=system_prompt, user_prompt=user_prompt)

        is_duplicate = _coerce_bool(response.get("is_duplicate"), default=False)
        confidence = _coerce_float(response.get("confidence"), default=0.0)
        confidence = min(max(confidence, 0.0), 1.0)
        reason = response.get("reason")
        reason_text = str(reason).strip() if isinstance(reason, str) else None

        return DuplicateDecision(
            is_duplicate=is_duplicate,
            confidence=confidence,
            existing_entry=candidate if is_duplicate else None,
            reason=reason_text,
        )

    def _select_candidate(self, content: str, existing_entries: Sequence[str]) -> str | None:
        normalized_new = _normalize_text(content)
        best_score = 0.0
        best_entry: str | None = None

        for entry in existing_entries[-100:]:
            normalized_entry = _normalize_text(entry)
            if not normalized_entry:
                continue

            seq_score = SequenceMatcher(None, normalized_new, normalized_entry).ratio()
            overlap_score = _token_overlap(normalized_new, normalized_entry)
            score = max(seq_score, overlap_score)
            if score > best_score:
                best_score = score
                best_entry = entry

        if best_score < 0.35:
            return None
        return best_entry

    def _chat_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        raw = self._chat(system_prompt=system_prompt, user_prompt=user_prompt)
        parsed = _extract_json_object(raw)
        if not isinstance(parsed, dict):
            raise SaveIntelligenceError("LLM response was not a JSON object")
        return parsed

    def _chat(self, system_prompt: str, user_prompt: str) -> str:
        if self.config.provider == "openrouter":
            return self._chat_openrouter(system_prompt=system_prompt, user_prompt=user_prompt)
        if self.config.provider == "ollama":
            return self._chat_ollama(system_prompt=system_prompt, user_prompt=user_prompt)
        raise SaveIntelligenceError("Unsupported LLM provider")

    def _chat_openrouter(self, system_prompt: str, user_prompt: str) -> str:
        if self.config.openrouter_api_key is None:
            raise SaveIntelligenceError("OPENROUTER_API_KEY is missing")

        payload = {
            "model": self.config.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        response = _http_json(
            method="POST",
            url="https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {self.config.openrouter_api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://selfhub.local",
                "X-Title": "selfhub-cli",
            },
            payload=payload,
        )
        choices = response.get("choices")
        if not isinstance(choices, list) or not choices:
            raise SaveIntelligenceError("OpenRouter response missing choices")

        first = choices[0]
        if not isinstance(first, dict):
            raise SaveIntelligenceError("OpenRouter response format invalid")
        message = first.get("message")
        if not isinstance(message, dict):
            raise SaveIntelligenceError("OpenRouter response missing message")
        content = message.get("content")
        if not isinstance(content, str):
            raise SaveIntelligenceError("OpenRouter message content missing")
        return content

    def _chat_ollama(self, system_prompt: str, user_prompt: str) -> str:
        if self.config.ollama_base_url is None:
            raise SaveIntelligenceError("OLLAMA_BASE_URL is missing")

        payload = {
            "model": self.config.model,
            "stream": False,
            "format": "json",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        response = _http_json(
            method="POST",
            url=f"{self.config.ollama_base_url}/api/chat",
            headers={"Content-Type": "application/json"},
            payload=payload,
        )
        message = response.get("message")
        if not isinstance(message, dict):
            raise SaveIntelligenceError("Ollama response missing message")
        content = message.get("content")
        if not isinstance(content, str):
            raise SaveIntelligenceError("Ollama message content missing")
        return content


def _http_json(
    method: str,
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
) -> dict[str, Any]:
    req = request.Request(
        url=url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method=method,
    )
    try:
        with request.urlopen(req, timeout=30) as response:
            raw = response.read().decode("utf-8")
            if not raw:
                return {}
            parsed = json.loads(raw)
            if not isinstance(parsed, dict):
                raise SaveIntelligenceError("Non-object JSON response")
            return parsed
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise SaveIntelligenceError(f"HTTP {exc.code} from model provider: {body}") from exc
    except error.URLError as exc:
        raise SaveIntelligenceError(f"Model provider network error: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise SaveIntelligenceError("Model provider returned invalid JSON") from exc


def _extract_json_object(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        parsed = json.loads(stripped)
        if isinstance(parsed, dict):
            return parsed

    match = re.search(r"\{.*\}", stripped, flags=re.DOTALL)
    if not match:
        raise SaveIntelligenceError("No JSON object found in model response")

    parsed = json.loads(match.group(0))
    if not isinstance(parsed, dict):
        raise SaveIntelligenceError("Model response JSON was not an object")
    return parsed


def _coerce_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _coerce_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "yes", "1"}:
            return True
        if lowered in {"false", "no", "0"}:
            return False
    return default


def _normalize_text(value: str) -> str:
    return " ".join(value.lower().strip().split())


def _token_overlap(left: str, right: str) -> float:
    left_tokens = set(left.split())
    right_tokens = set(right.split())
    if not left_tokens or not right_tokens:
        return 0.0
    intersection = len(left_tokens & right_tokens)
    union = len(left_tokens | right_tokens)
    return intersection / union
