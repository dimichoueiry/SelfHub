# Setting up SelfHub (API + dashboard)

This guide covers running the SelfHub API and dashboard against your own data and
connecting GitHub repos as spaces. Everything here was checked against the code. Anything
that wasn't is marked **(unconfirmed)**.

## 1. Set up: one command

```bash
bash ~/Documents/GitHub/SelfHub/scripts/setup.sh
```

(Use the folder you put SelfHub in. No git yet, so you can't clone? On the SelfHub GitHub
page, click **Code → Download ZIP**, unzip it, and run the script from that folder.)

The script does every step. You never create a config file by hand.

1. **Checks what SelfHub needs**, one line each, `[ok]` or `[missing]`:
   - git
   - GitHub CLI (gh): GitHub's own command-line app
   - that you're logged in to GitHub (`gh auth status`)
   - uv (installs the Python code), and Python 3.12 or newer (uv downloads it if missing)
   - Node.js 20.9 or newer and pnpm, for the dashboard (skip both with `--no-dashboard`)
2. **If something is missing**, it says how to install it on your system (macOS, Linux or
   Windows) and stops. It also prints a ready-to-paste prompt for Claude Code or Codex: the
   AI installs what's missing, helps you make a GitHub account, logs you in and runs setup again.
3. **No GitHub account?** Each space is stored as a GitHub repo, so you need one. It's free:
   <https://github.com/signup>. When you're not logged in, the script offers to run
   `gh auth login` for you (HTTPS, browser login) and checks again afterwards.
4. **Installs SelfHub** (`uv sync --all-packages`, then `pnpm install` in `dashboard/`).
5. **Writes your settings**, and only what's missing:
   - your own SelfHub folder (default `~/selfhub`), set up as a git repo
   - `~/.selfhub/config.json`: where that folder is, and your GitHub username
   - optionally a shared space (team, client or org): its folder, its `.selfhub/space.json`
     and starter files, and its entry in `~/.selfhub/spaces.json`

Run it again any time, for example after pulling new code. It keeps everything that's
already set up and never replaces a config or `space.json` without asking.

**No questions asked** (scripts, CI): pass `--yes`, or set `SELFHUB_NONINTERACTIVE=1`.

| Flag | Env var | Default |
|---|---|---|
| `--personal-path DIR` | `SELFHUB_PERSONAL_PATH` | `~/selfhub` |
| `--github-owner NAME` | `SELFHUB_GITHUB_OWNER` | the account you're logged in as |
| `--space-name NAME` | `SELFHUB_SPACE_NAME` | no shared space (asks when interactive, default "Team") |
| `--space-kind KIND` | `SELFHUB_SPACE_KIND` | `team` (`team`, `client` or `org`) |
| `--space-path DIR` | `SELFHUB_SPACE_PATH` | `~/.selfhub/spaces/<name>` |
| `--no-space` | `SELFHUB_NO_SPACE=1` | |
| `--config-dir DIR` | `SELFHUB_CONFIG_HOME` | `~/.selfhub` |
| `--replace` | | never replace an existing setting or `space.json` |
| `--no-dashboard` | | check and install the dashboard too |
| `--skip-install` | | run `uv sync` and `pnpm install` |

Example:

```bash
bash scripts/setup.sh --yes --space-name "Apex Roofing" --space-kind client
```

### Reference: what the checks are based on

| Tool | Version | Why |
|---|---|---|
| Python | 3.12 or newer (`requires-python = ">=3.12"`) | API and CLI |
| [uv](https://docs.astral.sh/uv/) | any recent | installs the Python workspace |
| Node.js | 20.9 or newer (Next.js 16 needs it) | dashboard |
| pnpm | 9.14.4 (`packageManager` in `dashboard/package.json`); corepack also works | dashboard |
| Git | any recent | every space is a git repo |
| [GitHub CLI](https://cli.github.com) (`gh`) | any recent | roles, members and pull requests |

**GitHub access.** With real data, the API talks to GitHub only through `gh api ...`
(`packages/selfhub-api/src/selfhub_api/github.py`). It never reads a token itself.

Scopes needed. These come from the endpoints the code calls:

- `repo`: read collaborators and permissions, open PRs, change roles. Private repos need it too.
- `read:org`: list org members and teams (`orgs/<org>/members`, `orgs/<org>/teams`).

The setup script warns if your login is missing either one. `gh auth login` asks for `repo`
and `read:org` by default **(unconfirmed: that's gh's behaviour, not this repo's)**. To add
them later, run `gh auth refresh -h github.com -s repo,read:org`.

Plain git commands (clone, pull, push) use your normal git credentials, not `gh`. Run
`gh auth setup-git` if you want git to use the gh login too.

Changing someone's role or removing them needs **admin** rights on that repo. That's GitHub's
rule.

`GITHUB_TOKEN` is only read by the CLI's `selfhub init --github-owner ...` bootstrap
(`selfhub_cli/service.py`). The dashboard API doesn't read it. `gh` itself respects
`GH_TOKEN`/`GITHUB_TOKEN` **(unconfirmed: that's gh behaviour)**.

## 2. Install

The setup script installs everything. To update after pulling new code, run it again.

## 3. Start the API (port 8788)

Port **8787 is taken by AgentGrid** on this machine, and 8787 is also the API's built-in
default (`DEFAULT_PORT = 8787` in `selfhub_api/app.py`). So always set the port:

```bash
# real data (your ~/selfhub plus any spaces you connected)
SELFHUB_API_PORT=8788 uv run selfhub-api
```

It prints `SelfHub API (local) on http://localhost:8788  config: ...`. Check it:

```bash
curl -s localhost:8788/api/health     # {"ok":true,"mode":"local","configDir":"..."}
```

API environment variables (all read in `selfhub_api/app.py`):

| Variable | Default | Meaning |
|---|---|---|
| `SELFHUB_API_PORT` | `8787` | **set to `8788`** |
| `SELFHUB_API_HOST` | `127.0.0.1` | bind address |
| `SELFHUB_DEMO` | off | `1` = serve the Northline demo company |
| `SELFHUB_CONFIG_DIR` | demo: a new temp dir; real: `~/.selfhub` | where `spaces.json`, `dashboard.json` and cloned spaces live |
| `SELFHUB_PERSONAL_PATH` | `repo_path` from `~/.selfhub/config.json`, else `~/selfhub` | your personal SelfHub repo |
| `SELFHUB_GITHUB_ORG` | `github_owner` from config, else the owner of the first connected space's GitHub remote | org used for People and teams |
| `SELFHUB_API_URL` | `http://localhost:<port>` | public URL, used for avatar links |
| `SELFHUB_CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | not needed when you use the dashboard proxy |

## 4. Start the dashboard (pointed at 8788)

The browser calls same-origin `/selfhub-api/*`. Next.js proxies that to
`NEXT_PUBLIC_SELFHUB_API_URL`, which **defaults to `http://localhost:8788`**
(`dashboard/next.config.ts`). I checked this: with the API on 8788,
`/selfhub-api/api/health` on the dashboard returns the API's answer.

You **must** set `NEXT_PUBLIC_SELFHUB_API=http`. Without it the dashboard uses its built-in
in-browser mock and ignores the API (`dashboard/src/lib/api/client.ts`).

```bash
cd dashboard
NEXT_PUBLIC_SELFHUB_API=http NEXT_PUBLIC_SELFHUB_API_URL=http://localhost:8788 pnpm dev
# open http://localhost:3000
```

For a production build, set the same two variables for `pnpm build` and `pnpm start`. They
are read when the app is built.

## 5. Use your own selfhub data (`/Users/dimichoueiry/selfhub`)

The setup script handles it:

- It writes `~/.selfhub/config.json` with `"repo_path"` pointing at your SelfHub folder.
  If `~/selfhub` already exists as a git repo, it uses it exactly as it is (no new commits).
- In real mode the API uses that folder as your **personal space** ("My space"). You're its admin.
- If the folder has a GitHub remote, **Sync now** works on it.

To use a different folder for one run:

```bash
SELFHUB_PERSONAL_PATH=/path/to/other/selfhub SELFHUB_API_PORT=8788 uv run selfhub-api
```

Things to know:

- The personal space only appears if the folder is a git repo.
- `~/selfhub` has uncommitted edits right now. Sync runs `git pull --rebase --autostash` and
  then pushes, and it reports leftover edits as "local changes". Commit or stash them first
  if you don't want them touched.
- Don't set `SELFHUB_CONFIG_DIR` for real use. Without it, the API and the `selfhub` CLI share
  `~/.selfhub`, so spaces you add in one show up in the other. The CLI reads
  `SELFHUB_CONFIG_HOME`; the API reads `SELFHUB_CONFIG_DIR`, falling back to the same folder.

## 6. Add a GitHub repo as a space

A repo is a space when it has **`.selfhub/space.json`**. That file marks it as a space and
sets its kind and write policy. SelfHub writes it for you (below); don't create it by hand.
Connecting a plain repo gets "This folder isn't a SelfHub space yet."

### a) Repo is already a SelfHub space

**In the dashboard:** sidebar **Add space** (or ⌘K → "Add a space") → **Connect an
existing GitHub repository** → paste the link (e.g. `https://github.com/you/client-apex` or
`git@github.com:you/client-apex.git`) or a local folder path → confirm.
SelfHub clones it into `~/.selfhub/spaces/<name>` and registers it. The "Repos you can
access" list is empty with the real API (the http adapter returns `[]`), so paste the link.

**In the CLI:**

```bash
uv run selfhub space add git@github.com:you/client-apex.git           # clones into ~/.selfhub/spaces/
uv run selfhub space add https://github.com/you/client-apex --into ~/spaces/apex --name Apex
uv run selfhub space list
```

### b) Plain repo, not a space yet

Copy it to your computer, then point the setup script at it. The script writes
`.selfhub/space.json` and the starter files and connects the space:

```bash
git clone https://github.com/you/client-apex.git ~/spaces/apex
bash scripts/setup.sh --space-path ~/spaces/apex --space-name "Apex" --space-kind client
```

The CLI does the same: `uv run selfhub space create ~/spaces/apex --name "Apex" --kind client`.

Either way it writes `.selfhub/space.json`, `README.md`, `locked/` and `rules/` (only files
that don't exist yet), commits them, **pushes** to the remote, and registers the space.
`--kind` is `org`, `team` or `client`. Default write policy: `org` = `pull-request`, `team`
and `client` = `direct`.

### c) The list of connected spaces

SelfHub keeps it in `~/.selfhub/spaces.json`. The setup script, the CLI and the dashboard
write it. You don't need to edit it.

### "Create a new space" in the dashboard

With the real API, this makes a **local-only** git repo in `~/.selfhub/spaces/<name>` with
**no GitHub remote**. The dialog text says "SelfHub creates it on GitHub for you", but only
demo mode does that. To publish one: create an empty GitHub repo, then run
`git -C ~/.selfhub/spaces/<name> remote add origin <url>` and press **Sync now** (the first sync
pushes and sets the upstream).

### How sync works (`_sync_repo` in `selfhub_api/brain.py`)

**Sync now** does this, in order:

1. `git fetch`.
2. No upstream yet → push and set upstream.
3. Behind → `git pull --rebase --autostash`.
4. Ahead → `git push`.

Spaces with no remote say "nothing to sync".

- **Conflicts:** if the rebase fails, SelfHub runs `git rebase --abort`, so your repo is left
  as it was. It tells you which file overlaps and who changed it. Nothing is force-pushed.
- **Saving a file:** the editor sends the version you opened. If the file changed since then
  (for example, a sync pulled a newer version), the save is refused with "changed since you
  opened it": reload, then edit again.
- **Write policies** (from `.selfhub/space.json`):
  - `direct` commits and pushes.
  - `pull-request` commits on a `selfhub/...` branch, pushes it, and opens a PR with
    `gh pr create`.
  - `read-only` blocks every save.
- **Locked paths** (`locked/` etc.) can't be saved from the dashboard by anyone. Use
  CODEOWNERS and branch protection on GitHub to enforce this outside SelfHub too.
- Edits made outside the dashboard show as local changes. **Save these changes** (or **Propose
  these changes** for `pull-request` spaces) commits them in one go. It is refused if any of
  them touches a locked file.

### Access and roles

SelfHub has no permission system of its own. Roles come from GitHub through `gh`:

- GitHub `admin`/`maintain` → **Admin**.
- `write`/`push` → **Can edit**.
- `read`/`triage`/`pull` → **Can view**.
- None → no access; the space shows as locked to you.

You get the highest of your direct grant and your team grants. Changing a role in **Members**
calls `PUT repos/<repo>/collaborators/<login>`, so it changes the repo on GitHub for real.
Your personal space and spaces with no GitHub remote are always Admin for you.

## 7. Demo seed vs real data

There are three modes:

| Mode | How | Data |
|---|---|---|
| In-browser mock | `cd dashboard && pnpm dev` (no env vars) | fake "Northline" company in the browser; reload resets it |
| API demo seed | below | real local git repos for Northline in a temp dir, fake GitHub (`github_fixture.json`), user switcher Sam/Maya |
| Real | §3 + §4 | your `~/selfhub`, your connected spaces, real GitHub via `gh` |

API demo seed:

```bash
uv run python scripts/seed_demo.py /tmp/selfhub-demo
SELFHUB_DEMO=1 SELFHUB_CONFIG_DIR=/tmp/selfhub-demo SELFHUB_API_PORT=8788 uv run selfhub-api
cd dashboard && NEXT_PUBLIC_SELFHUB_API=http pnpm dev
```

**Switch:** stop the API and start it again with or without `SELFHUB_DEMO=1`. Keep the
dashboard in `http` mode for both. Demo data never touches `~/.selfhub` or `~/selfhub`, as
long as you pass a temp `SELFHUB_CONFIG_DIR` (or leave it unset, which gives a new temp
dir).

## 8. Troubleshooting

1. **Dashboard shows "Northline" sample data instead of your spaces, or the API is
   unreachable.**
   - You started it without `NEXT_PUBLIC_SELFHUB_API=http` (mock mode), or the API isn't on
     8788.
   - Check `curl -s localhost:8788/api/health`. If `mode` is `demo`, an old demo API is still
     running. Find it with `lsof -nP -iTCP:8788 -sTCP:LISTEN` and stop it.
   - Never stop what's on 8787: that's AgentGrid. "Address already in use" means another
     process holds the port.
2. **"SelfHub can't reach GitHub… the GitHub command-line app isn't installed" / "GitHub
   didn't accept that request" / spaces show no access.**
   - Install `gh`, then run `gh auth login`.
   - Make sure `gh auth status` lists `repo` and `read:org`.
   - Make sure your account has access to the repo.
   - People/teams come from `SELFHUB_GITHUB_ORG` (or the first space's owner). Set it if
     that guess is wrong.
3. **"This folder isn't a SelfHub space yet" / "couldn't copy that space from GitHub" when
   adding a repo.**
   - The repo isn't a space yet: run the setup script on it (§6b).
   - Or git can't clone it: test with `git clone <url>` in a terminal. It uses your git
     credentials, not gh's (`gh auth setup-git` fixes that).
   - A sync "conflict" means GitHub has overlapping changes. SelfHub already aborted the
     rebase. Resolve it in the repo with git, then sync again.

Also: `ModuleNotFoundError: selfhub_api` or `selfhub-api: command not found` means the
install is out of date. Run `bash scripts/setup.sh` again.
