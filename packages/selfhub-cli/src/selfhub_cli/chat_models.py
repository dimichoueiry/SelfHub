from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib import error, request


class ChatModelError(RuntimeError):
    pass


@dataclass(slots=True, frozen=True)
class ChatMessage:
    role: str
    content: str


@dataclass(slots=True, frozen=True)
class ChatModelConfig:
    provider: str
    model: str
    openrouter_api_key: str | None
    ollama_base_url: str | None


class ChatClient:
    def __init__(self, config: ChatModelConfig) -> None:
        self.config = config

    def reply(self, messages: list[ChatMessage]) -> str:
        if self.config.provider == "openrouter":
            return self._openrouter_reply(messages)
        if self.config.provider == "ollama":
            return self._ollama_reply(messages)
        raise ChatModelError(f"Unsupported chat provider: {self.config.provider}")

    def _openrouter_reply(self, messages: list[ChatMessage]) -> str:
        api_key = self.config.openrouter_api_key
        if not api_key:
            raise ChatModelError("Missing OpenRouter API key")

        payload = {
            "model": self.config.model,
            "temperature": 0.4,
            "messages": [{"role": item.role, "content": item.content} for item in messages],
        }
        response = _http_json(
            method="POST",
            url="https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://selfhub.local",
                "X-Title": "selfhub-cli",
            },
            payload=payload,
        )
        choices = response.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ChatModelError("OpenRouter response missing choices")

        first = choices[0]
        if not isinstance(first, dict):
            raise ChatModelError("OpenRouter response format invalid")
        message = first.get("message")
        if not isinstance(message, dict):
            raise ChatModelError("OpenRouter response missing message")
        content = message.get("content")
        if not isinstance(content, str):
            raise ChatModelError("OpenRouter response missing content")
        return content

    def _ollama_reply(self, messages: list[ChatMessage]) -> str:
        base_url = self.config.ollama_base_url
        if not base_url:
            raise ChatModelError("Missing Ollama base URL")

        payload = {
            "model": self.config.model,
            "stream": False,
            "messages": [{"role": item.role, "content": item.content} for item in messages],
        }
        response = _http_json(
            method="POST",
            url=f"{base_url}/api/chat",
            headers={"Content-Type": "application/json"},
            payload=payload,
        )
        message = response.get("message")
        if not isinstance(message, dict):
            raise ChatModelError("Ollama response missing message")
        content = message.get("content")
        if not isinstance(content, str):
            raise ChatModelError("Ollama response missing content")
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
        with request.urlopen(req, timeout=60) as response:
            raw = response.read().decode("utf-8")
            if not raw:
                return {}
            parsed = json.loads(raw)
            if not isinstance(parsed, dict):
                raise ChatModelError("Model provider returned non-object JSON")
            return parsed
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise ChatModelError(f"HTTP {exc.code} from model provider: {body}") from exc
    except error.URLError as exc:
        raise ChatModelError(f"Model provider network error: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise ChatModelError("Model provider returned invalid JSON") from exc
