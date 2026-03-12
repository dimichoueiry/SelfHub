from __future__ import annotations

from selfhub_cli.main import _normalize_argv


def test_normalize_option_style_read() -> None:
    args, hint = _normalize_argv(["--read", "meta/profile.md"])
    assert args == ["read", "meta/profile.md"]
    assert hint is not None


def test_normalize_trailing_read_alias() -> None:
    args, hint = _normalize_argv(["meta/profile.md", "--read"])
    assert args == ["read", "meta/profile.md"]
    assert hint is not None


def test_normalize_passthrough_for_valid_command() -> None:
    args, hint = _normalize_argv(["read", "meta/profile.md"])
    assert args == ["read", "meta/profile.md"]
    assert hint is None


def test_normalize_option_style_tools() -> None:
    args, hint = _normalize_argv(["--tools"])
    assert args == ["tools"]
    assert hint is not None


def test_normalize_option_style_recall() -> None:
    args, hint = _normalize_argv(["--recall", "what do you know about me"])
    assert args == ["recall", "what do you know about me"]
    assert hint is not None
