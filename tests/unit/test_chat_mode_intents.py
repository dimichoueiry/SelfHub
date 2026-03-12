from __future__ import annotations

from selfhub_cli.chat_mode import (
    _extract_explicit_save_payload,
    _extract_implicit_memory_candidate,
    _extract_slash_save_payload,
    _extract_slash_save_request,
    _is_dismiss_save,
    _is_save_choice_one,
    _is_save_choice_two,
)


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


def test_extract_slash_save_payload() -> None:
    payload = _extract_slash_save_payload("/save I had surgery yesterday")
    assert payload == "I had surgery yesterday"


def test_extract_slash_save_payload_without_content() -> None:
    payload = _extract_slash_save_payload("/save")
    assert payload is None


def test_extract_slash_save_request_with_file() -> None:
    request = _extract_slash_save_request("/save --file experiences/life-events.md I had surgery")
    assert request is not None
    assert request.file_path == "experiences/life-events.md"
    assert request.content == "I had surgery"


def test_save_choice_shortcuts() -> None:
    assert _is_save_choice_one("1")
    assert _is_save_choice_two("2")
    assert _is_dismiss_save("3")
