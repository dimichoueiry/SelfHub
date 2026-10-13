# Agent skill pack

Claude Code and Codex agents working in a SelfHub space need to know where things live,
how to name new files, and what they may change. The skill pack tells them.

It is one set of instructions, built by `selfhub_cli/skills.py` from SelfHub's own
constants and the space's `.selfhub/space.json`. It is written out in two forms:

| File | Read by |
|---|---|
| `<space>/.claude/skills/selfhub/SKILL.md` | Claude Code, in that space |
| `<space>/AGENTS.md` (SelfHub block) | Codex, in that space |
| `~/.claude/skills/selfhub/SKILL.md` | Claude Code, anywhere (`--global`) |
| `~/.codex/AGENTS.md` (SelfHub block) | Codex, anywhere (`--global`) |

The space version names that space's kind, locked paths, write policy and forced
policies. The global version tells the agent to read the manifest itself.

Learned rules are not copied in. The pack tells the agent to read `rules/learned.md` (or
run `selfhub context`) on every task, so a newly approved rule applies at once.

## Install

```bash
selfhub skills install --space ~/spaces/apex            # one space
selfhub skills install --all                            # your SelfHub and every connected space
selfhub skills install --all --global                   # and ~/.claude, ~/.codex
selfhub skills install --space ~/spaces/apex --dry-run  # show what would change
selfhub skills show --space ~/spaces/apex [--codex]     # print it without writing
```

- Safe to run again. Nothing changes when nothing has changed.
- Only the text between `<!-- BEGIN:selfhub-skill-pack -->` and
  `<!-- END:selfhub-skill-pack -->` is ever replaced. Anything else in `AGENTS.md` or
  `SKILL.md` is kept. If the markers are damaged, the install stops and changes nothing.
- The pack stays on this computer. In a git space it is added to `.git/info/exclude`, so
  it doesn't show up as unsaved changes and isn't sent to the client's repo. Pass
  `--share` to leave it visible so you can commit it. An `AGENTS.md` that is already
  committed is never hidden; the SelfHub block shows up as a change to it.

From Python (for the setup script):

```python
from selfhub_cli.skills import install_skills
install_skills(space=path)                 # returns what it created, updated or left alone
install_skills(global_home=Path.home())
```

## Customise it for a client (admin)

Write `.selfhub/agent-skills.json` in the space, then run the install again. Every key is
optional; unknown keys are refused so typos don't pass silently.

```json
{
  "company": "Apex Roofing",
  "tone": "Plain and friendly. Short sentences. No jargon.",
  "folders": {
    "campaigns/": "one folder per campaign, named YYYY-MM-<name>",
    "photos/": "job-site photos; never edit, only add"
  },
  "protect": ["contracts/", "pricing.md"],
  "ask_first": ["Before mentioning prices or discounts."],
  "instructions": ["Write in US English.", "Cite the brief for every claim about Apex."]
}
```

| Key | Effect |
|---|---|
| `company` | Name used in the title, instead of the manifest name |
| `tone` | Tone for anything the agent writes in this space |
| `folders` | Extra lines under "Where things live" |
| `protect` | Extra paths under "Never" (agents won't write them; git doesn't enforce it) |
| `ask_first` | Extra cases under "Ask the user first" |
| `instructions` | Extra lines under "From the admin" |

To keep the settings out of the client's repo, keep the file anywhere else and pass it:
`selfhub skills install --space ~/spaces/apex --overrides ~/agency/apex-skills.json`.

`protect` only steers agents. For a real lock, add the path to `locked` in
`.selfhub/space.json`; the pack lists locked paths automatically.
