"""Rules learned from feedback.

A reviewer says "the agent did badly on this". The agent turns that into one rule and
proposes it with `selfhub learn`. A human approves it, and from then on it is loaded
with its space on every task. Each rule keeps where it came from:

    ## R-20261012-3f9a: No urgency phrasing
    - rule: Never use urgency phrasing ("act now", "limited time") in ads.
    - why: Variant 2 of the spring promo used it and the client hates it.
    - source: work/2026-10-12-spring-promo.md
    - proposed by: Sam (2026-10-12)
    - approved by: Jordan (2026-10-12)

Proposed rules sit in rules/proposed.md and are never loaded as rules. Approved ones
move to rules/learned.md.
"""

from __future__ import annotations

import re
import secrets
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path

_HEADING = re.compile(r"^##\s+(R-\d{8}-[0-9a-f]{4})\s*:\s*(.*?)\s*$")
_FIELD = re.compile(r"^-\s*([a-z ]+?)\s*:\s*(.*)$")
_FIELDS: tuple[tuple[str, str], ...] = (
    ("rule", "rule"),
    ("why", "why"),
    ("source", "source"),
    ("proposed_by", "proposed by"),
    ("approved_by", "approved by"),
)


class RuleError(RuntimeError):
    pass


@dataclass(slots=True)
class Rule:
    id: str
    title: str
    rule: str
    why: str = ""
    source: str = ""
    proposed_by: str = ""
    approved_by: str = ""
    extra: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        return asdict(self)

    def render(self) -> str:
        lines = [f"## {self.id}: {self.title}"]
        for attr, label in _FIELDS:
            value = getattr(self, attr)
            if value:
                lines.append(f"- {label}: {value}")
        lines.extend(self.extra)
        return "\n".join(lines)


def new_rule_id(today: date | None = None) -> str:
    day = (today or date.today()).strftime("%Y%m%d")
    return f"R-{day}-{secrets.token_hex(2)}"


def title_for(rule_text: str) -> str:
    words = rule_text.strip().rstrip(".").split()
    title = " ".join(words[:8])
    return f"{title}…" if len(words) > 8 else title


def parse_rules(text: str) -> tuple[list[str], list[Rule]]:
    """Split a rules file into its preamble and its rules. Unknown lines in a rule are kept."""
    preamble: list[str] = []
    rules: list[Rule] = []
    current: Rule | None = None
    for line in text.splitlines():
        heading = _HEADING.match(line.strip())
        if heading:
            current = Rule(id=heading.group(1), title=heading.group(2), rule="")
            rules.append(current)
            continue
        if current is None:
            preamble.append(line)
            continue
        if not line.strip():
            continue
        match = _FIELD.match(line.strip())
        labels = {label: attr for attr, label in _FIELDS}
        if match and match.group(1) in labels:
            setattr(current, labels[match.group(1)], match.group(2).strip())
        else:
            current.extra.append(line)
    return _trim(preamble), rules


def render_rules(preamble: list[str], rules: list[Rule]) -> str:
    parts = ["\n".join(_trim(preamble))] if _trim(preamble) else []
    parts.extend(rule.render() for rule in rules)
    return "\n\n".join(parts) + "\n"


def read_rules(path: Path) -> tuple[list[str], list[Rule]]:
    if not path.exists():
        return [], []
    return parse_rules(path.read_text(encoding="utf-8"))


def append_rule(path: Path, rule: Rule, header: str) -> None:
    preamble, rules = read_rules(path)
    if not preamble and not rules:
        preamble = header.rstrip("\n").splitlines()
    rules.append(rule)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_rules(preamble, rules), encoding="utf-8")


def take_rule(path: Path, rule_id: str) -> Rule:
    """Remove a rule from a file and return it."""
    preamble, rules = read_rules(path)
    wanted = rule_id.strip()
    kept = [rule for rule in rules if rule.id != wanted]
    if len(kept) == len(rules):
        known = ", ".join(rule.id for rule in rules) or "none"
        raise RuleError(f"No rule {wanted} in {path.name}. Waiting: {known}.")
    taken = next(rule for rule in rules if rule.id == wanted)
    path.write_text(render_rules(preamble, kept), encoding="utf-8")
    return taken


def stamp(who: str, today: date | None = None) -> str:
    return f"{who or 'unknown'} ({(today or date.today()).isoformat()})"


def _trim(lines: list[str]) -> list[str]:
    start, end = 0, len(lines)
    while start < end and not lines[start].strip():
        start += 1
    while end > start and not lines[end - 1].strip():
        end -= 1
    return lines[start:end]
