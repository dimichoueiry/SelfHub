# SelfHub as a Company Brain

One person's SelfHub is one git repo. A company adds more repos next to it, called
**spaces**, and every person connects the ones they need:

| Kind | Holds | Loaded |
|---|---|---|
| personal | your own SelfHub: preferences, your workflows and SOPs | always |
| org | company SOPs, brand, compliance; `locked/` rules | always |
| team | one team's shared workflows (e.g. ads) | always, for people who connect it |
| client | one client's brief, past work, client rules | only when the task names that client |

GitHub does the access control. Who can read a space is who can read its repo. Who can
change locked rules is whoever CODEOWNERS names. SelfHub keeps agents inside those lines:
it refuses locked writes and never loads a client the task didn't name.

## The pieces

- **Manifest** `.selfhub/space.json`: name, kind, aliases, `locked` paths, `always_load`
  files, `owners`, `write_policy` (`direct` | `pull-request` | `read-only`),
  `learn_policy` (`propose` | `direct`), and `policies` enforced for everyone.
- **Locked paths**: loaded in full on every task, listed first, and never written by
  SelfHub. On GitHub, CODEOWNERS plus branch protection makes the lock real for people too.
- **Context**: `selfhub context "<task>"` gives an agent everything it needs for one task.
  That means the precedence order, locked rules, the client it names (and only that
  client), learned rules, policies in force, relevant excerpts, and the list of sources.
- **Learned rules**: feedback turns into a rule with `selfhub learn`. A human approves it,
  then it loads with its space from that point on. Every rule records why it exists, where
  it came from, who proposed it, and who approved it.
- **Policies**: switches for agent behavior. People turn them on for themselves with
  `selfhub policy enable`. An org can force them on for everyone in its manifest.

Precedence, highest first:

1. Locked rules
2. The user's explicit instructions for this task
3. Client memory
4. Team, then org SOPs and learned rules
5. The user's personal workflows and preferences

## Set up a company (admin, once)

```bash
selfhub space create ~/spaces/northline --name Northline --kind org \
  --owner @northline/admins --remote-url git@github.com:northline/brain.git
```

Then on GitHub (the command prints these steps too):

1. Keep the repo private in the company's GitHub organization.
2. Give teams access: read for everyone who uses it, write only where people save directly.
3. Protect `main` with a ruleset: require a pull request, require Code Owner review, and
   block force pushes.
4. CODEOWNERS (already generated) routes `locked/`, the manifest, and `rules/learned.md`
   to the owners.

Org spaces default to `write_policy: pull-request`. Saves and learned rules land on a
`selfhub/...` branch, and a PR opens when the `gh` CLI is installed. Nothing reaches
`main` until a reviewer merges it.

Create one space per client so read access stays separate per client:

```bash
selfhub space create ~/spaces/apex --name "Apex Roofing" --kind client --alias apex \
  --remote-url git@github.com:northline/client-apex.git
```

Private org repos need a paid GitHub plan for branch protection and required Code Owner
reviews. Check GitHub's current pricing.

## Join (each employee)

```bash
selfhub space add git@github.com:northline/brain.git
selfhub space add git@github.com:northline/client-apex.git
selfhub space list
selfhub space sync          # pull every space
```

## The ads workflow, end to end

The ads person asks their agent: "Make a Facebook ad for Apex's spring promo. Follow my
ads SOP."

```bash
selfhub context "Facebook ad for Apex spring promo, follow my ads SOP" --json
```

The agent gets:

- Northline's locked compliance rules, in full
- Apex's brief and Apex's learned rules
- Their personal `sops/ads.md`
- A note that Bolt HVAC exists and was not loaded

It writes the ad and lists its sources.

The strategist reviews: "Variant 2 is too pushy. Apex hates urgency language." The agent
proposes a rule in the narrowest space it belongs to:

```bash
selfhub learn "Never use urgency phrasing ('act now', 'limited time')." --space apex \
  --why "Strategist: variant 2 felt pushy" --source work/2026-10-12-spring-promo.md
# Rule R-20261012-3f9a in 'Apex Roofing' waiting for approval: ...
```

A human approves it. Agents are told never to approve rules themselves:

```bash
selfhub rules list --pending
selfhub rules approve R-20261012-3f9a --space apex
```

Every later Apex task loads that rule. Bolt HVAC tasks don't.

## Writing into a space

`--space` works on `save`, `read`, `search`, `recall`, `delete`, `log`, `status` and `sync`:

```bash
selfhub save "Spring promo: 4.1% CTR, best hook was the hail-damage photo" \
  --space apex --file work/2026-10-12-spring-promo.md
```

A write to a locked path is refused and nothing is written. A `read-only` space refuses
every write.

## Policies

```bash
selfhub policy list
selfhub policy enable cite-sources
```

| Policy | Effect |
|---|---|
| ask-before-save | agent asks before every save or learn |
| cite-sources | agent ends every deliverable with the files it used |
| learn-from-feedback | agent proposes a rule whenever it is corrected |
| learn-direct | rules learned in your personal space apply without approval |
| draft-only | agent drafts, never publishes, sends or posts |

To force a policy on everyone, add it to the org manifest's `policies` list. That change
goes through review like any other locked file.

## Limits of this version

- GitHub enforces access per repo, not per folder. Keep each client in its own repo.
- Locks on GitHub stop people from merging changes. SelfHub stops agents from writing.
  Neither one forces an agent to follow a rule. That comes from the context bundle and
  the agent contract (`selfhub agent-spec`).
- `rules approve` runs locally under whoever runs it. With `pull-request` spaces the
  review on GitHub is the approval that counts.
