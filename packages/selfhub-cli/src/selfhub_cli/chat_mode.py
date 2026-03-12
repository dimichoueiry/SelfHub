from __future__ import annotations

import shlex
from collections.abc import Callable
from dataclasses import dataclass

from rich.console import Console
from rich.panel import Panel

from selfhub_cli.chat_models import ChatClient, ChatMessage, ChatModelError
from selfhub_cli.service import SelfHubService

console = Console()


@dataclass(slots=True)
class PendingSave:
    content: str


@dataclass(slots=True)
class SlashSaveRequest:
    content: str
    file_path: str | None = None


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
            if lower.startswith("/save"):
                print("Use /chat first, then /save in chat mode.")
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
        if lower.startswith("/save"):
            request = _extract_slash_save_request(text)
            if request is None:
                if pending is not None:
                    _save_with_resolution(service, pending.content)
                    pending = None
                    continue
                print("Usage: /save [--file <path>] <content>")
                continue
            _save_with_resolution(
                service,
                request.content,
                file_path=request.file_path,
            )
            continue

        if pending is not None:
            if _is_save_choice_one(lower):
                _save_with_resolution(service, pending.content)
                pending = None
                continue
            if _is_save_choice_two(lower):
                edited = input("Edit memory before save: ").strip()
                if edited:
                    _save_with_resolution(service, edited)
                else:
                    print("Edit canceled; nothing saved.")
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
            _print_notice(
                "No chat model configured. Run `selfhub setup` and configure a chat model, "
                "or switch to command mode with /unchat.",
            )
            continue

        _print_chat_turn("You", text, border_style="cyan")
        turn_messages = list(history)
        memory_context = _build_memory_context(service, text)
        if memory_context is not None:
            turn_messages.append(ChatMessage(role="system", content=memory_context))
        turn_messages.append(ChatMessage(role="user", content=text))
        try:
            response = chat_client.reply(turn_messages)
        except ChatModelError as exc:
            print(f"Chat model error: {exc}")
            continue

        history.append(ChatMessage(role="user", content=text))
        _print_chat_turn("SelfHub", response, border_style="green")
        history.append(ChatMessage(role="assistant", content=response))

        candidate = _extract_implicit_memory_candidate(text)
        if candidate is not None:
            pending = PendingSave(content=candidate)
            _print_save_suggestion_card(candidate)


def _save_with_resolution(
    service: SelfHubService,
    content: str,
    file_path: str | None = None,
) -> None:
    result = service.save(content=content, file_path=file_path)

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

    # Parse from trigger onward so punctuation earlier in the sentence does not
    # accidentally change what gets saved.
    for trigger in triggers:
        index = lowered.find(trigger)
        if index != -1:
            remainder = text[index + len(trigger) :].strip()
            if remainder.startswith((": ", "-", "—")):
                remainder = remainder[1:].strip()
            remainder = remainder.strip()
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


def _extract_slash_save_payload(text: str) -> str | None:
    request = _extract_slash_save_request(text)
    return request.content if request is not None else None


def _build_memory_context(service: SelfHubService, user_text: str) -> str | None:
    query = user_text.strip()
    if len(query) < 3:
        return None
    results = service.search(query=query, mode="hybrid", limit=4)
    if not results:
        return None

    lines = [
        "Relevant SelfHub memory snippets for this user request:",
        "Use these facts when helpful. If uncertain, say you are unsure.",
    ]
    for index, result in enumerate(results, start=1):
        lines.append(f"{index}. {result.path}: {result.excerpt}")
    return "\n".join(lines)


def _extract_slash_save_request(text: str) -> SlashSaveRequest | None:
    stripped = text.strip()
    if not stripped.lower().startswith("/save"):
        return None

    try:
        parts = shlex.split(stripped)
    except ValueError:
        return None
    if not parts:
        return None

    file_path: str | None = None
    index = 1
    if index < len(parts) and parts[index] == "--file":
        index += 1
        if index >= len(parts):
            return None
        file_path = parts[index]
        index += 1

    if index >= len(parts):
        return None
    content = " ".join(parts[index:]).strip()
    if not content:
        return None

    return SlashSaveRequest(content=content, file_path=file_path)


def _is_save_choice_one(lowered: str) -> bool:
    return lowered in {
        "1",
        "yes",
        "yes save",
        "yes save that",
        "save",
        "save that",
        "please save that",
    }


def _is_save_choice_two(lowered: str) -> bool:
    return lowered in {"2", "edit", "edit then save"}


def _is_dismiss_save(lowered: str) -> bool:
    return lowered in {"3", "dismiss", "no", "no thanks", "skip"}


def _print_console_intro() -> None:
    print("SelfHub console")
    print("- Command mode: type CLI commands directly (example: read meta/profile.md)")
    print("- Type /chat to switch into agent chat mode")
    print("- Type /exit to quit")


def _print_chat_mode_intro(chat_ready: bool) -> None:
    print("Switched to chat mode.")
    print("- /unchat to return to command mode")
    print("- /exit to quit")
    print("- /save <content> to save immediately")
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
    print("- Use /save <content> for direct save from chat mode")
    print("- For save suggestions: 1=save, 2=edit then save, 3=dismiss")
    print("- /unchat to return to command mode")
    print("- /exit to quit")


def _print_save_suggestion_card(content: str) -> None:
    text = "\n".join(
        [
            f"\"{content}\"",
            "",
            "[1] Save",
            "[2] Edit then save",
            "[3] Dismiss",
        ]
    )
    console.print(
        Panel(
            text,
            title="Save suggestion",
            border_style="yellow",
            padding=(0, 1),
        )
    )


def _print_chat_turn(label: str, content: str, border_style: str) -> None:
    console.print(
        Panel(
            content.strip(),
            title=label,
            border_style=border_style,
            padding=(0, 1),
        )
    )


def _print_notice(message: str) -> None:
    console.print(
        Panel(
            message,
            title="Notice",
            border_style="magenta",
            padding=(0, 1),
        )
    )
