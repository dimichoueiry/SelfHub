from __future__ import annotations

import shlex
from collections.abc import Callable
from dataclasses import dataclass

from selfhub_cli.chat_models import ChatClient, ChatMessage, ChatModelError
from selfhub_cli.service import SelfHubService


@dataclass(slots=True)
class PendingSave:
    content: str


def run_console(
    service: SelfHubService,
    execute_command: Callable[[list[str]], int],
    chat_client: ChatClient | None,
) -> int:
    mode = "command"
    pending: PendingSave | None = None
    history: list[ChatMessage] = [
        ChatMessage(
            role="system",
            content=(
                "You are SelfHub assistant. Be concise and practical. "
                "Help the user manage identity files and workflows."
            ),
        )
    ]

    _print_console_intro()

    while True:
        prompt = "chat> " if mode == "chat" else "selfhub> "
        try:
            raw = input(prompt)
        except EOFError:
            print("\nExiting console.")
            return 0

        text = raw.strip()
        if not text:
            continue

        lower = text.lower()
        if lower in {"/exit", "exit", "quit"}:
            print("Exiting console.")
            return 0

        if mode == "command":
            if lower == "/chat":
                mode = "chat"
                _print_chat_mode_intro(chat_client is not None)
                continue
            if lower == "/help":
                _print_console_help(mode)
                continue

            try:
                args = shlex.split(text)
            except ValueError as exc:
                print(f"Parse error: {exc}")
                continue
            if args and args[0] == "console":
                print("Already in console mode. Use /chat, /unchat, or /help.")
                continue
            execute_command(args)
            continue

        # Chat mode
        if lower == "/unchat":
            mode = "command"
            print("Switched to command mode.")
            continue
        if lower == "/help":
            _print_console_help(mode)
            continue
        if lower == "/chat":
            print("Already in chat mode.")
            continue

        if pending is not None:
            if _is_affirmative_save(lower):
                _save_with_resolution(service, pending.content)
                pending = None
                continue
            if _is_dismiss_save(lower):
                print("Save suggestion dismissed.")
                pending = None
                continue

        explicit_payload = _extract_explicit_save_payload(text)
        if explicit_payload is not None:
            _save_with_resolution(service, explicit_payload)
            continue

        if chat_client is None:
            print(
                "No chat model configured. Run `selfhub setup` and configure a chat model, "
                "or switch to command mode with /unchat."
            )
            continue

        history.append(ChatMessage(role="user", content=text))
        try:
            response = chat_client.reply(history)
        except ChatModelError as exc:
            print(f"Chat model error: {exc}")
            continue

        print(response)
        history.append(ChatMessage(role="assistant", content=response))

        candidate = _extract_implicit_memory_candidate(text)
        if candidate is not None:
            pending = PendingSave(content=candidate)
            print(
                "\nMemory candidate detected. "
                "Type `yes save that` to save, `dismiss` to skip, or continue chatting."
            )


def _save_with_resolution(service: SelfHubService, content: str) -> None:
    result = service.save(content=content)

    while True:
        if result.success:
            file_path = result.file_path or "(unknown file)"
            commit = result.commit_sha or "(no commit)"
            print(f"Saved to {file_path}. commit={commit}")
            return

        data = result.data or {}
        if data.get("needs_target_confirmation") is True:
            suggested = data.get("suggested_file")
            suggested_path = str(suggested) if isinstance(suggested, str) else "meta/profile.md"
            choice = input(f"Save target [{suggested_path}]: ").strip() or suggested_path
            result = service.save(content=content, file_path=choice)
            continue

        if data.get("needs_duplicate_resolution") is True:
            choice = input("Duplicate found. Choose add/update [update]: ").strip().lower()
            if not choice:
                choice = "update"
            if choice not in {"add", "update"}:
                print("Invalid choice. Please type add or update.")
                continue
            target = data.get("target_file")
            target_file = str(target) if isinstance(target, str) else None
            result = service.save(content=content, file_path=target_file, on_duplicate=choice)
            continue

        message = result.message or "Save failed."
        print(f"Save failed: {message}")
        return


def _extract_explicit_save_payload(text: str) -> str | None:
    lowered = text.lower()
    triggers = (
        "save this about me",
        "save this",
        "remember this",
        "add this to selfhub",
        "please save that",
        "save that",
    )

    if not any(trigger in lowered for trigger in triggers):
        return None

    separators = [":", "-", "—"]
    for separator in separators:
        if separator in text:
            right = text.split(separator, maxsplit=1)[1].strip()
            if right:
                return right

    # If no separator, use the original text minus leading trigger phrase.
    for trigger in triggers:
        index = lowered.find(trigger)
        if index != -1:
            remainder = text[index + len(trigger) :].strip(" .")
            if remainder:
                return remainder

    return text.strip()


def _extract_implicit_memory_candidate(text: str) -> str | None:
    lowered = text.lower()
    transient_markers = {"today i feel", "i am tired", "i'm tired", "i feel tired"}
    if any(marker in lowered for marker in transient_markers):
        return None

    signals = (
        "i had",
        "i have",
        "i prefer",
        "i like",
        "i dislike",
        "yesterday",
        "last week",
        "my surgery",
        "broke",
        "promoted",
    )
    if any(signal in lowered for signal in signals):
        return text.strip()
    return None


def _is_affirmative_save(lowered: str) -> bool:
    return lowered in {
        "yes",
        "yes save",
        "yes save that",
        "save",
        "save that",
        "please save that",
    }


def _is_dismiss_save(lowered: str) -> bool:
    return lowered in {"dismiss", "no", "no thanks", "skip"}


def _print_console_intro() -> None:
    print("SelfHub console")
    print("- Command mode: type CLI commands directly (example: read meta/profile.md)")
    print("- Type /chat to switch into agent chat mode")
    print("- Type /exit to quit")


def _print_chat_mode_intro(chat_ready: bool) -> None:
    print("Switched to chat mode.")
    print("- /unchat to return to command mode")
    print("- /exit to quit")
    if not chat_ready:
        print("- No chat model configured yet. You can still use save-detection commands.")


def _print_console_help(mode: str) -> None:
    if mode == "command":
        print("Command mode help:")
        print("- Run normal commands: read, save, status, sync, log, search")
        print("- /chat to enter chat mode")
        print("- /exit to quit")
        return

    print("Chat mode help:")
    print("- Talk naturally with your configured chat model")
    print("- Say things like 'save this: ...' for explicit saves")
    print("- Use 'yes save that' when a memory candidate appears")
    print("- /unchat to return to command mode")
    print("- /exit to quit")
