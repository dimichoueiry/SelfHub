# SelfHub dashboard: independent QA report

Date: 2026-10-12. Reviewer: independent QA (fresh eyes, did not build it).

**What this is.** This is an expert review plus automated checks: Playwright driving real Chromium
against the live API, and axe-core. **It is not user testing and not a screen-reader test.** No real
business users were observed, and no screen reader (VoiceOver/NVDA) was run.
- **Observed** = I saw it happen in the running app, and there's a screenshot or log.
- **Assumed** = my inference, which I did not verify. These are marked "Assumed".

**Setup.** Worktree `feat-org-spaces`. `scripts/seed_demo.py` → `/tmp/selfhub-qa-*`; `selfhub-api` in demo
mode on :8788; http-mode production build (`NEXT_DIST_DIR=qa/independent/.next-build`) served by
`next start` on :3300. I restarted the API once from a fresh seed so I could retest Sync on a "behind"
space (see F-03). Scripts: `qa/independent/s*.mjs` (helper `lib.mjs`). Raw sweep data: `sweep.json`.
Screenshots: `qa/independent/shots/`. Viewport is 1440×900, light theme, unless stated otherwise.

Severity: **P0** blocks a task, causes an error, or is an a11y barrier. **P1** noticeable usability or
visual defect. **P2** polish.

| Severity | Count |
|---|---|
| P0 | 1 |
| P1 | 17 |
| P2 | 16 |

---

## 1. First-run comprehension (1440, light, Sam then Maya)

Observed: `shots/01-home-1440-light.png`, `shots/04-maya-home.png`, `shots/01-home-1440-light-t150.png`.

Ten-second test (expert judgement, not user testing):
- **Where am I?** Mostly clear. The org name sits top-left, Home is highlighted and the greeting is
  personal. The subtitle "Your client: Apex Roofing" is the weakest line. It reads like a form label and
  doesn't orient (F-10).
- **What spaces exist?** Clear. The sidebar groups them as Company / Teams / Clients / Personal, each with a
  status icon, and the cards repeat them with kind and access. Bolt HVAC shows "No access" in the sidebar
  and in a collapsed "Other spaces" row. That's good.
- **What needs me?** "Needs you" is first and visually strongest. That's correct. But its two items for Sam
  are written in git ("2 new commits on the remote", "Uncommitted changes in this clone"). One of them can
  never be cleared from the UI (F-01). Maya's version, with rules waiting first, works well.
- **What next?** Each Needs-you row has one button. That's good. Below the fold there's no "start here"
  path for a new person, such as "Read the handbook". Recent activity takes a third of the width and is
  full of IDs and raw logins (F-05). That pulls the eye from the more useful cards.
- **Hierarchy critique:** the order is right (needs → spaces → activity). Activity is visually too loud
  for its value. Consider a narrower or collapsible column, or move it below the spaces at ≤1280. The
  space cards repeat sync state that is already in the sidebar. That's fine, but the card footers
  ("11 files · 2 days ago") have no label for what "2 days ago" means.

---

## 2. Findings

### P0

#### F-01 · P0 · "Sync now" on a space with uncommitted local changes says "up to date" and changes nothing
- Observed (Sam and Maya): Home → Needs you → "Apex Roofing: local changes not pushed" → Sync now. The toast
  says "Apex Roofing is up to date. Nothing new on GitHub, nothing to send." The row, card and sidebar
  still say "Local changes not pushed". Retrying gives the same result. The API returns
  `result: up-to-date` with `sync.state: local-changes`.
- Nothing in the UI shows which files are uncommitted or lets you save them. The user is stuck with a
  permanent "Needs you" item and a message that contradicts it.
- Shots: `03-apex-home-after.png`, `03-apex-home-syncing.png`.
- Fix: never say "up to date" while the state is still `local-changes`. Say "Apex Roofing has edits on this
  computer that aren't saved to GitHub", list the files (the API needs to expose them), and offer "Save &
  sync these" / "Discard". Backend: sync should commit and push tracked changes, or return a distinct
  result.

### P1

#### F-02 · P1 (borderline P0) · The conflict dialog's primary button silently deletes a teammate's section
- Observed (Sam): Ads Team showed "2 updates to pull". Opened `sops/facebook-ads.md`. The reader shows the
  stale local copy, with no hint that it's out of date. Edit → add a line → Save & sync. That returned a 409
  and the dialog "Someone else changed this file". The diff shows that "Keep mine and save", the filled
  primary button, would remove Jordan's whole "## 8. Creative testing cadence" section.
- The dialog is otherwise well made: clear title, diff, three ways out. The problem is the default. A
  non-technical user clicks the blue button and erases a colleague's work. The dialog also shows a short
  SHA ("· b80b48a").
- Shot: `02-ads-fb-after-save.png`.
- Fix: make "Start from theirs" primary, or auto-merge when hunks don't overlap. Style "Keep mine" as an
  outline button labelled "Replace Jordan's changes". When a space is behind, warn on Edit ("2 updates to
  pull. Sync first.") or pull automatically. Drop the SHA.

#### F-03 · P1 · A 409 save silently pulls the space; status then reads "Synced · 3 days ago"
- Observed: after the 409 above (no button pressed, page reloaded), the API had pulled the 2 remote commits.
  Ads Team flipped to "Synced", its "Needs you" item disappeared, and the header said "Synced · 3 days
  ago" because `lastSyncAt` wasn't updated. The next save went through with no conflict.
- Shot: `02b-error.png`. The name is from my script; the screen itself is the normal reader showing
  "Synced · 3 days ago".
- Fix: update `lastSyncAt` on every pull. Tell the user when a save fetched updates ("Got 2 updates from
  Jordan first").

#### F-04 · P1 · Git jargon on primary surfaces
- Observed: Needs you shows "2 new commits on the remote. Sync to pull them." / "Uncommitted changes in this
  clone." / "Never pushed. 5 commits are only on this machine." The sync outcome says "Pulled 2 new
  commits." Activity says "pushed 1 commit" and "pulled 2 new commits". The locked note says "…through a
  reviewed pull request." The rename toast says "History stays with the old name".
- Shots: `01-home-1440-light.png`, `03-ads-syncing.png`, `02d-northline-locked.png`, `04-maya-home.png`.
- Fix: map API messages to plain copy on the client. For example: "GitHub has 2 newer updates", "Edits on
  this computer aren't on GitHub yet", "Got 2 updates", "Sent 1 change", "…through a reviewed change".

#### F-05 · P1 · Rule IDs, `[SelfHub]` prefixes and raw logins in Activity and History
- Observed: Activity shows "Sam proposed rule R-20261012-0e92 in Apex Roofing", "Maya rejected rule
  R-20261010-5bd6", "Maya gave leo-park read access to Northline" and "gave casey-lee read access". The
  space History list shows "[SelfHub] approve R-20260925-543f in Ads Team".
- Shots: `01-home-1440-light.png`, `09-home-1440-dark.png`, `09-history-1440-light.png`.
- Fix: show the rule text (truncated) with a link, map logins to names, and use "Can view" / "Can edit".
  Strip `[SelfHub]` and the rule ID from displayed commit messages.

#### F-06 · P1 · Inconsistent access terms ("read access", "write access")
- Observed (Sam, Northline view-only file): "You have read access to Northline. Ask Marcus Bell or Maya Chen
  for write access. Ask an admin of this space if you need to edit it." The chip right above says "Can
  view". The last sentence repeats the second. Activity also says "read access" and "write access".
- Shot: `02d-northline-viewonly.png`.
- Fix: "You can view Northline. To edit, ask Maya Chen or Marcus Bell for Can edit." Add "Ask for a change
  (opens a GitHub issue)" here as well, not only on locked files.

#### F-07 · P1 · System files are the first thing in every tree
- Observed: every space starts with `.github/CODEOWNERS` and `.selfhub/space.json`, both locked.
- Shot: `02-ads-fb-reading.png`.
- Fix: hide dot-folders by default, with an admin toggle "Show system files".

#### F-11 · P1 · The Connect error shows a CLI command and the wrong recovery advice
- Observed (Maya): Add space → Connect → `/tmp/selfhub-qa-extra/plain` (a folder that isn't a space). The
  alert says: "…has no .selfhub/space.json, so it is not a SelfHub space yet. Make it one with `selfhub space
  create … --kind org|team|client`. Try again in a moment. If it keeps happening, check that the SelfHub API
  is running."
- The second half is the generic network hint, and it's wrong for a validation error.
- Shot: `05-connect-plain-folder.png`.
- Fix: "This folder isn't a SelfHub space yet." with a button "Make it a space" that prefills Create. Show
  the API hint only on network or 5xx errors.

#### F-12 · P1 · "Create a new space" claims a GitHub repo that doesn't exist
- Observed: creating "Cedar Dental QA" shows "SelfHub created northline-demo/cedar-dental-qa with starter
  files." The new space then shows a repo link "(opens GitHub)" next to "Not connected to GitHub".
  Settings shows "GitHub repo: northline-demo/cedar-dental-qa" and "Sync: Not connected to GitHub".
  Removing it says "The GitHub repo itself was not deleted."
- Assumed: demo mode doesn't create a remote. Either way, the UI tells two different stories.
- Shots: `05-create-done.png`, `05-create-opened.png`, `05b-space-settings.png`.
- Fix: when `sync.state = no-remote`, say "Created on this computer. Connect it to GitHub to share it" and
  hide the repo link.

#### F-16 · P1 · Every rename shows a false error toast
- Observed twice (Sam, Ads Team): ••• → Rename or move → Rename. Two toasts appear at once: "Renamed to
  fb-variants.md · Synced to GitHub" and "templates/fb-variants.md isn't in Ads Team · It may have been
  renamed or deleted. Showing the space's main file." The pane actually shows the renamed file. The API
  log shows a 404 GET for the new path.
- Shots: `07b-renamed.png`, `07-rename-invalid.png`.
- Assumed cause: the reader fetches the new path before the cache knows about it.
- Fix: seed the cache, or await the tree refetch, before navigating. Suppress the missing-file toast for
  a path you just created.

#### F-19 · P1 · Keyboard: pressing Enter on "No access" in a role menu does nothing
- Observed (Maya, person drawer and Members tab): focus the role combobox → ArrowDown → End ("No access") →
  **Enter**. No confirm dialog appears and the role doesn't change. With **Space**, or with the mouse, the
  confirm appears and focus lands on Cancel. Members → "Remove Tess Alvarez" button + Enter works.
- Assumed cause: the Enter that selects the option also activates the newly focused Cancel button, so
  the dialog opens and is cancelled instantly. Observed in Playwright Chromium. I expect the same with a
  physical keyboard, but didn't check by hand.
- Shot: `11d-kbd-after-select.png`.
- Fix: open the confirm on the next tick after the select closes, or focus the dialog body rather than
  Cancel.

#### F-20 · P1 · Focus goes to `<body>` after overlays close and after saving
- Observed (keyboard): Escape on ⌘K (opened from the Search button) → body. Escape on the person drawer →
  body, not back on the "Leo Park" row. Escape on the remove-confirm dialog (drawer and Members) → body.
  ⌘S save → body, because the editor unmounts. The ••• menu, the sync popover and the user menu do return
  focus correctly.
- Fix: return focus to the trigger (Radix `onCloseAutoFocus`, or a stored ref). After saving, focus the
  Edit button or the reader heading.

#### F-21 · P1 · Tree: after opening a file with Enter, focus jumps to the row above
- Observed: in the tree, put focus on `campaign-naming.csv` and press Enter. The file opens and is
  selected, but the focus ring sits on `ad-brief.md`. Pressing Enter again opens the wrong file.
  Reproduced twice.
- Shot: `11b-tree-focus-after-open.png`.
- Fix: keep the roving tabindex on the selected item after the route change.

#### F-22 · P1 · People at 390: the whole page scrolls sideways, not just the matrix
- Observed (390, light and dark): `window.scrollX` reaches 330px. Panning moves the header and title off
  screen and shows blank page. The brief asks for the matrix to scroll inside a container with a sticky
  first column.
- Shots: `09-people-390-light.png`, `10-people-390-scrolledX.png`.
- Fix: wrap the table in `overflow-x-auto` with `min-w-0` on the parents.

#### F-23 · P1 · Members at 390: names truncated to "Jord…", "alex-ri…"
- Observed (390): the Approver badge and the role control squeeze the name column, so "Jordan Reyes" shows
  as "Jord…" and the secondary line is cut too.
- Shot: `09-members-390-dark.png`.
- Fix: stack the role control under the name below `sm`, and move the badge onto the second line.

#### F-24 · P1 · CSV files are rendered as markdown
- Observed: `templates/campaign-naming.csv` renders as one paragraph. Underscores and braces turn into
  italics ("{objective}" shows in italics) and an appended line becomes a bullet. The editor labels it
  "Content of campaign-naming.csv (markdown)".
- Shot: `11b-tree-focus-after-open.png` (right pane).
- Fix: render `.csv` as a table, or at least as monospace text. Label the editor by file type.

#### F-25 · P1 · History diff shows a raw, clipped git header
- Observed (Ads Team → History → "Delete fb-variants.md"): the first diff line reads "eleted file mode
  100644". That's a git header with its first character cut off.
- Shot: `09-history-1440-light.png`.
- Fix: strip `diff --git` / `index` / `mode` headers before rendering, and check the slicing offset.

#### F-26 · P1 · The file reader's scroll area isn't keyboard-focusable (axe: scrollable-region-focusable, serious)
- Observed (axe, all widths and themes): `section[aria-label="File"] > .overflow-y-auto` has no focusable
  content. A keyboard user on a long file with no links can't scroll the reader with arrow or page keys.
- Fix: give the scroll container `tabIndex={0}` and a label, or make the page itself scroll.

### P2

#### F-08 · P2 · The invite toast contradicts the list; an empty Invite gives no feedback
- Observed: inviting `casey-lee` shows the toast "@casey-lee can now view Apex Roofing. GitHub sends them an
  invite. Access shows up once they accept." The row appears straight away with a role, and no
  "Invited / pending" state. The name shows as the raw login. Clicking Invite with an empty field does
  nothing. Duplicates get a clear inline error: "@alex-rivera already has access. Change their role
  below." Enter in the field submits.
- Note: the invite works (API 201). My first scripted run looked like a failure. That was my locator (the
  role picker is a `combobox`) plus a toast that had expired before I read it. I re-checked with a slower,
  fine-grained capture.
- Shots: `04e-new-user.png`, `04e-duplicate.png`.
- Fix: label the row "Invited · waiting to accept", and disable Invite until the field has text.

#### F-09 · P2 · The sync popover keeps a filled "Sync now" after success
- Observed: the brief says the button becomes an outline once synced. Shot: `03-ads-syncing.png`.

#### F-10 · P2 · The Home subtitle "Your client: Apex Roofing" doesn't orient
- Fix: replace it with a summary ("1 thing needs you · 4 spaces"), or remove it.

#### F-13 · P2 · The Create form keeps a red border after the name is fixed
- Observed: after an empty submit, typing a name removes the message, but the red border stays until the
  next submit. Shot: `05-create-filled.png`. Fix: clear `aria-invalid` on change.

#### F-14 · P2 · Connect dialog: a dead "Repos you can access" box, and the title says GitHub though paths work
- Shot: `05-connect-form.png`. Fix: hide the list until it works, and label the field "GitHub link or
  folder on this computer".

#### F-15 · P2 · Space Settings exposes internals
- Observed: "These come from the space's manifest (.selfhub/space.json)". The locked-files list shows
  system files. Shot: `05b-space-settings.png`.

#### F-17 · P2 · Rename accepts "?" and spaces
- Observed: `templates/facebook variants?.md` was created. It opens and survives a reload. During the
  rename the app requested `path=…facebook+variants%3F.md` (space encoded as "+") and got a 404.
- Fix: validate names, and encode paths with `encodeURIComponent`.

#### F-18 · P2 · Rejecting a rule takes no reason and has no Undo
- Observed: this was the first live reject test, and it works. API 200, Pending 1→0, Rejected 0→1, and the
  card says "rejected by Maya today". But Maya can't say why, and nothing restores the rule. Approve has
  no Undo either.
- Shots: `06b-reject-confirm.png`, `06b-rejected-tab.png`.

#### F-27 · P2 · ⌘K snippets show raw markdown
- Observed: "| Channel | Spend | Leads | CPL |…|---|---|", "## R-20261012-0e92: …", "*why*".
- Shot: `08-cmdk-urgency.png`. Fix: strip markdown in snippets and highlight the match.

#### F-28 · P2 · axe label-content-name-mismatch (WCAG 2.5.3) on every page
- Observed: the sidebar Search button (aria-label "Search files, spaces and actions"; visible text "Search
  ⌘K"), the org switcher, the account menu, and the People row buttons ("Leo Park, open access
  details"). Voice-control users who say what they see may not hit these.
- Fix: start each aria-label with the visible text, or drop the aria-label and use `aria-describedby`.

#### F-29 · P2 · Contrast 4.42:1 for diff line numbers on red rows (light)
- Observed: axe `color-contrast` on History, `#726e6b` on `#faedec`. Fix: use `--muted-foreground` for line
  numbers.

#### F-30 · P2 · Tap targets under 40px at 390
- Observed: Rules tabs are 28px tall, space tabs (Files / History / Members / Settings) are 36px, the repo
  link under the space name is 16px, and the People matrix column headers are 16px. The brief says 40px
  below `md`.
- Shots: `09-rules-390-light.png`, `09-file-390-light.png`.

#### F-31 · P2 · The 1024 rail shows "No" as Northline's monogram
- Observed: next to the "BH" and "CD" lock badges, "No" reads as "no access". Shot: `09-file-1024-dark.png`.
- Fix: use "NL" or the kind glyph.

#### F-32 · P2 · A rename shows as two commits and two activity items; a delete reads "changed"
- Observed: History and Activity show "Rename …" twice (+11 and −11). Activity says "Sam changed
  templates/fb-variants.md: Delete fb-variants.md". Shot: `09-home-1440-dark.png`.

#### F-33 · P2 · Dark-mode danger button (near-black text on red): judgement
- Observed: the text is `lab(4 …)` on `lab(59 60 36)`, about 5.8:1, so it passes AA, and axe reports no
  violation. Shots: `10-dark-danger-confirm.png`, `10-dark-danger-button-zoom.png`.
- Judgement: it's legible, but black-on-coral reads like a warning chip rather than a destructive action.
  It also doesn't match light mode, which uses white on red. Suggest a slightly deeper red (L≈0.55) with
  white text (≥4.5:1). That keeps "destructive" recognisable across both themes.

#### F-35 · P2 · Home skeleton → content shift
- Observed: the skeleton has 3 Needs-you rows and 5 sidebar rows, and the real content has a different
  number, so "Your spaces", People and Rules jump. CLS is 0.062 on Home and ≤0.015 elsewhere, so it's
  within "good", just noticeable. Shots: `01-home-1440-light-t150.png` → `01-home-1440-light.png`.

---

## 3. Coverage summary (what I ran)

| Brief item | Result |
|---|---|
| 1 First-run comprehension | Section 1 |
| 2 Sam: browse, tables + long file, edit/save/toast/reload, locked, Bolt by link | Done. Save, toast and persistence OK; F-02, F-03, F-06, F-07 |
| 3 Sync: behind and local changes | Behind OK (popover, inline outcome); local changes broken, F-01 |
| 4 Maya: matrix, role change, remove + confirm, Undo, invite, Add space (both), approve, reject | All work; F-08, F-11–F-13, F-18, F-19 |
| 5 Rename and delete (first live test) | Both work; F-16, F-17, F-32 |
| 6 ⌘K / Ctrl+K | Both open; results work; Bolt content not leaked to Sam; F-20, F-27 |
| 7 1440/1024/390 × light/dark (10 routes) | `shots/09-*`; F-22, F-23, F-30, F-31 |
| 8 Keyboard pass (journeys 2 and 4) | F-19, F-20, F-21, F-26 |
| 9 axe on each route, light and dark (1440 and 390) | Only 4 rule types fire; F-26, F-28, F-29; dark danger F-33 |
| 10 Copy | F-04, F-05, F-06, F-11, F-15, F-27. No cute or patronising tone found |
| 11 Performance feel | ~1.35s to data on every route (the demo API is slow); skeletons; CLS ≤0.062; no raw ids flash before names load |

Not covered: real screen readers, Safari/Firefox, a slow-network profile, and the pull-request
(Propose change) save path on Northline, where Sam is view-only.

## 4. Observed and good (brief)
- Calm, legible reader. Tables render well at reading width, and dark mode is polished.
- The locked-file note names the people and offers "Ask … for a change · Opens a GitHub issue".
- Bolt HVAC by direct link shows a clear no-access page with the named owner and two actions.
- The unsaved-changes guard works, and Escape keeps you editing. ⌘S saves. The save toast says where the
  change went.
- The conflict dialog (apart from its default button) is the clearest I've seen: a diff, three ways out,
  and "Your edits are safe".
- People: the role menu explains the GitHub mapping. Role change and removal both have toasts with Undo,
  and Undo restores the role. Team-managed grants show as read-only with a reason.
- Add space: both paths work end to end. The kind cards explain when each kind loads. Removing a space
  needs type-to-confirm.
- Rules: approve and reject both work live, with clear confirm copy and a "Waiting for you" filter. Sam
  sees no controls.
- The sync popover shows its outcome inline. The ••• menu, sync popover and user menu return focus
  correctly. Focus rings are visible throughout.
- Layout holds at 1024 and 390 on every route except People (F-22). There's no document overflow
  anywhere else.

## 5. Side effects of this review
- `next build` with a custom `NEXT_DIST_DIR` rewrote `dashboard/next-env.d.ts`. The file is git-ignored and
  auto-generated. At the end I reset it to point at `.next/types`. Its exact original content is unknown,
  and Next regenerates it on the next `pnpm dev` or `pnpm build`. The build output in
  `qa/independent/.next-build` was deleted. Both servers I started (:8788 and :3300) were stopped. :8787
  was never touched. `tsconfig.tsbuildinfo` (git-ignored)
  was touched by the build.
- Demo data changes only affected throwaway seeds in `/tmp`.

---

# Re-check after fixes (2026-10-12)

**What this is.** This is again an expert review plus automated checks (Playwright driving Chromium, and
axe-core 4.x). **It is not user testing and not a screen-reader test.** "Observed" = seen live with a
screenshot or log; "Assumed" = inference.

**Setup.** Fresh demo seeds throughout: `reseed.sh` restarts only my API on :8788 with a new seed. I used 4
seeds, because the behind, conflict and Get-latest flows each consume Ads Team's "behind" state. Fresh
http build on :3300. Scripts: `qa/independent/r*.mjs`. Raw data: `sweep-re.json`, `copy-strings.json`.
Screenshots: `shots/re/`.

## A. Original findings: status

| ID | Was | Status | Evidence (shots/re/…) | Notes |
|---|---|---|---|---|
| F-01 | P0 | **Fixed** | `r03-home-review-dialog.png`, `r03-home-after.png`, `r03-popover.png`, `r03-popover-after.png` | Home "Review and save" lists the file and saves it ("Saved 1 file to GitHub"). The popover lists 2 files (Edited/New) and saves them. API state → synced. |
| F-02 | P1 | **Fixed** | `r01-conflict-dialog.png`, `r01-conflict-diffview.png` | Focus starts on "See what Jordan changed". "Replace Jordan's changes with mine" is a secondary danger button. The diff has a clear legend. No SHA. |
| F-03 | P1 | **Fixed** | `r02-save-with-pull-toast.png` | Behind notice on Edit. A save that pulls says "Saved. Also brought in 2 changes from Jordan." `lastSyncAt` now updates. A conflicted save still pulls in the background, but the dialog names the change. The **Get latest button is broken (N-01).** |
| F-04 | P1 | **Partly fixed** | `r01-home-sam-1440.png` | Git verbs are gone (no commit, push, pull, clone or remote anywhere I crawled). "Repo" remains throughout Add space and Settings. See C. |
| F-05 | P1 | **Fixed** | `r08-home-1024-light.png`, `r06-history.png` | Activity uses rule titles and names ("Ken proposed a rule for Ads Team: Tracked number on every call asset"). History: "Approved a rule: …", with no `[SelfHub]`. Raw login only where no name exists ("casey-lee"). |
| F-06 | P1 | **Fixed** | `r06-viewonly.png` | "You can view Northline. To edit, ask Maya Chen or Marcus Bell for Can edit." It now has "Ask … for a change". |
| F-07 | P1 | **Fixed** | `r01-ads-edit-behind-notice.png` | `.github` and `.selfhub` are hidden ("Files · 8"). |
| F-08 | P2 | **Fixed** | `r05-invited.png` | Row reads "Invited · waiting to accept". Invite is disabled when the field is empty. |
| F-09 | P2 | **Fixed** | `r11-popover-synced-dark.png` | Sync now is an outline button when synced. |
| F-10 | P2 | **Fixed** | `r01-home-sam-1440.png` | "2 things need you · 4 spaces". |
| F-11 | P1 | **Fixed** | `r07-connect-plain.png` | "This folder isn't a SelfHub space yet." plus "Create a new space instead". No CLI command, no API hint. |
| F-12 | P1 | **Fixed** | `r07-create-done.png`, `r07-created-space.png` | The new space is "Synced" and the repo link is consistent. |
| F-13 | P2 | **Fixed** | `r07-create-filled.png` | `aria-invalid=false` after typing. |
| F-14 | P2 | **Partly fixed** | `r07-connect-form.png` | Dead list removed; field label is "GitHub link or folder on this computer". Still says "Paste a repo link **or pick one you can access**" with nothing to pick. Title "Connect an existing space", accessible name "Connect a GitHub repo.", card "Connect an existing repo" (N-05). |
| F-15 | P2 | **Fixed** | `r07-space-settings.png` | "How this space works." System files hidden ("Locked files: None"). |
| F-16 | P1 | **Fixed** | `r06-renamed.png` | One toast, "Renamed to fb-variants.md · Saved to GitHub…". One history entry. Only background 404s in the console (N-09). |
| F-17 | P2 | **Fixed** | `r06-rename-invalid.png` | "Leave out ? # % \ : * " < > \|." and Rename is disabled. |
| F-18 | P2 | **Partly fixed** | `r07-reject-dialog.png`, `r07-rejected-tab.png` | Optional "Why?" is shown on the rule ("Rejected: We already track calls with CallRail"). Still no Undo after Approve or Reject. |
| F-19 | P1 | **Fixed** | `r05-enter-no-access-confirm.png` | Enter on "No access" opens the confirm. Escape returns to the combobox and the value stays. |
| F-20 | P1 | **Fixed** | — (log) | Escape returns focus: palette → "Search ⌘K"; drawer → Leo's row; confirm → combobox or Remove button. ⌘S → "Edit" button. |
| F-21 | P1 | **Fixed** | `r04c-click-then-arrows.png` | My exact steps (Tab into tree → ↑↑ to campaign-naming.csv → Enter): focus, `:focus-visible` and selection all stay on campaign-naming.csv. Click → arrows → Enter works too. (A programmatic `.focus()` without entering the tree still drifts one row. That's a test artefact, not a user path.) |
| F-22 | P1 | **Fixed** | `r08-people-390-light.png` | Document overflow 0 at 390. The matrix scrolls in its container. |
| F-23 | P1 | **Fixed** | `r08-members-390-dark.png` | Full names. The role sits under the name. |
| F-24 | P1 | **Fixed** | `r04-csv.png`, `r08-csv-390-light.png` | CSV renders as a table in a focusable scroll container. No scroll cue at 390 (N-10). |
| F-25 | P1 | **Fixed** | `r06-history.png` | No git header lines. |
| F-26 | P1 | **Fixed** | — (log) | The reader is `role=region` "Contents of facebook-ads.md", `tabindex=0`. PageDown scrolls 0 → 707. axe no longer reports it. |
| F-27 | P2 | **Partly fixed** | `r06-cmdk.png` | No markdown symbols. But table rows become "Channel · Spend · Leads · CPL · Booked jobs · Cost per job · · · · · ·" (empty cells → dots), and rule files show "rule: … why: …" keys. |
| F-28 | P2 | **Partly fixed** | `sweep-re.json` | At 1440, label-in-name hits dropped from 3–14 per page to 0–1. Left: sync status button (file/members/etc.), the Rules "Waiting for you" toggle, and 1024 rail links (N-11). |
| F-29 | P2 | **Fixed** | `sweep-re.json` | No color-contrast hits at 1440 or 390. |
| F-30 | P2 | **Partly fixed** | `sweep-re.json` | Rules tabs and space tabs are now ≥40px at 390. The repo link under the space name is 32px. |
| F-31 | P2 | **Fixed** | `r08-home-1024-light.png` | "NL". |
| F-32 | P2 | **Fixed** | `r06-history.png`, `r08-home-1024-light.png` | One "Rename …" entry. Activity says "Sam deleted fb-variants.md from Ads Team". |
| F-33 | P2 | **Fixed** | `r11-dark-danger-zoom.png` | White on `lab(42 60 40)`, about 6:1. It reads as destructive in both themes. |
| F-35 | P2 | **Not fixed** | `r11-home-t250.png` | Home CLS is still 0.062 (skeleton row count ≠ content). |

**Tally:** the P0 is fixed. 16 of 17 P1 are fixed and 1 is partly fixed (F-04, the "repo" wording). Of the 16 P2,
10 are fixed, 5 partly fixed and 1 not fixed.

## B. axe comparison (WCAG 2.0/2.1 A+AA; 11 routes incl. CSV; 1440/1024/390 × light/dark)

| Rule | First sweep (1440, 390) | Re-check 1440 | Re-check 390 | Re-check 1024 (not run first time) |
|---|---|---|---|---|
| scrollable-region-focusable (serious) | file page, every width | 0 | 0 | 0 |
| color-contrast | history diff numbers (light) | 0 | 0 | **4 light / 2 dark on every page**: rail monograms (N-02) |
| label-content-name-mismatch | 3–14 per page | 0–1 per page | rules 1 | 5–7 per page: rail links (N-11) |

No new rule types fired. No document overflow at any width (it was 330px on People at 390).

## C. Copy sweep

Method: I crawled every route as Sam and Maya, opened the menus, popovers and dialogs, and took the
visible text plus title and placeholder text (`copy-strings.json`). State-dependent strings (behind,
conflict, local edits) come from the flows in A. File *content* (SOP text) is excluded.

**C1. Remaining git or technical terms in UI chrome (verbatim):**
- Repo:
  - Add space: "A space is a GitHub repo of markdown files that SelfHub and your agents work from." /
    "Connect an existing repo" / "Add a GitHub repo your company already has, like a client folder." /
    "Start a fresh space from a template. SelfHub makes the repo for you."
  - Connect dialog: accessible name "Connect a GitHub repo." / "Paste a repo link or pick one you can access."
  - ⌘K: "Connect a GitHub repo or create a new space".
  - Space Settings: label "GitHub repo" / "The GitHub repo and its history are kept."
  - Role option "No access": "Removed from the repo" (person drawer). The user reported seeing "Removes them
    from the repo". I saw only "Removed from the repo" in this build.
  - Space header: the `northline-demo/client-apex` slug under every space name (mono).
- GitHub roles: role options "Same as GitHub admin. …", "Same as GitHub write. Can edit files.", "Same as
  GitHub read. Can view files, not change them." People and Members footnote: "Roles map to GitHub: Admin =
  admin, Can edit = write, Can view = read." Suggest dropping "Same as GitHub write/read" from the
  option text and keeping the mapping in the footnote only.
- Raw logins where names exist: Sam's read-only Members note "Only admins of Ads Team can change access.
  Ask **@jordan-reyes** if someone needs to be added." and "Ask **@jordan-reyes or @priya-nair** …". The
  People page uses names ("Ask Maya Chen or Marcus Bell…"), so these two are inconsistent (N-03).
  `@handle` as a secondary line under a name is fine.
- Rule IDs: none in UI chrome. They still appear inside file diffs and rules files, which is content.
- Source references on rule cards: "Apex Roofing:past-ads/2026-09-fall-inspection.md" (space:path syntax),
  shown raw.

**C2. The same idea in different words (verbatim):**
- **Incoming work: "updates" vs "changes".**
  - Updates: "2 updates to get" (chip, card, Home title) / "Got the latest updates" / "Sam synced Ads Team
    and got 1 update from Ken Ito".
  - Changes: "Jordan Reyes made 2 changes on GitHub." (Home row, right under "2 updates to get") / "Jordan
    Reyes made 2 changes since you last synced." / "Saved. Also brought in 2 changes from Jordan."
  - Pick one. I suggest "updates" for incoming and "changes" for your own.
- **The same action under three names:** "Sync now" (Home, popover) / "Get latest" (editor notice) / ⌘K
  "Sync all spaces — Get the latest from GitHub and send your changes".
- **Outgoing:** "Save & sync" (editor) / "Save these changes" (local edits) / "Sent 5 changes to GitHub" /
  "Saved 1 file to GitHub" / "5 saved changes haven't reached GitHub yet" / "The file is added and synced to
  GitHub."
- **"Unsaved" means two things:** in the editor, "Unsaved changes" is a browser draft. In the space status,
  "Unsaved edits on this computer" / "1 file changed on this computer but not saved to GitHub" refers to
  files on disk. The dialog for the second is titled "Edits on this computer" (N-04).
- **Connecting:** card "Connect an existing repo" → dialog title "Connect an existing space" → accessible name
  "Connect a GitHub repo.".
- **Re-adding a person:** the drawer confirm says "You can add them again later", while the Members confirm says "You can invite
  them again later". This is minor.
- Tone: nothing cute or patronising found.

## D. Regression check (what worked before)

| Flow | Result | Evidence |
|---|---|---|
| Invite (new, duplicate, Enter to submit) | OK. Toast "Added @casey-lee to Apex Roofing as Can view…"; duplicate shows an inline message | `r05-invited.png` |
| Role change + Undo; remove + confirm + Undo | OK | log r05 |
| Locked file | OK. "Locked. Only Maya Chen or Marcus Bell can change this file, through a reviewed change." + Ask link | `r06-locked.png` |
| No-access screen by direct link | OK, unchanged | `r06-noaccess.png` |
| Unsaved-changes guard | OK | log r06 |
| Add space (create; connect by folder) | OK | `r07-*` |
| Approve and reject | OK; the reject reason is shown on the card | `r07-rejected-tab.png`, `r07-approved.png` |
| Save & sync toast, ⌘S | OK | log r04 |
| Sync on a space that was never pushed (Bolt, Maya) | OK. "Bolt HVAC is up to date · Sent 5 changes to GitHub." | `r11-bolt-synced.png` |

## E. New issues

### P0
#### N-01 · P0 · "Get latest" while editing discards your unsaved edits, and the toast says they're kept
- Observed twice, on two fresh seeds (Sam, Ads Team behind by 2). Open `sops/facebook-ads.md` → Edit → type a
  line. The first run added it at the end; the second added "QA TOP LINE" at the very top, away from
  Jordan's change. "Unsaved changes" shows. Click **Get latest** in the behind notice.
- Result: the toast says "Got the latest updates. Your edits are still here. If they overlap, you'll be
  asked what to keep when you save." But the editor holds Jordan's version only. My line is gone and
  "Unsaved changes" has disappeared. There was no warning and no way to recover.
- Shots: `shots/re/r02b-before-getlatest.png` → `shots/re/r02b-after-getlatest.png`, `shots/re/r02-getlatest-after.png`.
- This is the exact case the notice invites people into. It loses work while saying it didn't.
- Fix: keep the draft and 3-way merge it onto the new version (Jordan's change and a top-of-file line don't
  overlap). If that isn't possible, confirm first ("Get latest replaces your unsaved edits. Copy them first?"). Only
  say "Your edits are still here" after checking the editor value.

### P1
#### N-02 · P1 · 1024 rail monograms fail contrast
- Observed (axe, every page at 1024): "BH"/"CD" (no-access, light) are 1.92:1 (`#cea566` on `#f2ebe1`); "AR" (amber) is
  3.2:1; "AT" is 4.15:1. In dark mode, no-access is 3.79:1. These monograms are the only visible label of the nav items
  at 1024; the full name appears only on hover or focus.
- Shot: `r08-home-1024-light.png`.
- Fix: use the kind `-text` tokens for monogram text. Show no-access with the lock badge, not by fading the
  text below 4.5:1.

### P2
- **N-03** · Raw logins where names exist: "Ask @jordan-reyes or @priya-nair if someone needs to be added."
  (Sam, Members). Use names, as the People page does.
- **N-04** · "Unsaved" is used for both a browser draft and committed-but-not-on-GitHub files on disk (see C2).
  Suggest "Not on GitHub yet" for the disk state.
- **N-05** · Connect naming is inconsistent (card, title, accessible name), and "pick one you can access" offers
  nothing to pick. Shot: `r07-connect-form.png`.
- **N-06** · ⌘K snippets: empty table cells become "· · · · ·", and the "rule: … why: …" keys leak through
  (`r06-cmdk.png`).
- **N-07** · File counts disagree: Settings says "Size 7 files" and the card says "10 files", while the tree
  shows "Files · 5" / "Files · 8" because system files are hidden.
- **N-08** · Focus goes to `<body>` after save-local succeeds, from both the Home dialog and the popover. The
  trigger row or button disappears. Move focus to the "Needs you" heading or the sync chip.
- **N-09** · After a rename or delete, the app re-requests the old path (two 404s in the console). Nothing
  visible.
- **N-10** · The CSV table at 390 is clipped at the right edge with no scroll cue. It does scroll, inside a
  focusable container. Shot: `r08-csv-390-light.png`.
- **N-11** · Label-in-name (WCAG 2.5.3) remains on the sync status button ("Sync status: Synced. Open sync
  options" vs visible "Synced · just now"), the Rules "Waiting for you" toggle, and the 1024 rail links
  (aria-label "Ads Team, Synced" vs visible "AT").

**New issue counts:** P0 1, P1 1, P2 9.

## F. Observed and good (re-check)
- The conflict dialog is now a model to copy: safe default, plain title, "Your edits are safe", and the diff
  on demand.
- Save-local is clear from both entry points, with file names and New/Edited tags.
- Wording is far plainer: no commit, push, pull or clone anywhere I crawled; activity reads like sentences.
- Keyboard: focus return is consistent, the tree is reliable, and the reader is scrollable by keyboard.
- 390 layouts hold everywhere, with no page-level overflow.

## G. Housekeeping
- Both servers I started (:8788 and :3300) were stopped. :8787 (AgentGrid) was never touched.
- The build output in `qa/independent/.next-build` was deleted, and `dashboard/next-env.d.ts` (git-ignored,
  auto-generated) was reset to `.next/types` as before. All demo data lived in `/tmp` seeds.

RECHECK COMPLETE

---

# Final verification (2026-10-12)

**What this is.** This is an expert review plus automated checks (Playwright driving Chromium against the
live API, and axe-core). **It is not user testing and not a screen-reader test.** "Observed" = seen live,
with a screenshot or log; "Assumed" = inference.

**Setup.** Fresh http build on :3300. API on :8788 only, with a **fresh demo seed for every run that uses
up Ads Team's "behind" state** (8 seeds in total, via `reseed.sh`). Scripts: `f*.mjs`. Raw data:
`sweep-final-1024.json`, `sweep-final-spot.json`, `copy-strings-final.json`. Screenshots: `shots/final/`.

## Results

| # | Check | Result | Evidence (`shots/final/`) |
|---|---|---|---|
| 1a | **Former P0, overlap case.** My exact steps: type "QA TOP LINE" at the top of `sops/facebook-ads.md` → **Sync now** in the behind notice | **PASS** | `f01-A-1-before.png`, `f01-A-2-after-sync.png` |
| | The text is still there, and "Unsaved changes" stays on. The note says "Jordan Reyes also changed this file. When you save, you'll choose what to keep." The toast says "Jordan Reyes also changed facebook-ads.md · Your unsaved changes are still here…". All of it is true: the server has Jordan's section and the draft keeps mine. | | |
| 1b | Save → the conflict dialog shows. The diff view marks my line as "only in yours" and Jordan's section as "in Jordan's version". | **PASS** | `f01-A-3-conflict.png`, `f01-A-3b-conflict-diff.png` |
| 1c | Choice "Replace Jordan's changes with mine": the server gets my line and Jordan's section is removed. That's exactly what the label says, so nothing is lost silently. | **PASS** | `f01-A-4-after-choice.png` |
| 1d | Choice "Discard my edits" (fresh seed): the toast says "Your edits were discarded · You're now editing Jordan's version." The server keeps Jordan's section, and my line is gone, as stated. | **PASS** | `f01-B-4-after-choice.png` |
| 1e | Escape or close the conflict dialog (fresh seed): the draft and "Unsaved changes" stay, and nothing is saved. | **PASS** | `f01-C-4-after-choice.png` |
| 1f | **No overlap** (README, which Jordan didn't touch), synced from the **popover** (fresh seed): the draft stays and so does "Unsaved changes". The popover says "Ads Team is up to date · Got 2 changes from GitHub." Save works with no conflict, and the server has my line. | **PASS** (see NF-03) | `f01-D2-2a-popover.png`, `f01-D2-3-saved.png` |
| 1g | No overlap, synced from the **sidebar "Sync all spaces now"** (fresh seed): the draft stays, the space syncs, and the save works. | **PASS** (toast wording: NF-02) | `f01-E-2-after-sync.png` |
| 1h | No overlap, synced from the **behind notice** (fresh seed): the toast says "Got the latest changes · They didn't touch README.md. Your unsaved changes are still here." That's true. | **PASS** | `f01-F-2-after-sync.png` |
| 2 | **Rail contrast at 1024**, all 11 pages, light and dark (22 runs) | **PASS**: 0 color-contrast and 0 label-in-name violations, so axe reports **0 violations of any kind** (was 4/2 contrast and 5–7 label-in-name per page). Monograms use foreground text on a tinted tile. | `f03-home-1024-light.png`, `f03-*-1024-dark.png` |
| 3 | **Spot axe at 390 and 1440**, Home, a file page and People, light and dark (12 runs) | **PASS**: 0 violations. No document overflow. The only target under 40px is the skip link, which is hidden until focused. | `f03-home-390-*.png`, `f03-people-1440-*.png` |
| 4 | **Copy grep** (both users, all routes, menus, dialogs and popovers, plus API messages) | **PASS with one note** (NF-06) | `copy-strings-final.json` |
| 5a | Save-local from the Home "Review and save" dialog | **PASS**: the dialog is titled "Not on GitHub yet" and lists the file; the toast says "Saved 1 file to GitHub". | `final-f05-home-review-dialog.png`, `final-f05-home-after.png` |
| 5b | Save-local from the popover | **PASS**: it lists "offers.md Edited" and "work/qa-scratch.md New", then "Saved 2 files to GitHub". (NF-05 on status lag.) | `final-f05-popover.png`, `final-f05-popover-after.png` |
| 5c | Invite | **PASS**: the toast says "Added @casey-lee to Apex Roofing as Can view…" and the row shows "Invited · waiting to accept". | `f06-invited.png` |
| 5d | Role change with Undo | **PASS**: "Leo can now edit Ads Team" → Undo → "Undone. Leo is back to Can view in Ads Team." | `f06-undo.png` |
| 5e | **Rename** | **FAIL (regression of F-16)**, NF-01 | `f06b-rename-brief-template.png`, `f06b-rename-google-search.png` |
| 5f | **Delete** | **FAIL (same false toast)**, NF-01. The delete itself works. | `f06b-deleted.png` |

### Copy grep detail (item 4)
- **"update" / "updates":** none in UI chrome. Incoming work is "changes" everywhere: "2 changes to get", "Jordan
  Reyes made 2 changes since you last synced. Sync now so you're editing the latest version.", "Got 2 changes
  from GitHub.", "Sam synced Ads Team and got 2 changes from Jordan Reyes".
- **"repo":** only "Connect an existing GitHub repository" / "GitHub repository link or folder on this
  computer" in the connect step. Add space now reads "A space is a shared folder of company knowledge, kept on
  GitHub…". The only other "repo" is inside file *content* (compliance.md: "…into an AI tool or this repo"),
  which is not UI.
- **"GitHub write/read":** gone from the role options. They now read "Admin — Can edit files and manage who
  has access." / "Can edit — Can view and edit files." / "Can view — Can open and read files, not change
  them." / "No access — Can't open this space." Two explanatory lines remain:
  - People: the old footnote "Roles map to GitHub…" no longer appears anywhere in the crawl.
  - Space Settings: **"Admin, Can edit and Can view match GitHub's admin, write and read access for this
    space."** (NF-06)
- **"Get latest", "Sync to":** none. The action is "Sync now" in the notice, the popover, Home and ⌘K. The
  sidebar button's accessible name is "Sync all spaces now".
- **@login where a name exists:** none as a primary label. The read-only Members note now says "Ask Jordan
  Reyes or Priya Nair to add someone." `@handle` stays only as the secondary line under a name ("@jordan-reyes · via the Strategy team"), on Settings ("@sam-okafor · Northline") and in the account footer. That's acceptable. "@casey-lee" appears where no name exists.
- **"unsaved" for files on disk:** none. The disk state is "Not on GitHub yet" / "1 file changed on this
  computer and not on GitHub yet." "Unsaved changes" appears only in the editor.
- **API messages shown in the UI:** "Up to date with GitHub." / "1 file on this computer isn't on GitHub yet.
  Save it to send it." / "2 files on this computer aren't on GitHub yet. Save them to send them." / "This space
  is only on this computer. It isn't connected to GitHub." All are plain.

## New issues

### P1
#### NF-01 · P1 · Rename and delete show a false "isn't in Ads Team" toast (regression of F-16, now also on delete)
- Observed 3 of 3 (Sam, Ads Team, fresh build). Renaming `templates/facebook-variants.md` →
  `fb-variants.md`, `templates/ad-brief.md` → `brief-template.md`, and `sops/google-ads.md` →
  `google-search.md`. Each time two toasts appear together: "Renamed to … · Saved to GitHub…" and
  "**templates/ad-brief.md isn't in Ads Team** · It may have been renamed or deleted. Showing the space's main
  file." It now names the *old* path. The pane shows the renamed file correctly.
- Delete: "Deleted google-search.md · Removed from Ads Team for everyone." is followed 150ms later by
  "sops/google-search.md isn't in Ads Team · It may have been renamed or deleted…". The console shows 404s
  for the old paths.
- Shots: `f06b-rename-brief-template.png`, `f06b-rename-google-search.png`, `f06b-deleted.png`.
- Assumed cause: the open-file query for the old path refetches after the move/delete and triggers the
  missing-file fallback. Fix: remove or cancel the old path's query before navigating, and suppress the
  fallback toast for a path the app itself just moved or deleted.

#### NF-02 · P1 · "Sync all spaces now" says "Everything is up to date" while a space still has files not on GitHub
- Observed (Sam and Maya, fresh seed): before, Home shows "Apex Roofing: not on GitHub yet · 1 file changed on
  this computer…". Sidebar → Sync all spaces now gives the toast "**Everything is up to date** · Synced 1
  space with GitHub." (Sam) / "Synced 2 spaces with GitHub." (Maya). The Apex row is still there afterwards,
  and the API state is `local-changes`.
- Shot: `f02-syncall-sam.png`, `f02-syncall-maya.png`, `f01-E-2-after-sync.png` (Apex's ↑ still in the sidebar).
- This is the same contradiction as the original F-01, on a different button. The Needs-you row still offers
  "Review and save", so it isn't a blocker.
- Fix: count spaces left with files not on GitHub, and say "2 spaces synced. Apex Roofing has 1 file that
  isn't on GitHub yet" with a Review button. Or have Sync all include save-local after confirmation.

### P2
- **NF-03** · A popover sync with an open draft is truthful ("Ads Team is up to date · Got 2 changes from
  GitHub.") but doesn't reassure that the draft is safe. The notice path says "They didn't touch README.md.
  Your unsaved changes are still here." The popover and sidebar paths should say the same. (Shot
  `f01-D2-2a-popover.png`.)
- **NF-04** · The conflict dialog has no "keep both" option, even when the changes don't overlap (my
  top-of-file line vs Jordan's new section at the end). The only ways to keep both are Copy my text →
  Discard → paste. Neither offered choice loses data *silently*. Both are labelled, so this is polish.
- **NF-05** · Status lags a few seconds for files changed outside SelfHub. Right after I edited
  `offers.md` on disk, the popover still showed "Synced" with no Save option. A reload a few seconds later
  showed "Not on GitHub yet". Assumed: the API caches status briefly. In-app edits aren't affected.
- **NF-06** · Space Settings still says "Admin, Can edit and Can view match GitHub's admin, write and read
  access for this space." It's secondary text, so acceptable under the brief, but it's the last
  write/read mention.

**New issue counts:** P0 0, P1 2, P2 4.

## Summary
- The former P0 (draft loss on sync) is **fixed and verified** from all three sync entry points, in both
  the overlap and no-overlap cases, and through all three conflict exits (Replace, Discard, Close). No
  path lost data silently. Every message I read matched the actual editor and server state.
- The 1024 rail is fixed: 0 axe violations across 22 runs. There are no regressions at 390 or 1440.
- The glossary holds in rendered UI and API messages, with one remaining Settings sentence.
- Rename and delete regressed (NF-01). "Sync all" overstates success (NF-02).
- Housekeeping: both of my servers (:8788 and :3300) were stopped; :8787 was never touched. The build output
  in `qa/independent/.next-build` was deleted, and the git-ignored `next-env.d.ts` was reset to `.next/types`.
  All demo data lived in `/tmp` seeds.

FINAL VERIFICATION COMPLETE
