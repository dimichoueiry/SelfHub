from __future__ import annotations

import subprocess
from collections.abc import Sequence
from pathlib import Path

from selfhub_cli.service import SelfHubService
from selfhub_core.save_intelligence import (
    ClassificationDecision,
    DuplicateDecision,
    SaveIntelligence,
)


def _run_git(args: list[str], cwd: Path) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


class FakeSaveIntelligence(SaveIntelligence):
    def __init__(
        self,
        classification: ClassificationDecision,
        duplicate: DuplicateDecision | None = None,
    ) -> None:
        self._classification = classification
        self._duplicate = duplicate or DuplicateDecision(False, 0.0)
        self.last_allowed_files: list[str] = []

    def classify(self, content: str, allowed_files: Sequence[str]) -> ClassificationDecision:
        self.last_allowed_files = list(allowed_files)
        return self._classification

    def detect_duplicate(
        self,
        content: str,
        existing_entries: Sequence[str],
        target_file: str,
    ) -> DuplicateDecision:
        if self._duplicate.is_duplicate and existing_entries:
            return DuplicateDecision(
                is_duplicate=True,
                confidence=self._duplicate.confidence,
                existing_entry=existing_entries[0],
                reason=self._duplicate.reason,
            )
        return self._duplicate


def _bullet_entries(path: Path) -> list[str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return [line for line in lines if line.strip().startswith("- ")]


def test_save_explicit_file_creates_commit(tmp_path: Path) -> None:
    repo_path = tmp_path / "selfhub"
    service = SelfHubService(repo_path)
    service.init_repo()

    result = service.save(
        content="I prefer deep work after 10pm.",
        file_path="preferences/lifestyle.md",
        tool_name="CLI Test",
    )

    assert result.success is True
    assert result.file_path == "/preferences/lifestyle.md"
    assert result.commit_sha is not None

    file_content = (repo_path / "preferences/lifestyle.md").read_text(encoding="utf-8")
    assert "deep work after 10pm" in file_content
    assert "via CLI Test" in file_content


def test_save_low_confidence_requests_target_confirmation(tmp_path: Path) -> None:
    repo_path = tmp_path / "selfhub"
    fake = FakeSaveIntelligence(
        classification=ClassificationDecision(
            target_file="preferences/lifestyle.md",
            confidence=0.45,
            action="append",
            reason="Could fit preferences or experiences",
        )
    )
    service = SelfHubService(repo_path, save_intelligence=fake)
    service.init_repo()

    result = service.save(content="I hate open-plan offices.")

    assert result.success is False
    assert result.action_taken == "needs_target_confirmation"
    assert result.data is not None
    assert result.data["needs_target_confirmation"] is True


def test_save_duplicate_update_flow(tmp_path: Path) -> None:
    repo_path = tmp_path / "selfhub"
    fake = FakeSaveIntelligence(
        classification=ClassificationDecision(
            target_file="preferences/lifestyle.md",
            confidence=0.95,
            action="append",
            reason="Clear lifestyle preference",
        ),
        duplicate=DuplicateDecision(
            is_duplicate=True,
            confidence=0.9,
            reason="Same preference",
        ),
    )
    service = SelfHubService(repo_path, save_intelligence=fake)
    service.init_repo()

    first = service.save(
        content="I prefer working late nights.",
        file_path="preferences/lifestyle.md",
    )
    assert first.success is True

    pending = service.save(content="I prefer working late nights.")
    assert pending.success is False
    assert pending.action_taken == "needs_duplicate_resolution"

    resolved = service.save(
        content="I prefer working late nights after 10pm.",
        file_path="preferences/lifestyle.md",
        on_duplicate="update",
    )
    assert resolved.success is True
    assert resolved.action_taken == "update"

    entries = _bullet_entries(repo_path / "preferences/lifestyle.md")
    assert len(entries) == 1
    assert "after 10pm" in entries[0]


def test_save_classification_can_target_custom_file(tmp_path: Path) -> None:
    repo_path = tmp_path / "selfhub"
    fake = FakeSaveIntelligence(
        classification=ClassificationDecision(
            target_file="custom/ideas.md",
            confidence=0.96,
            action="append",
            reason="User-specific custom folder",
        )
    )
    service = SelfHubService(repo_path, save_intelligence=fake)
    service.init_repo()
    custom_path = repo_path / "custom/ideas.md"
    custom_path.parent.mkdir(parents=True, exist_ok=True)
    custom_path.write_text("# Ideas\n", encoding="utf-8")

    result = service.save(content="Build a personal brand narrative pipeline.")

    assert result.success is True
    assert result.file_path == "/custom/ideas.md"
    assert result.commit_sha is not None
    assert "custom/ideas.md" in fake.last_allowed_files
    assert "brand narrative" in custom_path.read_text(encoding="utf-8")


def test_save_custom_file_pushes_to_remote_when_configured(tmp_path: Path) -> None:
    remote_repo = tmp_path / "remote.git"
    local_repo = tmp_path / "selfhub"
    mirror_clone = tmp_path / "mirror"
    remote_repo.mkdir(parents=True, exist_ok=True)
    _run_git(["init", "--bare"], cwd=remote_repo)

    service = SelfHubService(local_repo)
    service.init_repo(remote_url=str(remote_repo))

    saved = service.save(
        content="My custom roadmap note.",
        file_path="custom/roadmap.md",
    )
    assert saved.success is True

    _run_git(["clone", str(remote_repo), str(mirror_clone)], cwd=tmp_path)
    remote_file = mirror_clone / "custom/roadmap.md"
    assert remote_file.exists()
    assert "My custom roadmap note." in remote_file.read_text(encoding="utf-8")
