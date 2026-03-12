from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ToolSpec:
    name: str
    usage: str
    purpose: str

    def to_dict(self) -> dict[str, str]:
        return {
            "name": self.name,
            "usage": self.usage,
            "purpose": self.purpose,
        }


CLI_TOOLS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="init",
        usage="selfhub init [--repo-path <path>] [--remote-url <url>]",
        purpose="Initialize local SelfHub repo and optional remote wiring.",
    ),
    ToolSpec(
        name="setup",
        usage="selfhub setup",
        purpose="Run guided onboarding wizard for repo and model configuration.",
    ),
    ToolSpec(
        name="save",
        usage="selfhub save \"<memory>\" [--file <path>]",
        purpose="Save memory entry, auto-commit, and auto-push when remote exists.",
    ),
    ToolSpec(
        name="delete",
        usage="selfhub delete --file <path> (--index <n> | --contains <text>) [--all]",
        purpose="Delete saved bullet entries from a memory file, with commit and push.",
    ),
    ToolSpec(
        name="read",
        usage="selfhub read [<target>]",
        purpose="Read a file/folder or list indexed markdown files.",
    ),
    ToolSpec(
        name="search",
        usage="selfhub search \"<query>\" [--mode hybrid|semantic|exact] [--limit <n>]",
        purpose="Find relevant memory snippets across your SelfHub repository.",
    ),
    ToolSpec(
        name="status",
        usage="selfhub status",
        purpose="Show git state for your SelfHub repo.",
    ),
    ToolSpec(
        name="sync",
        usage="selfhub sync",
        purpose="Pull/push and reconcile with remote repo.",
    ),
    ToolSpec(
        name="log",
        usage="selfhub log [--file <path>] [--limit <n>]",
        purpose="Inspect recent commit history.",
    ),
    ToolSpec(
        name="console",
        usage="selfhub console",
        purpose="Open interactive command/chat shell.",
    ),
    ToolSpec(
        name="tools",
        usage="selfhub tools [--json]",
        purpose="List SelfHub tool capabilities for users and agents.",
    ),
)


SLASH_TOOLS: tuple[ToolSpec, ...] = (
    ToolSpec(name="/chat", usage="/chat", purpose="Switch console to chat mode."),
    ToolSpec(name="/unchat", usage="/unchat", purpose="Return to command mode."),
    ToolSpec(
        name="/save",
        usage="/save [--file <path>] <content>",
        purpose="Save memory directly from chat.",
    ),
    ToolSpec(
        name="/tools",
        usage="/tools",
        purpose="Show available SelfHub commands and slash tools.",
    ),
    ToolSpec(name="/help", usage="/help", purpose="Show mode-specific help."),
    ToolSpec(name="/exit", usage="/exit", purpose="Exit console."),
)


def build_tools_payload() -> dict[str, object]:
    return {
        "success": True,
        "message": "SelfHub tool catalog.",
        "tools": [tool.to_dict() for tool in CLI_TOOLS],
        "slash_tools": [tool.to_dict() for tool in SLASH_TOOLS],
    }
