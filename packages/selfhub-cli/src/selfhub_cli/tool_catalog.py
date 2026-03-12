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


@dataclass(frozen=True, slots=True)
class WorkflowSpec:
    name: str
    when: str
    steps: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "when": self.when,
            "steps": list(self.steps),
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
        name="recall",
        usage="selfhub recall \"<question>\" [--mode hybrid|semantic|exact] [--limit <n>]",
        purpose="Run multi-query memory recall tuned for broad human questions.",
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
    ToolSpec(
        name="agent-spec",
        usage="selfhub agent-spec [--json]",
        purpose="Output recommended grounding workflow and rules for agent integrations.",
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

GROUNDING_RULES: tuple[str, ...] = (
    "Always run `selfhub recall` before answering user-memory questions.",
    "Then run `selfhub read` on top file paths from recall for verification.",
    "Ground answers in retrieved evidence; avoid unsupported assumptions.",
    "If no relevant evidence is found, explicitly say memory is missing and ask user to save it.",
    "For new durable personal facts, call `selfhub save`.",
)

AGENT_WORKFLOWS: tuple[WorkflowSpec, ...] = (
    WorkflowSpec(
        name="memory_qa",
        when="User asks about profile, career, preferences, goals, or prior facts.",
        steps=(
            "Run: selfhub recall \"<user question>\" --json",
            "From top recall results, run: selfhub read <path> for 1-3 files",
            "Answer using only retrieved facts; mention uncertainty when evidence is weak",
        ),
    ),
    WorkflowSpec(
        name="memory_write",
        when="User states a new personal fact they want remembered.",
        steps=(
            "Run: selfhub save \"<fact>\" (or pass --file when explicit target is known)",
            "If save asks for resolution, follow suggested file or duplicate prompts",
            "Confirm saved file path and commit id back to the user",
        ),
    ),
)


def build_tools_payload() -> dict[str, object]:
    return {
        "success": True,
        "message": "SelfHub tool catalog.",
        "tools": [tool.to_dict() for tool in CLI_TOOLS],
        "slash_tools": [tool.to_dict() for tool in SLASH_TOOLS],
        "grounding_rules": list(GROUNDING_RULES),
        "workflows": [workflow.to_dict() for workflow in AGENT_WORKFLOWS],
    }


def build_agent_spec_payload() -> dict[str, object]:
    return {
        "success": True,
        "message": "SelfHub agent contract.",
        "grounding_rules": list(GROUNDING_RULES),
        "workflows": [workflow.to_dict() for workflow in AGENT_WORKFLOWS],
        "tools": [tool.to_dict() for tool in CLI_TOOLS],
        "slash_tools": [tool.to_dict() for tool in SLASH_TOOLS],
    }


def build_agent_system_prompt() -> str:
    lines = [
        "SelfHub Agent Contract",
        "",
        "Grounding Rules:",
    ]
    lines.extend(f"- {rule}" for rule in GROUNDING_RULES)
    lines.append("")
    lines.append("Required Workflows:")
    for workflow in AGENT_WORKFLOWS:
        lines.append(f"- {workflow.name}: {workflow.when}")
        lines.extend(f"  - {step}" for step in workflow.steps)
    return "\n".join(lines)
