# SelfHub: User Story and Dashboard Vision

## What SelfHub is

SelfHub is a company's memory, kept as plain markdown files in git repos the company owns.

- It holds the company's SOPs, brand and compliance rules, everything about each client,
  each employee's own workflows, and the rules agents have learned from feedback.
- Any AI agent can read it before doing work, so the agent works the way the company works.
- GitHub controls who can see and change what. Git history records every change.
- It is not a chatbot, a wiki or a drive. It is the memory layer those tools draw on.

There are three ways in, all over the same files and the same rules:

- **The CLI**, for coding agents and power users. It exists today.
- **Claude Desktop (and any MCP client)**, through a SelfHub MCP server. People keep working
  in the chat app they already use, and Claude pulls company memory as it works.
- **The dashboard**, for browsing, managing spaces, reviewing and approving. Most of this
  document describes it.

None of them is a second source of truth. A rule approved in the dashboard applies in Claude
Desktop on the next message, and the reverse is also true.

## The cast

The example is Northline, a 20-person marketing agency for contractors.

| Person | Role | What they need from SelfHub |
|---|---|---|
| Maya | Owner / admin | Set the rules once and know nobody (human or agent) breaks them |
| Sam | Ads specialist | Say "make an ad for Apex" and get on-brand work without re-explaining |
| Jordan | Strategist | Review agent output and fix the cause, not just the ad |
| Priya | Account manager | Onboard a new client in minutes, with the right people having access |
| Leo | New hire | Learn "how we do things here" on day one |

## The main story

> As Sam, an ads specialist, I want to ask the agent inside SelfHub for an ad for a client,
> following my SOP, and get on-brand work that respects company rules, so I spend my time
> on judgment instead of re-explaining context.

### A day at Northline

1. **Sam opens the dashboard.** Home shows:
   - Sam's spaces: Northline (org), Ads team, Apex Roofing, Bolt HVAC, and Sam's own space.
   - Two rules waiting for review.
   - What changed since yesterday.
2. **Sam opens the agent panel and types:** "Facebook ad for Apex's spring promo. Follow my
   ads SOP."
3. **Before it writes, the agent shows what it loaded:**
   - Northline's locked compliance rules (lock icon)
   - Apex's brief and Apex's 3 learned rules
   - Sam's ads SOP
   - A line: "Bolt HVAC not loaded"

   Sam can click any of these to open the file.
4. **The agent delivers 3 variants**, each listing the files it used. Sam sends the set
   to Jordan for review in one click.
5. **Jordan reviews in the Review queue.** Jordan marks variant 2 as bad and writes:
   "Too pushy. Apex hates urgency language."
6. **The agent proposes a rule:** "Never use urgency phrasing for Apex." It suggests the
   narrowest place for it (Apex, not all clients). Jordan can change the scope, edit the
   wording, then approve.
7. **The rule shows up in Apex's Rules tab** with its history: who proposed it, who
   approved it, why, and the ad that triggered it.
8. **Next week Sam asks for another Apex ad.** The agent follows the rule and cites it.
   A Bolt ad is unaffected.

## Stories by screen

### 1. Home

> As any employee, I want one page showing my spaces, what needs me, and what changed.

- Shows connected spaces with kind (org / team / client / personal) and sync status.
- Shows "Needs you": rules to approve, PRs to review, failed syncs.
- Shows recent changes across my spaces: who changed what, with links.
- **Done when:** a new employee can tell from Home alone which clients they work on.

### 2. Spaces (create and connect repos)

> As Priya, I want to create a client space from a template and give the right team access,
> without touching GitHub or a terminal.

- "New space" form: name, kind, aliases, owners, which GitHub team gets access.
- Creates the private GitHub repo in the company org from a template: brief, work, rules,
  and a manifest.
- For org spaces, it sets up CODEOWNERS and branch protection, or shows exactly what an
  admin must click.
- "Connect" lists every space the user's GitHub account can see, with one-click add.
- **Done when:** Priya goes from "we signed Apex" to "the Apex space exists and the ads team
  can use it" in under 2 minutes.

### 3. Explorer (see the folders, see the info)

> As any employee, I want to browse a space like a folder tree, read files, and edit what
> I'm allowed to edit.

- File tree per space, with a markdown preview and editor.
- Badges: 🔒 locked, ✍️ editable, 👁 read-only. Locked files show who owns them.
- Saving a file is a commit. In pull-request spaces, saving opens a "proposed change" for
  review.
- History tab per file: every change, who made it, and a diff. One-click revert where
  allowed.
- Search across all my spaces, with results grouped by space.
- **Done when:** nobody needs to open GitHub to read or update company memory.

### 4. Agent panel

> As Sam, I want an agent inside SelfHub that does work using company memory, and shows me
> what it used.

- Chat panel next to the Explorer, so files and agent are on one screen.
- Every answer starts with a collapsible "Context used" block (the `selfhub context`
  bundle): locked rules, loaded clients, rules, policies, and clients not loaded.
- Every deliverable ends with its sources, and each source is clickable.
- Mentioning a client loads it. Switching clients in one chat starts a fresh context, so
  nothing carries over.
- The agent can save to memory. Whether it asks first follows the user's policies.
- The agent never edits locked files and never approves rules.
- **Done when:** Sam can explain where every claim in an ad came from.

### 5. Review queue (feedback → rules)

> As Jordan, I want to review agent output, mark what's wrong, and have that turn into a rule
> so the mistake doesn't repeat.

- Lists outputs sent for review, by client and author.
- For each output: 👍 / 👎 plus a comment, at variant level or line level.
- A 👎 with a comment produces a proposed rule with a suggested scope (client / team / org).
  The reviewer can edit it before sending.
- **Done when:** the same mistake is never flagged twice for the same client.

### 6. Rules and approvals

> As an owner of a space, I want to see every rule my agents follow, where it came from,
> and approve or reject new ones.

- Rules tab per space: active rules, pending rules, rejected rules.
- Each rule shows its text, why it exists, its source deliverable, who proposed it, who
  approved it, and the date.
- Approve / reject / edit, open only to people allowed to approve in that space. On GitHub,
  that means its code owners.
- **Done when:** for any agent behavior, someone can answer "why does it do that?" in one
  click.

### 7. Policies

> As an employee, I want to choose how my agent behaves. As an admin, I want some
> behaviors forced on for everyone.

- A toggle per policy (ask-before-save, cite-sources, draft-only, and so on).
- Policies the org enforces show as locked-on, with the reason.
- **Done when:** an employee can make the agent stricter but never looser than the org
  allows.

### 8. People and access

> As Maya, I want to see who can read and change each space, managed through GitHub, not a
> second permission system.

- Table of spaces × GitHub teams with access levels, read from GitHub.
- "Add person to Apex" adds them to the matching GitHub team.
- Offboarding: removing someone from GitHub removes their dashboard access.
- **Done when:** access in the dashboard always matches access on GitHub.

### 9. Onboarding (new hire)

> As Leo, a new hire, I want to ask "how do we do ads here?" on day one and get the real
> answer.

- First login: sign in with GitHub, auto-connect every space Leo can access, and run a
  short tour.
- The agent answers from org and team SOPs, with sources. It never shows another
  person's personal space.
- **Done when:** Leo ships a first draft ad in week one without a 1:1 walkthrough.

### 10. Claude Desktop (SelfHub as an MCP connector)

> As Sam, I want to do the same work from Claude Desktop, without opening the dashboard, and
> get the same rules, the same client isolation and the same feedback loop.

1. **Setup, once:** Sam adds the SelfHub connector to Claude Desktop.
   - Local: the `selfhub mcp` server runs on Sam's machine against Sam's clones.
   - Hosted: the company's SelfHub server URL, signed in with GitHub.
2. **Sam types in Claude Desktop:** "Make a Facebook ad for Apex's spring promo, follow my
   ads SOP." Claude calls `selfhub_context` first. It gets the same bundle the dashboard
   agent gets: locked rules, Apex only, Sam's SOP and policies.
3. **Claude writes the ad and lists its sources** (space:path).
4. **Sam replies:** "Variant 2 is too pushy, Apex hates urgency." Claude calls
   `selfhub_learn` with the client scope. The rule waits for approval in the dashboard's
   Rules tab, or as a GitHub PR for org spaces.
5. **Jordan approves it in the dashboard.** Sam's next Apex request in Claude Desktop
   follows the new rule.

Tools the MCP server exposes (each one maps to a CLI command):

| MCP tool | Does | CLI |
|---|---|---|
| `selfhub_context` | Bundle for a task: locked rules, named client, rules, policies, sources | `context` |
| `selfhub_search` / `selfhub_recall` | Find memory across my spaces | `search`, `recall` |
| `selfhub_read` | Read a file or folder in a space | `read` |
| `selfhub_save` | Save to a space (refused on locked paths) | `save` |
| `selfhub_learn` | Propose a rule from feedback | `learn` |
| `selfhub_rules` | List active or pending rules | `rules list` |
| `selfhub_spaces` | List connected spaces | `space list` |

Also exposed:
- Files as MCP resources, so Sam can attach `Apex Roofing:brief.md` to a chat.
- Prompts such as "Do a task with company memory" and "Turn this feedback into a rule".

Deliberately **not** exposed: approving or rejecting rules, editing locked files, creating
spaces, and changing access. Those stay in the dashboard or GitHub, done by a human.

- **Done when:** Sam can do the whole ads workflow without leaving Claude Desktop, and
  the output matches what the dashboard agent would produce for the same request.

## Rules no surface may break (dashboard, Claude Desktop, CLI)

- Files in git are the source of truth. Every surface only reads and writes them.
- All three surfaces call the same core, so a rule, lock or policy behaves the same
  everywhere.
- GitHub permissions decide access. The dashboard never grants more than GitHub does.
- Locked files can't be changed in the dashboard except by their owners, through review.
- An agent only loads clients that the task names.
- Rules from feedback always pass through a human before they apply, unless a policy the
  space allows says otherwise.
- Every change has an author and a reason, visible in history.

## How it maps to what exists today

| Dashboard | CLI today |
|---|---|
| Spaces: create / connect | `selfhub space create`, `space add`, `space list`, `space sync` |
| Explorer: read / edit / history | `selfhub read`, `save`, `delete`, `log` with `--space` |
| Search | `selfhub search`, `recall` with `--space` |
| Agent panel: context used | `selfhub context "<task>" --json` |
| Review → proposed rule | `selfhub learn` |
| Rules: approve / reject | `selfhub rules list`, `approve`, `reject` |
| Policies | `selfhub policy list`, `enable`, `disable` |
| People and access | not built (GitHub API) |
| Review queue | not built (needs a store for deliverables and feedback) |
| Claude Desktop connector | not built (`selfhub mcp`: a thin MCP layer over the same service) |

## Open questions

1. **Hosting:** does each employee run SelfHub locally against clones, or does Northline
   host one server that holds clones and signs people in with GitHub? Hosted is simpler
   for staff and harder for us. One hosted server could serve both the dashboard and a
   remote MCP connector for Claude Desktop.
2. **Which agent:** a built-in agent (our own model calls), or bring-your-own (Claude, Codex)
   pointed at SelfHub? Possibly both.
3. **Where deliverables live:** in the client space (`work/`), or outside SelfHub with only
   the feedback and rules stored?
4. **Who approves rules** when a space has no code owners: the proposer's lead, or any
   member?
5. **Pricing unit:** per seat, per company, or per space?
