// Turning API and git text into plain copy for people.

import type { Person, Rule } from "@/lib/api/types";

const RULE_ID = /\bR-\d{8}-[0-9a-f]{4}\b:?/g;

/** Markdown and table syntax out, one line of plain text in (search snippets, previews). */
export function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/(^|\s)>\s?/g, "$1")
    .replace(/(^|\s)[-*+]\s+\[[ xX]\]\s+/g, "$1")
    .replace(/(^|\s)[-*+]\s+/g, "$1")
    .replace(/(\*\*|__|\*|_|`|~~)(.+?)\1/g, "$2")
    .replace(/[*_`~]/g, "")
    .replace(/-{3,}/g, " ")
    .replace(RULE_ID, "")
    // Field keys from rule files ("rule: … why: …").
    .replace(/\b(rule|why|source|proposed by|proposed|approved by|status)\s*:\s*/gi, "")
    // Empty table cells come through as runs of separators.
    .replace(/(\s*[·•]\s*){2,}/g, " · ")
    .replace(/^\s*[·•]\s*|\s*[·•]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Name for a login, when we know it. */
export function nameFor(login: string, people: Person[] | undefined) {
  return people?.find((p) => p.login === login)?.name ?? login;
}

function ruleText(id: string, rules: Rule[] | undefined, max = 48) {
  const r = rules?.find((x) => x.id === id);
  if (!r) return "a rule";
  const t = r.title || r.text;
  return `“${t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t}”`;
}

const ACCESS_WORD: Record<string, string> = { read: "Can view", write: "Can edit", admin: "Admin", maintain: "Admin", triage: "Can view" };

/** Activity and commit text without rule IDs, "[SelfHub]" prefixes, raw logins or git words. */
export function cleanSentence(text: string, people: Person[] | undefined, rules: Rule[] | undefined, capitalize = true): string {
  let s = text.replace(/^\s*\[SelfHub\]\s*/i, "");
  // "approve R-2026…-543f in Ads Team" → "Approve “Keep hooks short” in Ads Team"
  s = s.replace(/\b(rule\s+)?(R-\d{8}-[0-9a-f]{4})\b/g, (_m, _rule, id) => `rule ${ruleText(id, rules)}`);
  s = s.replace(/\b(\d+) rules\b/g, "$1 rules");
  // "gave leo-park read access to Northline" → "set Leo Park to Can view on Northline"
  s = s.replace(/\b(gave|changed)\s+@?([\w-]+)\s+(read|write|admin|maintain|triage)\s+access\s+(?:to|on)\s+(.+?)(\.?)$/i, (_m, _v, login, role, space, dot) =>
    `set ${nameFor(login, people)} to ${ACCESS_WORD[role.toLowerCase()]} on ${space}${dot}`,
  );
  s = s.replace(/\b(read|write) access\b/gi, (_m, r) => `${ACCESS_WORD[r.toLowerCase()]} access`);
  // Raw logins → names.
  for (const p of people ?? []) {
    s = s.replace(new RegExp(`@?\\b${p.login.replace(/[-]/g, "\\-")}\\b`, "g"), p.name);
  }
  // Git words → plain words.
  s = s
    .replace(/\bPulled (\d+) new commits?\b/gi, (_m, n) => `Got ${n} change${n === "1" ? "" : "s"}`)
    .replace(/\bpulled (\d+) new commits?\b/gi, (_m, n) => `got ${n} change${n === "1" ? "" : "s"}`)
    .replace(/\bPushed (\d+) commits?\b/gi, (_m, n) => `Sent ${n} change${n === "1" ? "" : "s"}`)
    .replace(/\bpushed (\d+) commits?\b/gi, (_m, n) => `sent ${n} change${n === "1" ? "" : "s"}`)
    .replace(/\bcommits?\b/gi, (m) => (m.toLowerCase().endsWith("s") ? "changes" : "change"))
    .replace(/\bpull request\b/gi, "review")
    .replace(/\b(\d+) updates?\b/gi, (_m, n) => `${n} change${n === "1" ? "" : "s"}`)
    .replace(/\bupdates\b/gi, "changes")
    .replace(/\brepo(sitory)?\b/gi, "space");
  return capitalize ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Lower-case first letter, for "<Name> <predicate>". */
export function predicate(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
