# SelfHub dashboard API contract

The HTTP API the dashboard (`dashboard/`) talks to. Served by `packages/selfhub-api`.

```bash
SELFHUB_DEMO=1 uv run selfhub-api          # demo: seeded Northline company, http://localhost:8787
uv run selfhub-api                         # local: your spaces, roles from GitHub via `gh`
```

## Conventions

- Base URL `http://localhost:8787`. Every route starts with `/api`. CORS allows
  `http://localhost:3000` (override with `SELFHUB_CORS_ORIGINS=a,b`).
- JSON keys are camelCase, in requests and responses.
- Timestamps are ISO 8601 in UTC (`2026-10-10T22:57:45+00:00`). Rule dates are ISO dates
  (`2026-10-11`), because rule files only record the day.
- Space ids are slugs of the space name (`apex-roofing`). The personal space is always `me`.
- File paths are relative to the space root, with no leading slash (`sops/facebook-ads.md`).
- Fields marked *(extra)* are additions beyond the original contract. They are safe to
  ignore.

### QA round 2 additions (all additive, back-compatible)

Everything below is new. Old fields keep their names and types. Section by section:

- **Glossary (wording round 3).** Incoming work from GitHub is "changes", never "updates"
  ("GitHub has 2 newer changes from Jordan Reyes. Sync now to get them.", "Got 2 changes from
  Jordan Reyes first."). Files edited on this computer are "not on GitHub yet" ("1 file on
  this computer isn't on GitHub yet. Save it to send it."). "Unsaved" means editor drafts
  only, and the API never uses it. Messages never say "repo", never use `@login` (display
  names only), and never describe roles as GitHub read/write. A `403 forbidden` on a member
  change has the hint "Ask Jordan Reyes to add someone." Saves the API commits with no
  message are titled "Edit <path>" (was "Update <path>").
- **Wording.** Every sentence the API sends (`message`, `hint`, `summary`, `reason`) is plain
  language. No git words (commit, push, pull, clone, branch, remote, HEAD, pull request), no
  rule ids, no `[SelfHub]`, display names instead of logins, and roles as
  *Can view* / *Can edit* / *Admin*. Ids stay in their own fields. Show these strings as-is.
- **`Space.sync`** gains:
  - `changedPaths: string[]`: files edited on this computer and not saved yet. `[]` when
    there are none.
  - `changes: {path, status}[]`: the same files, with `status` `added` | `modified` |
    `deleted`.
  - `incomingBy: string[]`: display names of the people whose changes are on GitHub but not
    here yet (when `behind > 0`), newest first, no repeats.
  - `conflict: {path, byName, byLogin} | null`: a file edited here (saved or not) that someone
    else also changed on GitHub. `byName`/`byLogin` made the newest of those changes. Only
    the first such file. `null` when there is none.
- **`POST /api/spaces/{id}/sync`** (`SyncResult`):
  - It never says `up-to-date` while files on this computer aren't on GitHub yet. It still gets and sends
    whatever it can, then returns `result: "local-changes"` and the counts.
  - `result` can also be `local-changes` | `saved` | `pull-request` (the last two only from
    `save-local`).
  - New field `pulledBy: string[]`: display names behind the changes it got.
- **New: `POST /api/spaces/{id}/save-local`**. Body `{ "message"?: string }`. Needs *Can edit*
  or *Admin*.
  - It saves exactly the files in `sync.changedPaths` as one change. Then it gets new changes
    and sends to GitHub like a normal save, honouring the write policy (`pull-request`
    spaces send it for review).
  - Returns a `SyncResult` plus `saved: string[]` (the paths), `outcome`
    (`committed` | `pull-request`), `commit`, `branch` and `prUrl`.
  - `result` is `pushed` (on GitHub), `saved` (only on this computer: no remote, or sending
    failed), or `pull-request`.
  - Errors:
    - `422 no-change`: nothing to save.
    - `403 locked`: one of the files is locked for you; `message` names it, and
      `error.details.path` is that file.
    - `403 read-only` / `403 no-access`: as for a normal save.
- **File saves** (`PUT /file`, `POST /files`, `DELETE /file`, `POST /move`) add:
  - `pulled: number` and `pulledBy: string[]`: changes from GitHub fetched before saving.
  - `space: Space`, after the save.
  - A save that gets or sends anything updates `sync.lastSyncAt`. So does a `409 conflict`,
    which may already have fetched changes.
- **Errors** may carry `error.details` (an object, or absent):
  - `409 conflict`: `{ path, byName, byLogin }`, the person who saved the newer version.
  - `403 locked` from `save-local`: `{ path }`.
- **New: `POST /api/spaces/{id}/move`**. Body `{ "from", "to", "message"? }`. A rename or move
  as one change: one history entry and one activity item. Same refusals as a save, checked
  on both paths. Response is the same as `PUT /file`, with `file` at the new path.
  `409 exists` if `to` exists.
- **Paths:** names containing `? * : < > | " \` or control characters, or ending in a space
  or a dot, get `400 invalid-path`.
- **`TreeEntry.system: true`** on `.selfhub/…`, `.github/…` and other dot-folders, so the UI can
  hide them by default. Absent otherwise.
- **`File.format`**: `markdown` | `csv` | `json` | `text` | `binary`, from the file
  extension (`binary` when it isn't UTF-8).
- **`Commit`** (history, `lastCommit`, write responses):
  - `message` is display text, without `[SelfHub]` or rule ids. Rule changes read like
    "Approved a rule: No urgency phrasing for Apex".
  - `rawMessage`: the original message.
  - `ruleId`: present when the change was about a rule.
- **`Activity`**:
  - `summary` is plain, e.g. "Jordan Reyes made 2 changes in Ads Team", "Maya Chen approved
    a rule for Apex Roofing: No urgency phrasing for Apex", "Maya Chen gave Leo Park Can
    view access to Northline".
  - `ruleId` is present on rule items.
  - Renames and deletes say so.
- **`Diff`** gains `files: [{ path, oldPath, status, lines: [{ type, text, oldLine, newLine }] }]`.
  - `status`: `added` | `modified` | `deleted` | `renamed`.
  - `type`: `hunk` | `add` | `del` | `context`.
  - Git headers (`diff --git`, `index`, `mode`, `---`/`+++`) are already removed, and `text`
    has no leading `+`/`-`/space. `patch` is unchanged.
- **`SearchHit.snippet`** is plain text: markdown syntax and rule ids are stripped.
- **`Member.pending`** *(demo)*: `true` for someone invited who hasn't accepted. It is always
  `false` in local mode.
- **Rule reject** takes an optional body `{ "reason": string }`. A rejected `Rule` has
  `rejectReason` (string or `null`).
- **`POST /api/spaces` create (demo)**: the new space gets a remote, and its first version
  is sent at once. It starts as `synced`, not `no-remote`.
- **`POST /api/spaces` connect**: a folder that isn't a space returns `400 not-a-space`. A
  path that doesn't exist returns `400 not-found`. Messages and hints never contain
  terminal commands.

### Acting user

- **Local mode:** the user is whoever `gh auth status` says.
- **Demo mode:** the user is Sam (`sam-okafor`). Send `X-SelfHub-User: <login>` to act as
  someone else, e.g. `maya-chen` for an admin view. The header is ignored outside demo mode.
  An unknown login returns `400 unknown-user`.

### Errors

Every error has the same shape:

```json
{ "error": { "code": "locked", "message": "locked/compliance.md is locked in Northline. Only Maya Chen or Marcus Bell can change it. Nothing was saved.", "hint": "Ask them to make the change." } }
```

`hint` may be `null`. The `message` is written for people, so show it as-is. `details`
*(extra)* is present on some errors: `409 conflict` → `{path, byName, byLogin}`; `403 locked`
from `save-local` → `{path}`; `500 git` and `502 github` → `{technical}` (raw tool output, for
bug reports; don't show it as the message).

| Status | code | When |
|---|---|---|
| 400 | `not-a-space` | Connect: the folder has no SelfHub space files |
| 400 | `invalid-request`, `invalid-path`, `invalid-sha`, `invalid-role`, `invalid-kind`, `invalid-write-policy`, `invalid-status`, `invalid-name`, `invalid-source`, `unknown-user`, `personal`, `no-repo`, `create-failed`, `connect-failed`, `remove-failed` | Bad input |
| 403 | `locked` | Path is locked in that space (refused for everyone, admins too) |
| 403 | `read-only` | The space's write policy is read-only, or you only have read access |
| 403 | `no-access` | You have no access to that space |
| 403 | `forbidden` | Member changes without admin; rule approval without owner/admin |
| 404 | `not-found` | Unknown space, file, commit or rule |
| 409 | `conflict` | `baseSha` is stale: the file changed since you loaded it |
| 409 | `exists` | Creating a file or space that already exists |
| 409 | `via-team`, `already-member`, `not-member` | Member change GitHub would not allow as asked |
| 422 | `no-change` | Saving identical content |
| 500 | `git` | Git failed. `message` has git's output |
| 502/503 | `github`, `gh-missing` | Local mode only: `gh` failed or isn't installed |

## Who

### `GET /api/me`

```json
{
  "login": "sam-okafor",
  "name": "Sam Okafor",
  "avatarUrl": "http://localhost:8787/api/avatars/sam-okafor.svg",
  "title": "Paid Social Specialist",
  "mode": "demo",
  "org": { "name": "Northline", "avatarUrl": "http://localhost:8787/api/avatars/northline-demo.svg" }
}
```

`title` *(extra)* is `null` in local mode.

### `GET /api/people`

Everyone in the org, the shared spaces, and each person's role per space. Personal spaces
are not included.

```json
{
  "people": [
    { "login": "maya-chen", "name": "Maya Chen", "avatarUrl": "http://localhost:8787/api/avatars/maya-chen.svg", "title": "Founder & Managing Director" },
    { "login": "leo-park", "name": "Leo Park", "avatarUrl": "http://localhost:8787/api/avatars/leo-park.svg", "title": "Junior Ads Coordinator (new hire)" }
  ],
  "spaces": [
    { "id": "northline", "name": "Northline", "kind": "org", "myAccess": "read", "owners": ["maya-chen", "marcus-bell"] },
    { "id": "ads-team", "name": "Ads Team", "kind": "team", "myAccess": "write", "owners": ["jordan-reyes"] },
    { "id": "apex-roofing", "name": "Apex Roofing", "kind": "client", "myAccess": "write", "owners": ["jordan-reyes", "priya-nair"] },
    { "id": "bolt-hvac", "name": "Bolt HVAC", "kind": "client", "myAccess": "none", "owners": ["priya-nair"] }
  ],
  "access": {
    "maya-chen": { "northline": "admin", "ads-team": "admin", "apex-roofing": "admin", "bolt-hvac": "admin" },
    "leo-park": { "northline": "read", "ads-team": "read", "apex-roofing": "none", "bolt-hvac": "none" }
  }
}
```

Each `spaces[]` entry also carries `myAccess` and `owners` *(extra, additive)*: the same
values as that space's `Space.myAccess` and `Space.owners`. `access[<viewer>][<id>]`
always equals `myAccess`, and `access` is the same for every viewer.

### `GET /api/avatars/{login}.svg` *(extra)*

An initials avatar, generated locally. Demo `avatarUrl`s point here, so the demo needs no
network. In local mode, `avatarUrl`s are GitHub's.

## Spaces

### `GET /api/spaces` → `Space[]`

Spaces you have no access to are still listed, with `myAccess: "none"`. Their contents
return `403 no-access`. Another person's personal space is never listed.

```json
[
  {
    "id": "ads-team",
    "name": "Ads Team",
    "kind": "team",
    "description": "Paid social and paid search SOPs, templates and naming conventions.",
    "repo": { "owner": "northline-demo", "name": "ads-team", "url": "https://github.com/northline-demo/ads-team" },
    "writePolicy": "direct",
    "defaultBranch": "main",
    "sync": {
      "state": "behind",
      "ahead": 0,
      "behind": 2,
      "lastSyncAt": "2026-10-09T22:57:45+00:00",
      "message": "GitHub has 2 newer changes from Jordan Reyes. Sync now to get them.",
      "changedPaths": [],
      "changes": [],
      "incomingBy": ["Jordan Reyes"],
      "conflict": null
    },
    "myAccess": "write",
    "owners": ["jordan-reyes"],
    "lockedPaths": [".selfhub/space.json", ".github/CODEOWNERS"],
    "fileCount": 10,
    "memberCount": 6,
    "updatedAt": "2026-10-09T22:57:45+00:00"
  }
]
```

- `kind`: `org` | `team` | `client` | `personal`.
- `repo`: `null` when the space isn't on GitHub (always for `me`).
- `sync.state`:

  | state | Meaning |
  |---|---|
  | `synced` | Same as the remote |
  | `ahead` | Local commits not pushed. Also used for "never pushed" (`message` says so) |
  | `behind` | Remote has commits not pulled (as of the last fetch) |
  | `diverged` | Both |
  | `local-changes` | Files on this computer that aren't on GitHub yet (`changedPaths`); save them with `save-local` |
  | `no-remote` | No remote configured |
  | `error` | Couldn't read git state; see `message` |

  `lastSyncAt` is when the dashboard last synced the space, or `null` if it never has.
- `owners`: logins. Team handles in the manifest (`@org/admins`) are expanded to members.
- `lockedPaths`: manifest locks plus the two files that are always locked.

### `GET /api/spaces/{id}` *(extra)* → `Space`

### `POST /api/spaces` → `201 Space`

Create a new space (a local git repo under `<config dir>/spaces/<id>`):

```json
{ "action": "create", "name": "Summit Solar", "kind": "client", "description": "Boulder solar installer.", "owners": ["priya-nair"], "writePolicy": "direct" }
```

`owners` defaults to you. `writePolicy` defaults by kind: org → `pull-request`, otherwise
`direct`. It doesn't create a GitHub repo. In demo mode the fake org gets a matching repo
with you as admin.

Connect an existing space (a git URL to clone, or a local path):

```json
{ "action": "connect", "source": "git@github.com:northline/client-apex.git", "name": "Apex Roofing" }
```

In demo mode a connected space also gets a repo in the fake org (unless its remote already
names one), with the person who connected it as admin and the `admins` team as admin. So
every viewer sees the same members and roles for it.

`GET /api/spaces` caches each clone's git state (status, newest commit, file count) for
3 seconds. Every write through the API clears that space's entry, so your own changes show
at once; edits made outside the API can take up to 3 seconds to appear.

### `DELETE /api/spaces/{id}`

Disconnects the space. Its files stay on disk. You can't disconnect `me`.

```json
{ "removed": "summit-solar", "path": "/…/spaces/summit-solar", "message": "Disconnected 'Summit Solar'. Its files were left where they are." }
```

### `POST /api/spaces/{id}/sync`

Fetches, then pulls (rebase) and pushes as needed. A space with no upstream gets pushed
and its upstream set.

```json
{
  "space": { "...": "Space, after the sync" },
  "result": "pulled",
  "message": "Got 2 changes from Jordan Reyes.",
  "pulled": 2,
  "pushed": 0,
  "pulledBy": ["Jordan Reyes"]
}
```

`result`: `up-to-date` | `pulled` | `pushed` | `local-changes` | `conflict` | `error`. When it
both pulls and pushes, `result` is `pushed` and both counts are set. On `conflict` the rebase
is aborted and nothing changes. If files on this computer still aren't on GitHub afterwards, `result` is
`local-changes` (never `up-to-date`), with the counts of whatever was got or sent.
`lastSyncAt` updates on every sync that reached GitHub.

### `POST /api/spaces/{id}/save-local` *(new)*

Saves every file in `sync.changedPaths` as one change, then gets new changes and sends it like
a normal save. Body `{ "message"?: string }` (default "Save N changes made on this computer").

```json
{
  "space": { "...": "Space, after saving" },
  "result": "pushed",
  "message": "Saved 1 change and sent it to GitHub.",
  "pulled": 0, "pushed": 1, "pulledBy": [],
  "saved": ["past-ads/2026-09-fall-inspection.md"],
  "outcome": "committed",
  "commit": { "...": "Commit" },
  "branch": "main",
  "prUrl": null
}
```

`result`: `pushed` | `saved` (only on this computer) | `pull-request`. Errors: `422 no-change`,
`403 locked` (names the file, `details.path`), `403 read-only`, `403 no-access`,
`409 conflict` (overlaps with newer changes on GitHub; nothing saved).

## Files

### `GET /api/spaces/{id}/tree` → `TreeEntry[]`

Every file and folder except `.git`, non-markdown files included. Flat list in
depth-first order, folders first.

```json
[
  { "path": ".selfhub/space.json", "name": "space.json", "type": "file", "locked": true, "editable": false,
    "reason": "Locked. Only Jordan Reyes or Priya Nair can change this file. Ask them to make the change.",
    "system": true, "size": 268, "updatedAt": "2026-07-09T23:02:57+00:00", "updatedBy": "priya-nair" },
  { "path": "past-ads", "name": "past-ads", "type": "dir", "locked": false, "editable": true,
    "updatedAt": "2026-09-30T23:02:57+00:00", "updatedBy": "sam-okafor" },
  { "path": "past-ads/2026-04-spring-hail.md", "name": "2026-04-spring-hail.md", "type": "file",
    "locked": false, "editable": true, "size": 679, "updatedAt": "2026-08-13T23:02:57+00:00", "updatedBy": "sam-okafor" }
]
```

- `reason` is present only when `editable` is false: locked, read-only space, read
  access only, or no access. A lock reason never names the person asking.
- `owned: true` marks a locked path the person asking owns, so it's editable for them.
  Owners are the space's owners (CODEOWNERS, directly or through a team) and whoever
  created the space, matched on GitHub login, name or email, ignoring case and `@`. For
  a space only on this computer, this computer's git name and email count too.
- A folder's `updatedAt`/`updatedBy` come from its most recently changed file.
- Uncommitted or untracked files have no `updatedAt`.

### `GET /api/spaces/{id}/file?path=` → `File`

```json
{
  "path": "locked/compliance.md",
  "content": "# Advertising compliance\n\n…",
  "locked": true,
  "editable": false,
  "reason": "Locked. Only Maya Chen or Marcus Bell can change this file. Ask them to make the change.",
  "format": "markdown",
  "sha": "f6b089e407afb59efcf2c525acdc48db3b2b62ee",
  "lastCommit": {
    "sha": "62e1e8cb4703c2d2cfaa022727d623f184862031",
    "author": { "login": "maya-chen", "name": "Maya Chen", "avatarUrl": "http://localhost:8787/api/avatars/maya-chen.svg" },
    "date": "2026-06-16T22:57:45+00:00",
    "message": "Add advertising compliance rules",
    "rawMessage": "Add advertising compliance rules"
  }
}
```

- `sha` is the git blob id of the content on disk. Send it back as `baseSha` when saving.
- `lastCommit.author` is an object, the same shape as in history. `lastCommit` is `null`
  for a file never committed.
- `binary: true` *(extra)* appears for non-UTF-8 files; `content` is then `""` and the file
  isn't editable.
- For a locked file you own: `owned: true`, `saveMode` (`"direct"` when the space is only
  on this computer, `"review"` when it's connected to GitHub) and `note`, a quiet line
  for the reader, e.g. "You own this file. Changes are saved straight away because this
  space is only on this computer."

### `PUT /api/spaces/{id}/file`

```json
{ "path": "sops/reporting.md", "content": "# Monthly reporting SOP\n…", "message": "Reporting SOP: add draft deadline", "baseSha": "5d3ffab7a316eaf9e511367073b32d7bb379ecd1" }
```

`baseSha` is optional, but send it: without it, nothing protects against overwriting
someone else's change.

What happens on save:

1. Access check (`no-access`, `read-only`), then the space's own refusal for locked paths
   and read-only spaces (`locked`, `read-only`). Locked paths are refused for everyone
   except the space's owners (see `owned` above), admins included.
2. Pull first if the space is behind.
3. `baseSha` is compared with the file now on disk. If it differs: `409 conflict`.
4. Only this path is staged and committed. Other uncommitted work in the clone is left
   alone.
5. `direct` spaces commit to the default branch and push. `pull-request` spaces commit on a
   new `selfhub/…` branch, push it, open a PR when `gh` can, and leave the default branch
   unchanged. An owner's change to a locked path ignores the policy: in a space connected
   to GitHub it always goes the `pull-request` way; in a space only on this computer it
   is committed straight away.

Response:

```json
{
  "outcome": "pull-request",
  "commit": {
    "sha": "ec908823a3144fd6e2145095a41e881e1f138794",
    "author": { "login": "maya-chen", "name": "Maya Chen", "avatarUrl": "http://localhost:8787/api/avatars/maya-chen.svg" },
    "date": "2026-10-12T22:58:54+00:00",
    "message": "Reporting SOP: add draft deadline"
  },
  "prUrl": null,
  "branch": "selfhub/reporting-sop-add-draft-deadline-20261012-225854",
  "message": "Sent for review. It becomes part of Northline once Maya Chen or Marcus Bell approves it.",
  "pulled": 0,
  "pulledBy": [],
  "space": { "...": "Space, after the save" },
  "file": { "...": "File, as it is now on the default branch" }
}
```

- `outcome`: `committed` | `pull-request`.
- `prUrl` is set only when a PR was really opened (local mode, GitHub remote, `gh` signed
  in). It's always `null` in the demo.
- `branch` *(extra)*: where the commit landed. `message` *(extra)*: human note (PR status,
  push failures).
- For `pull-request`, `file` is still the unchanged default-branch version.

Errors: `403 locked | read-only | no-access`, `404 not-found`, `409 conflict`,
`422 no-change`.

### `POST /api/spaces/{id}/files` → `201`

```json
{ "path": "work/2026-10-12-winter-prep.md", "content": "# Winter prep ad — draft\n", "message": "Draft winter prep ad" }
```

Same response and rules as `PUT`. `409 exists` if the path exists. Missing folders are
created.

### `DELETE /api/spaces/{id}/file?path=&message=`

Same response as `PUT`, without `file`. Same refusals.

### `GET /api/spaces/{id}/history?path=&limit=` → `Commit[]`

Newest first. `path` is optional (omit it for the whole space). `limit` defaults to 50
(max 500). Covers the default branch only.

```json
[
  {
    "sha": "f1ee1412f1df744916d04f0afd20c37b67f8b6bb",
    "author": { "login": "priya-nair", "name": "Priya Nair", "avatarUrl": "http://localhost:8787/api/avatars/priya-nair.svg" },
    "date": "2026-09-28T22:58:51+00:00",
    "message": "Offers: add fall $500 off replacement through Nov 30",
    "additions": 1,
    "deletions": 0
  }
]
```

### `GET /api/spaces/{id}/diff?sha=&path=`

```json
{ "sha": "f1ee1412f1df744916d04f0afd20c37b67f8b6bb", "path": "offers.md", "patch": "diff --git a/offers.md b/offers.md\n…\n+| Fall replacement | $500 off … |\n" }
```

`path` *(extra in the response)* is optional; without it the patch covers the whole commit.

### `GET /api/search?q=&space=` → `SearchHit[]`

Searches markdown files in every space you can read, or only `space`. Best first. Up to
`limit` (default 30) hits.

```json
[
  {
    "spaceId": "northline",
    "path": "locked/compliance.md",
    "title": "Advertising compliance",
    "snippet": "- Every financing mention needs the lender's disclaimer in the ad or the first screen of the landing page: …",
    "score": 0.8
  }
]
```

`title` is the file's first `# ` heading, or its name.

## Members and access

### `GET /api/spaces/{id}/members` → `Member[]`

```json
[
  { "login": "jordan-reyes", "name": "Jordan Reyes", "avatarUrl": "…", "role": "admin", "via": "team", "team": "Strategy", "isOwner": true },
  { "login": "sam-okafor", "name": "Sam Okafor", "avatarUrl": "…", "role": "write", "via": "team", "team": "Ads", "isOwner": false },
  { "login": "tess-alvarez", "name": "Tess Alvarez", "avatarUrl": "…", "role": "read", "via": "direct", "team": null, "isOwner": false }
]
```

Roles: GitHub's `maintain` shows as `admin`, and `triage` as `read`. A person with both a
team grant and a direct grant gets the higher role.

### Changing access (admins of that space only, else `403 forbidden`)

| Request | Body | Response |
|---|---|---|
| `POST /api/spaces/{id}/members` | `{ "login": "leo-park", "role": "read" }` | `201 Member[]` (updated list) |
| `PUT /api/spaces/{id}/members/{login}` | `{ "role": "write" }` | `200 Member[]` |
| `DELETE /api/spaces/{id}/members/{login}` | none | `200 Member[]` |

- Access that comes from a team can't be removed or lowered per person. That returns
  `409 via-team`, with a hint to change the team on GitHub. This matches GitHub.
- `409 already-member` when inviting someone who already has access. `404 not-member` when
  changing or removing someone who doesn't.
- `400 no-repo` when the space isn't on GitHub.
- In local mode these call `gh api` (PUT/DELETE on repo collaborators), and only when you
  send these requests.

## Rules

### `GET /api/rules?status=&space=` → `Rule[]`

`status`: `pending` | `active` | `rejected` (all three when omitted). Only spaces you can
read. Sorted by `proposedAt`, newest first.

```json
[
  {
    "id": "R-20261011-0e92",
    "spaceId": "apex-roofing",
    "title": "No urgency phrasing for Apex",
    "text": "Never use urgency phrasing (\"act now\", \"limited time\", \"before it's too late\") in Apex ads.",
    "why": "Jordan on the spring promo review: variant 2 was too pushy; Apex hates urgency.",
    "source": "work/2026-10-11-spring-promo.md",
    "proposedBy": "sam-okafor",
    "proposedAt": "2026-10-11",
    "status": "pending",
    "prUrl": null
  }
]
```

Approved rules also have `approvedBy` and `approvedAt` *(extra)*. Rejected rules have
`rejectedBy` and `rejectedAt` *(extra)*. `title` *(extra)* is the rule's short heading.
Pending = `rules/proposed.md`, active = `rules/learned.md`, rejected = `rules/rejected.md`
(new file, so a rejection and its reason stay in git).

### `POST /api/rules/{id}/approve` and `POST /api/rules/{id}/reject`

No body. Allowed for the space's owners (manifest `owners`, teams expanded) and its admins.
Others get `403 forbidden`, with the owners named in the message. Returns the `Rule` with
its new status, plus `commit` *(extra)*. In a `pull-request` space the change goes on a
branch for review, so `status` stays `pending` and `message` *(extra)* says where it went.

```json
{ "id": "R-20261011-0e92", "spaceId": "apex-roofing", "status": "active", "approvedBy": "jordan-reyes", "approvedAt": "2026-10-12", "commit": "1706a6928cb1586dc6947ac00d5a41637f02f44e", "...": "…" }
```

## Activity

### `GET /api/activity?limit=` → `Activity[]`

Commits from the default branch of every space you can read, plus dashboard events
(syncs, access changes, spaces created or connected, proposed PR changes). Newest first.
`limit` defaults to 30 (max 200).

```json
[
  { "id": "apex-roofing:1706a6928cb1", "type": "rule", "actor": "jordan-reyes", "spaceId": "apex-roofing",
    "summary": "Jordan Reyes approved a rule for Apex Roofing: No urgency phrasing for Apex", "ruleId": "R-20261011-0e92", "date": "2026-10-12T22:59:02+00:00", "sha": "1706a69…" },
  { "id": "evt_3f2a91c0", "type": "access", "actor": "maya-chen", "spaceId": "apex-roofing",
    "summary": "Maya Chen gave Leo Park Can view access to Apex Roofing", "date": "2026-10-12T22:59:01+00:00" },
  { "id": "ads-team:a24d680e1b2c", "type": "edit", "actor": "sam-okafor", "spaceId": "ads-team", "path": "templates/facebook-variants.md",
    "summary": "Sam Okafor edited facebook-variants.md in Ads Team: Simplify variant sheet", "date": "2026-10-12T22:58:59+00:00", "sha": "a24d680…" }
]
```

- `type`: `edit` | `sync` | `rule` | `access` | `space`.
- `path` appears when one file changed.
- `sha` *(extra)* appears on commit items; use it with `/diff`.

## Health

`GET /api/health` *(extra)* → `{ "ok": true, "mode": "demo", "configDir": "…" }`

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `SELFHUB_DEMO` | off | `1` = demo mode (seeds a new temp config dir unless one is given) |
| `SELFHUB_CONFIG_DIR` | demo: new temp dir; local: `~/.selfhub` (or `SELFHUB_CONFIG_HOME`) | Where `spaces.json`, `dashboard.json` and, in demo, the repos live |
| `SELFHUB_PERSONAL_PATH` | the CLI's `repo_path` setting, else `~/selfhub` | Personal space (local mode) |
| `SELFHUB_API_PORT` | `8787` | Port |
| `SELFHUB_API_URL` | `http://localhost:<port>` | Used to build demo avatar URLs |
| `SELFHUB_CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Allowed origins |
| `SELFHUB_GITHUB_ORG` | CLI `github_owner`, else the owner of the first GitHub remote | Org for people and teams (local mode) |
| `SELFHUB_DEMO_USER` | `sam-okafor` | Default demo user |
