from __future__ import annotations

from pathlib import Path

REPO_NAME = "selfhub"

DEFAULT_MARKDOWN_FILES: dict[str, str] = {
    "preferences/food.md": "# Food Preferences\n",
    "preferences/hobbies.md": "# Hobbies\n",
    "preferences/lifestyle.md": "# Lifestyle\n",
    "voice/writing-style.md": "# Writing Style\n",
    "experiences/career.md": "# Career\n",
    "experiences/education.md": "# Education\n",
    "experiences/life-events.md": "# Life Events\n",
    "relationships/people.md": "# People\n",
    "goals/short-term.md": "# Short-Term Goals\n",
    "goals/long-term.md": "# Long-Term Goals\n",
    "meta/profile.md": "# Profile\n",
    "meta/README.md": "# SelfHub Index\n",
}

DEFAULT_DIRECTORIES: tuple[str, ...] = (
    "preferences",
    "voice",
    "voice/samples",
    "experiences",
    "relationships",
    "goals",
    "meta",
)


def all_standard_paths() -> tuple[str, ...]:
    return tuple(DEFAULT_MARKDOWN_FILES.keys())


def resolve_default_repo_path(base_dir: Path) -> Path:
    return base_dir / REPO_NAME
