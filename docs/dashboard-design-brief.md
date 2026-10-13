# SelfHub Dashboard: Design Brief

Shared source of truth for the visual, interaction and frontend work on the SelfHub
company-brain dashboard (`dashboard/`). Read with `docs/dashboard-user-story.md` and
`docs/company-brain.md`.

The bar: a product that feels like a top design team built it, in the same class as Linear,
Vercel and Notion. Calm, precise, fast. Not generic templated SaaS.

## Product and users

SelfHub is a company's memory in git repos called **spaces**. Kinds:

- **org**: company-wide SOPs, brand, compliance
- **team**: one team's shared workflows
- **client**: one client's brief, past work, rules
- **personal**: one person's own workflows

Users are staff at 5-50 person companies, many not technical. Persona company is the
Northline agency:

| Person | Role |
|---|---|
| Maya | Owner / admin |
| Sam | Ads specialist, the demo's default user |
| Jordan | Reviewer / strategist |
| Priya | Account manager |
| Leo | New hire |

Jobs to be done:

1. Find and read company knowledge quickly.
2. Edit it when allowed, and clearly know when you can't and why.
3. Keep it synced with GitHub without understanding git.
4. Add a repo or space.
5. See and manage who has access (admins).

## Information architecture

Left sidebar, top to bottom:

- Org switcher / header
- Search (⌘K)
- Home
- Spaces list, grouped Company / Teams / Clients / Personal. Each item has a small kind glyph
  and a sync dot.
- People & access
- Rules, with a pending-count badge
- Settings, at the bottom
- User menu with avatar and a demo-mode pill (switch user to Maya for admin QA)

## Screens

- **Home**: greeting; "Needs you" (pending rules you can approve, spaces out of sync, local
  changes not pushed); recent activity; your spaces as cards (kind, your access, sync state,
  last updated).
- **Space view (Explorer)**
  - Header: space name, kind, repo link, "Your access" chip, sync status button, tabs
    Files | History | Members | Settings.
  - Files tab: tree pane (collapsible folders, lock icons, search-in-space), then file pane.
  - File pane: rendered markdown at a good reading width, typography for headings, tables,
    lists, code; breadcrumb; last-edited-by.
  - Edit button only when editable. Otherwise a quiet explanation chip, e.g.
    "Locked: owned by @maya. Suggest a change" or "You can view this space".
  - Editor: split or toggle edit/preview; commit message ("Describe your change"). Primary
    button follows the write policy: **Save & sync** (direct) or **Propose change**
    (pull-request, says it opens a review). Unsaved-changes guard, ⌘S, a conflict state
    (someone else changed this, with options), and success toasts that say where the change
    went.
  - Per-file history with diff.
  - Create file; rename / delete with confirmation.
- **Sync**: one clear status per space:
  - Synced · Updated 3m ago
  - 2 updates to pull
  - Local changes not pushed
  - Not connected to GitHub
  - Conflict needs attention

  Plus Sync now with progress and outcome, a global Sync all, and a plain-language error
  recovery state.
- **Add space** dialog, two paths: "Connect an existing GitHub repo" (URL or pick from
  list) and "Create a new space" (name, kind cards, description, owners, review-required
  toggle). Validation, a creating state, and a success state that leads into the new space.
- **People & access**: people × spaces matrix (role pills), filter and search, a person
  drawer (their spaces and roles), and a space Members tab (list, change role, invite by
  GitHub username, remove with confirmation). Only admins see controls; everyone else sees
  read-only with a reason. Role labels: **Admin, Can edit, Can view, No access**, mapped to
  GitHub admin / write / read in a tooltip.
- **Rules**: Pending / Active / Rejected tabs. Each card: rule text, why, source, proposed
  by, space, Approve / Reject for eligible users.
- **⌘K command palette**: search files across spaces, jump to spaces, run actions.
- **States everywhere**: loading skeletons, empty states with a next action, errors with
  recovery, no-access, long names and long content.

## Visual direction

- Light theme default plus a polished dark theme.
- Neutral, slightly warm greys; one restrained accent (deep indigo / ink-blue).
- Kind colors are subtle and only in small glyphs: org = ink, team = teal, client = amber,
  personal = violet.
- Geist for UI, Geist Mono for paths and shas. Tight, deliberate type scale.
- 4px spacing grid, 8-10px radii, hairline borders over heavy shadows, generous whitespace,
  dense-but-calm tables.
- 120-180ms transitions; respect `prefers-reduced-motion`.
- No emoji as icons; lucide only.
- Copy: plain, specific, adult, not cute. Say what happened and what to do next. No git
  jargon in the main UI ("Save & sync", not "commit & push"); technical detail goes in
  secondary text.

## Stack

Next.js (App Router) + TypeScript + Tailwind + shadcn/ui (Radix) + lucide + react-markdown
with remark-gfm. TanStack Query for data. pnpm.

## Data

API base `http://localhost:8787`, camelCase, errors `{error:{code,message,hint}}`. The client
has two adapters chosen by `NEXT_PUBLIC_SELFHUB_API=mock|http` (default `mock`). The mock
adapter holds realistic in-memory Northline data and simulates latency, writes, conflicts
and 403s.

Endpoints:

- `GET /api/me` → `{login,name,avatarUrl,mode,org:{name,avatarUrl}}`
- `GET /api/spaces` → `[{id,name,kind,description,repo:{owner,name,url}|null,writePolicy,
  defaultBranch,sync:{state,ahead,behind,lastSyncAt,message},myAccess,owners,lockedPaths,
  fileCount,memberCount,updatedAt}]`
  - `writePolicy`: `direct | pull-request | read-only`
  - `sync.state`: `synced | ahead | behind | diverged | local-changes | no-remote | error`
  - `myAccess`: `admin | write | read | none`
- `POST /api/spaces` `{action:'connect',source,name?}` | `{action:'create',name,kind,
  description?,owners?,writePolicy?}`
- `DELETE /api/spaces/{id}`
- `POST /api/spaces/{id}/sync` → `{space,result,message,pulled,pushed}`
  (`result`: `up-to-date | pulled | pushed | conflict | error`)
- `GET /api/spaces/{id}/tree` → `[{path,name,type,locked,editable,reason?,size?,updatedAt?,
  updatedBy?}]`
- `GET /api/spaces/{id}/file?path=` → `{path,content,locked,editable,reason?,sha,
  lastCommit:{sha,author,date,message}}`
- `PUT /api/spaces/{id}/file` `{path,content,message,baseSha}` → `{outcome:'committed'|
  'pull-request',commit,prUrl?,file}`; 409 conflict; 403 locked | read-only | no-access
- `POST /api/spaces/{id}/files` `{path,content,message}`
- `DELETE /api/spaces/{id}/file?path=&message=`
- `GET /api/spaces/{id}/history?path=&limit=` → `[{sha,author:{login,name,avatarUrl},date,
  message,additions,deletions}]`
- `GET /api/spaces/{id}/diff?sha=&path=` → `{sha,patch}`
- `GET /api/search?q=&space=` → `[{spaceId,path,title,snippet,score}]`
- `GET|POST /api/spaces/{id}/members`, `PUT|DELETE /api/spaces/{id}/members/{login}`
  (member: `{login,name,avatarUrl,role,via:'direct'|'team',team?,isOwner}`)
- `GET /api/people` → `{people,spaces,access:{[login]:{[spaceId]:role|'none'}}}`
- `GET /api/rules?status=&space=` → `[{id,spaceId,text,why,source,proposedBy,proposedAt,
  approvedBy?,status,prUrl?}]`; `POST /api/rules/{id}/approve|reject`
- `GET /api/activity` → `[{id,type,actor,spaceId,path?,summary,date}]`

Mock data: Northline (org, pull-request, `locked/`), Ads Team, Apex Roofing, Bolt HVAC (Sam
has no access), Sam's personal space; real SOP and brief markdown; pending rules; varied
sync states.

## Responsive and accessibility

- Desktop-first at 1440 / 1280.
- 1024: sidebar collapses to icons.
- 390: sidebar becomes a drawer, the tree becomes a sheet, the matrix scrolls horizontally
  with a sticky first column.
- Full keyboard navigation (tree arrow keys, ⌘K, dialogs trap focus, Esc closes), visible
  focus rings, labels on icon buttons, WCAG AA contrast in both themes.
- Meaning is never carried by color alone: sync and lock states always pair an icon with
  text.

## Validation

Run the app and use Playwright to exercise:

- (a) Sam opens the Apex brief → edits → Save & sync → toast
- (b) Sam tries a Northline locked file → sees the reason
- (c) a conflict on save
- (d) Sync now on a behind space
- (e) Add space, both paths
- (f) as Maya, change Leo's role and invite someone
- (g) approve a pending rule
- (h) ⌘K search

Screenshots at 1440, 1024 and 390 in light and dark go to `dashboard/qa/screenshots/`.
`pnpm build` and `pnpm lint` must pass.

---

## Token decisions

Implemented as CSS variables in `dashboard/src/app/globals.css` and exposed to Tailwind v4
through `@theme inline`. Components never use raw hex values.

### Color

Neutrals are a warm grey ramp (hue ~60-75 in OKLCH, chroma 0.002-0.006): enough warmth to
avoid the cold blue-grey SaaS look, not enough to read as beige.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `oklch(0.993 0.002 75)` | `oklch(0.165 0.004 65)` | App canvas |
| `--surface` | `oklch(1 0 0)` | `oklch(0.195 0.004 65)` | Cards, panes, dialogs |
| `--sidebar` | `oklch(0.975 0.003 75)` | `oklch(0.145 0.004 65)` | Sidebar |
| `--muted` | `oklch(0.962 0.004 75)` | `oklch(0.235 0.004 65)` | Hover fills, chips |
| `--foreground` | `oklch(0.2 0.006 60)` | `oklch(0.95 0.003 75)` | Body text |
| `--muted-foreground` | `oklch(0.47 0.008 60)` | `oklch(0.72 0.006 70)` | Secondary text (AA ≥ 4.5:1 on surface) |
| `--subtle-foreground` | `oklch(0.54 0.007 60)` | `oklch(0.62 0.006 70)` | Metadata only; still ≥ 4.5:1 on surface |
| `--border` | `oklch(0.915 0.004 75)` | `oklch(0.27 0.004 65)` | Hairlines |
| `--border-strong` | `oklch(0.86 0.005 75)` | `oklch(0.34 0.005 65)` | Inputs, focused panes |
| `--primary` (ink-blue) | `oklch(0.42 0.13 268)` | `oklch(0.7 0.12 268)` | Primary buttons, links, focus |
| `--primary-soft` | `oklch(0.955 0.02 268)` | `oklch(0.27 0.05 268)` | Selected rows, active nav |
| `--ring` | = primary (solid) | = primary (solid) | 2px focus ring; inset on the editor |

Status colors are always paired with an icon and a text label. Each has a fill/icon token
and a darker `-text` token, because the fill colors (amber especially) fail AA as text:

| Token | Light fill / text | Meaning |
|---|---|---|
| `--success`, `--success-text` | `0.6 0.13 155` / `0.47 0.11 155` | Synced, approved, saved |
| `--warning`, `--warning-text` | `0.7 0.14 70` / `0.5 0.11 62` | Updates to pull, local changes, editing |
| `--danger`, `--danger-text` | `0.56 0.19 27` / `0.5 0.18 27` | Conflict, error, destructive |
| primary | | Neutral notices, selection |

Dark theme lifts every `-text` token to L 0.74-0.82.

Kind colors, glyph-only (small square glyph with a lucide icon, never as large fills):

| Kind | Token | Light | Icon |
|---|---|---|---|
| org | `--kind-org` | ink `oklch(0.3 0.03 265)` | `Building2` |
| team | `--kind-team` | teal `oklch(0.52 0.09 190)` | `Users` |
| client | `--kind-client` | amber `oklch(0.6 0.12 70)` | `Briefcase` |
| personal | `--kind-personal` | violet `oklch(0.52 0.15 295)` | `User` |

### Typography

Geist Sans for UI, Geist Mono for paths, shas and branch names (via `next/font`, the
`geist` package). Base UI size 14px; reading view 15px.

The scale overrides Tailwind's own keys (so class merging keeps working) instead of adding
new names:

| Class | Size / line-height | Weight | Use |
|---|---|---|---|
| `text-[11px]` | 11 / 16 | 500 | Group labels (uppercase, +0.04em), badges, kbd |
| `text-xs` | 12 / 16 | 400-500 | Metadata, chips |
| `text-sm` | 13 / 20 | 400-500 | Nav, tables, secondary |
| `text-base` | 14 / 22 | 400 | Default UI |
| `.md` body | 15 / 26 | 400 | Markdown reading view |
| `text-lg` | 16 / 24 | 600 | Section and space titles |
| `text-xl` | 20 / 28 | 600 | Page titles, -0.01em |
| `text-2xl` | 24 / 32 | 600 | Home greeting, -0.015em |

Markdown reading width: `68ch` max.

### Space, radius, elevation, motion

- 4px grid. Common steps: 4, 8, 12, 16, 24, 32, 48.
- Radius: `--radius` 8px (inputs, buttons, chips 6px; cards, dialogs 10px).
- Hairlines (1px `--border`) do the separating. Shadows only on floating layers: popovers,
  menus, dialogs, toasts (`--shadow-float`: a soft 1px ring plus a 12px/24px low-alpha drop).
- Row height: 32px nav items, 36px table rows, 28px tree rows.
- Motion: `--ease-out: cubic-bezier(0.2, 0, 0, 1)`; 120ms hover/press, 160ms popovers,
  180ms dialogs and sheets. All disabled under `prefers-reduced-motion`.
- Layout: sidebar 248px (≥1280), 56px icon rail (768-1279, with a status dot on spaces that
  need sync), drawer (<768). Tree pane 264px from 1024 up; below that it opens as a left sheet.
- Buttons: `default` (ink-blue), `outline`, `ghost`, `danger` (solid, confirmations only).

### Copy decisions

| Concept | UI label | Secondary / tooltip |
|---|---|---|
| commit + push (direct) | Save & sync | "Commits to main and pushes to GitHub" |
| branch + PR | Propose change | "Opens a review on GitHub. Nothing changes until it's approved." |
| commit message | Describe your change | |
| `behind` | N updates to pull | "GitHub has N newer changes" |
| `ahead` / `local-changes` | Local changes not pushed | |
| `diverged` | Conflict needs attention | |
| `no-remote` | Not connected to GitHub | |
| admin / write / read | Admin / Can edit / Can view | "GitHub: admin / write / read" |

### Interaction decisions

- Edit is a mode of the file pane, not a route. Split view by default at ≥1280, Write below.
- Conflict (409): a dialog shows only the changed lines (unchanged runs collapse) with three
  ways out: Keep mine and save (re-saves on top of theirs), Start from theirs, Copy my text.
- Unsaved-changes guard: in-app links and tree clicks ask first; reload/close uses the
  browser prompt. ⌘S saves.
- Locked or view-only files show a full-width note above the content, never a truncated chip.
  "Suggest a change" opens a prefilled GitHub issue on the space's repo.
- Sync status button opens a popover with plain-language state, recovery steps for conflicts,
  the repo in mono, and Sync now with progress and inline outcome (plus a toast).
- Review-required spaces: the primary button reads "Propose change"; after proposing, the
  reader shows "You proposed a change… waiting for review" with the PR link, because main
  doesn't change until approval.
- People matrix: role pills are static (no per-cell tab stops); the person drawer holds the
  controls, including "No access" (removes from the repo).

### Live API integration (observed against selfhub-api demo)

- Base URL: `NEXT_PUBLIC_SELFHUB_API_URL` (default `http://localhost:8788`), reached through a
  Next rewrite at `/selfhub-api/*`. 8787 belongs to AgentGrid.
- The http adapter normalizes: `lastCommit`/`commit.author` objects (strings tolerated),
  `lastCommit: null`, member mutations returning the full list (written straight to the
  cache), and `/api/people` spaces (`{id,name,kind}`, joined with `/api/spaces`).
- Copy follows the API: locked files show its `reason` verbatim ("Locked. Only Maya Chen or
  Marcus Bell can change it, through a reviewed pull request."); activity summaries are full
  sentences, rendered without repeating the actor's name.
- Date-only values (rule `proposedAt`, `approvedAt`, `rejectedAt`) render as today / yesterday /
  "Oct 11", never with a time.
- 422 `no-change` is an info toast ("No changes to save"). 409 `via-team` grants show the team
  and no control. `prUrl: null` hides "Open review"; the toast names the review branch instead.
- Rule approval in a review-required space keeps `status: pending`; the toast says it went for
  review and shows the API's `message`.
- 403 `no-access` from any content endpoint renders the no-access state, not an error.
- Members tab: no share controls for personal or local-only spaces (the API answers `no-repo`).
- Pages that show names, counts or space titles wait for `/api/spaces` and `/api/people`
  (`GET /api/spaces` takes ~1.3s in demo), so raw logins and ids never flash.

### API assumptions (not in the contract)

- `GET` connectable repos for the Connect picker: mock only. The http adapter returns `[]`
  and the dialog falls back to the URL field.
- Rename = `POST /files` + `DELETE /file` with one message. Disabled in pull-request spaces.
- Demo user switching sends `X-SelfHub-User: sam-okafor | maya-chen` in http mode, per
  `docs/dashboard-api-contract.md`.
- Member changes that a GitHub team controls return 409 (`via-team` in the backend contract,
  `managed-by-team` in the mock); the UI shows the message, not the code.
- No endpoint resolves a diverged branch; the UI explains steps instead.

### Polish pass decisions (final)

- **Terminology.** "Propose change" = a pull request. "Ask <name> for a change" = a GitHub
  issue (secondary line "Opens a GitHub issue"). Access terms everywhere: Admin / Can edit /
  Can view / No access. Space `owners` are shown as **Approvers** ("Approves rules and locked
  files"), with full names.
- **Status never by colour alone.** Sidebar and rail use 12px icons (check, arrow-down,
  arrow-up, triangle, cloud-off, lock); the 1024 rail shows 2-letter monograms with a status
  badge, and the name appears on focus as well as hover.
- **Rules badge** counts only rules the current user can act on; actionable rules sort first;
  "Waiting for you" filter on the Pending tab.
- **Conflicts.** The sync popover leads with "Open <file>" (opens the editor via `?edit=1`),
  names the other person, offers "Open on GitHub" to admins, and demotes Sync to "Try again".
  Home shows "Resolve".
- **Sync outcome is shown once:** inline in the open popover (always-mounted live region), or
  as a toast when the popover is closed. Sync now is an outline button when already synced.
- **Destructive access changes confirm first** (drawer "No access" uses the same dialog as
  Members), and role changes and removals offer Undo in the toast. Toasts sit above sheets and
  dialogs and stay clickable.
- **Layout.** One container for every route: left-aligned, shared gutter (`px-5 md:px-8`),
  max-width 1120px, including the space header and tabs. No-access spaces live in a collapsed
  "Other spaces in <org>" row on Home.
- **File toolbar.** Edit is the only visible action; file history is in the ••• menu
  ("History of this file"). The access line reads "This file is locked" on locked files.
- **Touch.** Interactive controls are 40px tall below `md`.
- **Tokens.** `--danger-foreground` (near-black in dark mode) for danger buttons; toasts use
  `--color-popover`/`--color-border` aliases with the float shadow.

### Independent QA round (final decisions)

- **Conflict dialog.** The default, focused action is the safe one: "See what <name> changed"
  (diff of theirs vs your draft: + their lines, − lines only you have). "Replace <name>'s
  changes with mine" is a secondary danger outline button; "Discard my edits" stays. No SHAs.
- **Behind notice.** Editing in a space that's behind shows "<Name> made N changes since you
  last synced" (from `sync.incomingBy`) with Get latest, before you type.
- **Unsaved edits on this computer** (`sync.state = local-changes`): the sync popover and a Home
  dialog list `sync.changes` (each linked) and offer "Save these changes" with an optional
  description, which calls `POST /save-local`. Sync never claims "up to date" while edits remain.
- **Saves that brought in updates** say so: "Saved. Also brought in 2 changes from Jordan."
- **Plain copy rule.** The UI never shows git words, rule ids, `[SelfHub]` or raw logins; it
  maps known states to its own sentences and cleans API text defensively (`lib/plain.ts`).
- **Focus.** Overlays return focus to what opened them (⌘K, person drawer, confirms); confirms
  open on the dialog itself, after the select closes, so one keypress can't confirm or cancel.
  After ⌘S, focus goes to Edit. The reader's scroll area is a labelled, focusable region.
- **Files.** System files (`TreeEntry.system` / dot-folders) are hidden unless an admin turns
  them on. CSV renders as a table, other non-markdown as plain text (`File.format`). Renames
  use `POST /move` (one change). Names with `? # % \ : * " < > |` or spaces are refused.
- **Danger buttons** are a deeper red (`--danger-solid`) with white text in both themes
  (5.8:1 light, 6.1:1 dark).
- **Layout.** Scroll containers are `position: relative`, so screen-reader text inside them
  can't widen the page (the cause of the 390 People overflow). Below `sm`, member names get
  the full row and controls drop underneath.
- **Monograms.** One-word names use the start of their last part ("Northline" → NL).

### Final fix round: glossary and editor safety (final)

- **Glossary.** Incoming work is "changes" ("2 changes to get", "Got the latest changes"). The
  action is "Sync now" everywhere (⌘K: "Get teammates' changes and send yours"). An editor draft
  is "Unsaved changes"; files changed on this computer but not on GitHub are "Not on GitHub yet"
  (button: "Save these changes"). No "repo" except "GitHub repository" in the Add space connect
  step. Role options describe what you can do (Admin: "Can edit files and manage who has
  access." … No access: "Can't open this space."); the only GitHub role mapping is one help line
  in space settings. Names, not @logins, wherever a name exists.
- **The editor owns its draft.** It's keyed by file path, not version, so refetches and syncs
  never remount it. Sync now while editing: no edits → move to the latest version; edits and
  the file didn't change → keep them, still unsaved; edits and the file changed → keep them and
  show "<Name> also changed this file. When you save, you'll choose what to keep." Reassuring
  toasts only say what's true.
- **Rail monograms** use foreground text (≥4.5:1 in every state); the kind colour is on the tile
  tint and ring. Decorative marks (monograms, org mark, avatar initials) are drawn with CSS so
  they don't distort buttons' accessible names.
- **Tools.** `qa/tools/axe.mjs` (axe at 1024, light/dark) and `qa/tools/copy.mjs` (rendered-copy
  glossary grep) run against any base URL.
