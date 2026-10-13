"""Plain-language wording and small text transforms for API responses.

Every sentence the API sends goes to people who don't know git: no commits, pushes,
branches or rule ids; display names, not logins; roles as Can view / Can edit / Admin.
"""

from __future__ import annotations

import re
from typing import Any

ROLE_LABEL = {"read": "Can view", "write": "Can edit", "admin": "Admin", "none": "No access"}

RULE_ID = re.compile(r"\bR-\d{8}-[0-9a-f]{4}\b")
_RULE_COMMIT = re.compile(
    r"^\[SelfHub\] (approve|reject|learn) (R-\d{8}-[0-9a-f]{4}|\d+ rules?) in (.+)$"
)
_AUTO_MESSAGE = re.compile(r"^(Create|Edit|Update|Delete|Rename) \S")
_SAVE_LOCAL = re.compile(r"^Save \d+ changes? made on this computer$")
_HUNK = re.compile(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@")


def role_label(role: str) -> str:
    return ROLE_LABEL.get(role, role)


def plural(count: int, singular: str, many: str | None = None) -> str:
    return f"{count} {singular if count == 1 else (many or singular + 's')}"


def names_phrase(names: list[str]) -> str:
    """"Jordan Reyes", "Jordan Reyes and Ken Ito", "A, B and 2 others"."""
    unique = list(dict.fromkeys(n for n in names if n))
    if not unique:
        return ""
    if len(unique) == 1:
        return unique[0]
    if len(unique) == 2:
        return f"{unique[0]} and {unique[1]}"
    if len(unique) == 3:
        return f"{unique[0]}, {unique[1]} and {unique[2]}"
    return f"{unique[0]}, {unique[1]} and {len(unique) - 2} others"


def from_people(names: list[str]) -> str:
    phrase = names_phrase(names)
    return f" from {phrase}" if phrase else ""


def file_name(path: str) -> str:
    return path.rsplit("/", 1)[-1]


def is_auto_message(message: str) -> bool:
    """Messages SelfHub writes itself ("Update sops/x.md"); not worth quoting."""
    return bool(_AUTO_MESSAGE.match(message) or _SAVE_LOCAL.match(message)) or \
        message.startswith("[SelfHub]")


def display_message(message: str, titles: dict[str, str]) -> tuple[str, str | None]:
    """A commit message as people should read it, and the rule id it is about, if any."""
    match = _RULE_COMMIT.match(message)
    if match:
        verb = {"approve": "Approved", "reject": "Rejected", "learn": "Proposed"}[match.group(1)]
        what = match.group(2)
        if what.startswith("R-"):
            title = titles.get(what)
            return (f"{verb} a rule: {title}" if title else f"{verb} a rule"), what
        return f"{verb} {what}", None
    rule = RULE_ID.search(message)
    text = message.removeprefix("[SelfHub] ").strip()
    if rule:
        title = titles.get(rule.group(0))
        text = RULE_ID.sub(f"“{title}”" if title else "a rule", text)
    if text and message.startswith("[SelfHub]"):
        text = text[0].upper() + text[1:]
    return text, rule.group(0) if rule else None


def rule_commit(message: str) -> tuple[str, str] | None:
    """("approved" | "rejected" | "proposed", rule id) for single-rule SelfHub commits."""
    match = _RULE_COMMIT.match(message)
    if not match or not match.group(2).startswith("R-"):
        return None
    verb = {"approve": "approved", "reject": "rejected", "learn": "proposed"}[match.group(1)]
    return verb, match.group(2)


def file_format(path: str, binary: bool) -> str:
    if binary:
        return "binary"
    lower = path.lower()
    if lower.endswith((".md", ".markdown")):
        return "markdown"
    if lower.endswith((".csv", ".tsv")):
        return "csv"
    if lower.endswith(".json"):
        return "json"
    return "text"


def is_system_path(path: str) -> bool:
    return any(part.startswith(".") for part in path.split("/"))


_MD_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_MD_MARKS = re.compile(r"(\*\*|__|\*|`|~~)")
_MD_PREFIX = re.compile(r"^\s*(#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)")
_TABLE_RULE = re.compile(r"^\s*\|?\s*:?-{2,}")


def plain_snippet(text: str) -> str:
    """A search excerpt without markdown syntax or rule ids, on one line."""
    lines = []
    for raw in text.splitlines():
        if _TABLE_RULE.match(raw):
            continue
        line = _MD_PREFIX.sub("", raw)
        line = _MD_LINK.sub(r"\1", line)
        line = _MD_MARKS.sub("", line)
        line = RULE_ID.sub("", line).lstrip(": ").strip()
        if "|" in line:
            line = " · ".join(c.strip() for c in line.strip("| ").split("|") if c.strip())
        if line:
            lines.append(line)
    out = " ".join(lines)
    out = re.sub(r"(?<!\w)_(\S[^_]*?)_(?!\w)", r"\1", out)
    return re.sub(r"\s+", " ", out).strip()


def parse_patch(patch: str) -> list[dict[str, Any]]:
    """`git show --patch` output → files with typed lines, git headers removed."""
    files: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    old_no = new_no = 0
    for line in patch.splitlines():
        if line.startswith("diff --git "):
            parts = line[len("diff --git "):].split(" b/", 1)
            old = parts[0].removeprefix("a/")
            new = parts[1] if len(parts) > 1 else old
            current = {"path": new, "oldPath": old if old != new else None,
                       "status": "renamed" if old != new else "modified", "lines": []}
            files.append(current)
            continue
        if current is None:
            continue
        if line.startswith("new file mode"):
            current["status"] = "added"
        elif line.startswith("deleted file mode"):
            current["status"] = "deleted"
        elif line.startswith(("index ", "old mode", "new mode", "similarity index",
                              "rename from", "rename to", "--- ", "+++ ", "Binary files")):
            continue
        elif line.startswith("@@"):
            match = _HUNK.match(line)
            if match:
                old_no, new_no = int(match.group(1)), int(match.group(2))
            current["lines"].append({"type": "hunk", "text": line, "oldLine": None,
                                     "newLine": None})
        elif line.startswith("+"):
            current["lines"].append({"type": "add", "text": line[1:], "oldLine": None,
                                     "newLine": new_no})
            new_no += 1
        elif line.startswith("-"):
            current["lines"].append({"type": "del", "text": line[1:], "oldLine": old_no,
                                     "newLine": None})
            old_no += 1
        elif line.startswith(" ") or line == "":
            current["lines"].append({"type": "context", "text": line[1:], "oldLine": old_no,
                                     "newLine": new_no})
            old_no += 1
            new_no += 1
    return files
