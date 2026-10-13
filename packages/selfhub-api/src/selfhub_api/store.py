"""What the dashboard remembers that git does not: space descriptions, the GitHub repo a
space maps to, when it last synced, and non-file events (syncs, access changes, new
spaces) for the activity feed. Lives at `<config dir>/dashboard.json`.

Files, history and rules are never stored here; they stay in the spaces' git repos.
"""

from __future__ import annotations

import json
import secrets
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

STORE_FILENAME = "dashboard.json"
MAX_EVENTS = 500


def now_iso() -> str:
    return datetime.now(tz=UTC).replace(microsecond=0).isoformat()


class Store:
    def __init__(self, config_dir: Path) -> None:
        self.path = config_dir / STORE_FILENAME
        self._lock = threading.Lock()
        self.data: dict[str, Any] = {"personal": {}, "spaces": {}, "events": []}
        if self.path.exists():
            loaded = json.loads(self.path.read_text(encoding="utf-8") or "{}")
            if isinstance(loaded, dict):
                self.data.update(loaded)

    def personal(self) -> dict[str, Any]:
        value: dict[str, Any] = self.data.setdefault("personal", {})
        return value

    def space(self, space_id: str) -> dict[str, Any]:
        value: dict[str, Any] = self.data.setdefault("spaces", {}).get(space_id, {})
        return value

    def update_space(self, space_id: str, **values: Any) -> None:
        with self._lock:
            entry = self.data.setdefault("spaces", {}).setdefault(space_id, {})
            entry.update({k: v for k, v in values.items() if v is not None})
            self._save()

    def forget_space(self, space_id: str) -> None:
        with self._lock:
            self.data.setdefault("spaces", {}).pop(space_id, None)
            self._save()

    def events(self) -> list[dict[str, Any]]:
        value: list[dict[str, Any]] = self.data.setdefault("events", [])
        return list(value)

    def add_event(
        self,
        type_: str,
        actor: str,
        space_id: str | None,
        summary: str,
        path: str | None = None,
        date: str | None = None,
    ) -> dict[str, Any]:
        event = {
            "id": f"evt_{secrets.token_hex(4)}",
            "type": type_,
            "actor": actor,
            "spaceId": space_id,
            "summary": summary,
            "date": date or now_iso(),
        }
        if path:
            event["path"] = path
        with self._lock:
            events = self.data.setdefault("events", [])
            events.append(event)
            del events[:-MAX_EVENTS]
            self._save()
        return event

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=2) + "\n", encoding="utf-8")
        tmp.replace(self.path)
