from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

SERVICE_NAME = "selfhub"
SECRET_GITHUB_TOKEN = "github_token"
SECRET_OPENROUTER_API_KEY = "openrouter_api_key"


class SecretStoreError(RuntimeError):
    pass


class KeyringModule(Protocol):
    def get_password(self, service_name: str, username: str) -> str | None:
        ...

    def set_password(self, service_name: str, username: str, password: str) -> None:
        ...


@dataclass(slots=True)
class KeyringSecretStore:
    service_name: str = SERVICE_NAME

    def get_secret(self, name: str) -> str | None:
        keyring = _import_keyring()
        try:
            value = keyring.get_password(self.service_name, name)
        except Exception as exc:  # pragma: no cover - backend-specific failures
            raise SecretStoreError(f"Failed to read secret '{name}': {exc}") from exc
        if not value:
            return None
        return value

    def set_secret(self, name: str, value: str) -> None:
        keyring = _import_keyring()
        try:
            keyring.set_password(self.service_name, name, value)
        except Exception as exc:  # pragma: no cover - backend-specific failures
            raise SecretStoreError(f"Failed to store secret '{name}': {exc}") from exc


def _import_keyring() -> KeyringModule:
    try:
        import keyring
    except ImportError as exc:  # pragma: no cover - dependency installation issue
        raise SecretStoreError(
            "keyring is not installed. Install dependencies with "
            "`uv sync --all-packages --group dev`."
        ) from exc
    return keyring
