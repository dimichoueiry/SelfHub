from __future__ import annotations

from selfhub_cli.chat_mode import _extract_explicit_save_payload, _extract_implicit_memory_candidate


def test_extract_explicit_save_payload_with_separator() -> None:
    text = "Save this about me: I had surgery yesterday."
    payload = _extract_explicit_save_payload(text)
    assert payload == "I had surgery yesterday."


def test_extract_explicit_save_payload_without_separator() -> None:
    text = "please save that I prefer quiet offices"
    payload = _extract_explicit_save_payload(text)
    assert payload == "I prefer quiet offices"


def test_extract_implicit_memory_candidate_detects_event() -> None:
    text = "I had surgery yesterday and now I need to rest."
    candidate = _extract_implicit_memory_candidate(text)
    assert candidate == text


def test_extract_implicit_memory_candidate_ignores_transient() -> None:
    text = "I am tired today"
    candidate = _extract_implicit_memory_candidate(text)
    assert candidate is None
