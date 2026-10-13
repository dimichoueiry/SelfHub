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
        purpose=(
            "Save memory entry, auto-create custom --file paths, "
            "auto-commit, and auto-push when remote exists."
        ),
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
        name="context",
        usage="selfhub context \"<task>\" [--client <name>] [--json]",
        purpose=(
            "Everything an agent needs for one task across connected spaces: locked rules, "
            "precedence, the named client only, learned rules, policies and sources."
        ),
    ),
    ToolSpec(
        name="learn",
        usage=(
            "selfhub learn \"<rule>\" --space <name> [--why <feedback>] [--source <path>]"
        ),
        purpose="Turn feedback into a rule. It waits for human approval unless policy says not.",
    ),
    ToolSpec(
        name="rules",
        usage="selfhub rules list|approve|reject [<id>] [--space <name>] [--pending]",
        purpose="List learned rules; humans approve or reject proposed ones.",
    ),
    ToolSpec(
        name="space",
        usage="selfhub space create|add|list|remove|sync",
        purpose="Connect org, team and client SelfHub repos next to your personal one.",
    ),
    ToolSpec(
        name="policy",
        usage="selfhub policy list|enable|disable [<name>]",
        purpose="Choose the policies your agents follow; org-enforced ones stay on.",
    ),
    ToolSpec(
        name="skills",
        usage=(
            "selfhub skills install [--space <folder>] [--all] [--global] [--dry-run] | "
            "skills show [--space <folder>] [--codex]"
        ),
        purpose="Install the agent skill pack (Claude Code skill and AGENTS.md section).",
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
    "Before doing work for someone (an ad, a doc, a plan), run `selfhub context \"<task>\"` "
    "and follow it: locked rules win, then the user, then client, team, org, personal.",
    "Never use one client's memory on another client's work. Only clients in the context "
    "bundle may be used.",
    "Never write to locked paths and never run `selfhub rules approve`: approval is human.",
    "Pass --space <name> to save/read/search/recall in a shared space.",
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
            (
                "Run: selfhub save \"<fact>\" "
                "(or pass --file when explicit target is known; missing paths are created)"
            ),
            "If save asks for resolution, follow suggested file or duplicate prompts",
            "Confirm saved file path and commit id back to the user",
        ),
    ),
    WorkflowSpec(
        name="work_task",
        when="User asks for work that follows company SOPs, e.g. 'make an ad for client A'.",
        steps=(
            "Run: selfhub context \"<the task, naming the client>\" --json",
            "Read in full any listed file you rely on: selfhub read <path> --space <space>",
            "Do the work. Obey locked rules and policies; follow precedence on conflicts",
            "Finish with the sources you used (space:path)",
        ),
    ),
    WorkflowSpec(
        name="feedback_to_rule",
        when="User or reviewer says an output was wrong, bad or off-brand.",
        steps=(
            "Write one rule that would have prevented it, as a direct instruction",
            "Pick the narrowest space: the client if it is client-specific, else team, else org",
            (
                "Run: selfhub learn \"<rule>\" --space <space> --why \"<their feedback>\" "
                "--source <deliverable path>"
            ),
            "Tell the user the rule id and whether it applies now or waits for approval",
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
