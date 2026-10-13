#!/usr/bin/env bash
# SelfHub setup: the one command a new user runs.
#
#   bash scripts/setup.sh            # asks a few questions, with defaults
#   bash scripts/setup.sh --yes      # asks nothing; uses flags, env vars and defaults
#
# 1. Checks the tools SelfHub needs (git, uv, Python, Node, pnpm) and says exactly how to
#    get anything that's missing, plus a prompt to paste into Claude Code or Codex that does
#    it for you. GitHub (gh + login) is recommended, not required: without it, spaces stay
#    "Only on this computer" and setup still finishes.
# 2. Installs SelfHub's code (uv sync, pnpm install).
# 3. Writes every config file (selfhub_cli/onboarding.py). Safe to run again: it never
#    replaces an existing config without asking.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP_CMD="bash \"$ROOT/scripts/setup.sh\""
MIN_NODE="20.9.0"

usage() {
  cat <<EOF
Usage: bash scripts/setup.sh [options]

  --yes, --non-interactive  Never ask. Same as SELFHUB_NONINTERACTIVE=1.
  --no-dashboard            Skip the dashboard (no Node.js or pnpm needed).
  --skip-install            Don't run uv sync / pnpm install (they must have run before).
  --config-dir DIR          Where SelfHub keeps its settings (default ~/.selfhub).
  --personal-path DIR       Your own SelfHub folder (default ~/selfhub).
  --github-owner NAME       Your GitHub username or org (default: the one you're logged in as).
  --space-name NAME         Set up a shared space with this name.
  --space-kind KIND         team, client or org (default team).
  --space-path DIR          Folder for that space (default <config dir>/spaces/<name>).
  --no-space                Don't set up a shared space now.
  --replace                 Allow replacing an existing setting or space.json.
  -h, --help                Show this help.

Each option also works as an env var: SELFHUB_PERSONAL_PATH, SELFHUB_GITHUB_OWNER,
SELFHUB_SPACE_NAME, SELFHUB_SPACE_KIND, SELFHUB_SPACE_PATH, SELFHUB_NO_SPACE=1,
SELFHUB_CONFIG_HOME.
EOF
}

INTERACTIVE=1
DASHBOARD=1
INSTALL=1
OWNER="${SELFHUB_GITHUB_OWNER:-}"
PASS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|--non-interactive) INTERACTIVE=0; PASS+=("--yes") ;;
    --no-dashboard) DASHBOARD=0 ;;
    --skip-install) INSTALL=0 ;;
    --config-dir) export SELFHUB_CONFIG_HOME="$2"; shift ;;
    --github-owner) OWNER="$2"; shift ;;
    --personal-path|--space-name|--space-kind|--space-path) PASS+=("$1" "$2"); shift ;;
    --no-space|--replace) PASS+=("$1") ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; echo; usage; exit 2 ;;
  esac
  shift
done
case "${SELFHUB_NONINTERACTIVE:-}" in 1|true|yes) INTERACTIVE=0 ;; esac
[ -t 0 ] || INTERACTIVE=0
# The API reads SELFHUB_CONFIG_DIR, the CLI SELFHUB_CONFIG_HOME: keep them pointing at one place.
if [ -n "${SELFHUB_CONFIG_HOME:-}" ]; then export SELFHUB_CONFIG_DIR="$SELFHUB_CONFIG_HOME"; fi

case "$(uname -s)" in
  Darwin) OS="mac" ;;
  Linux) if command -v apt-get >/dev/null 2>&1; then OS="apt"; elif command -v dnf >/dev/null 2>&1; then OS="dnf"; else OS="linux"; fi ;;
  MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
  *) OS="other" ;;
esac
case "$OS" in
  mac) OS_NAME="macOS" ;; apt) OS_NAME="Linux (Debian/Ubuntu)" ;; dnf) OS_NAME="Linux (Fedora/RHEL)" ;;
  linux) OS_NAME="Linux" ;; windows) OS_NAME="Windows" ;; *) OS_NAME="$(uname -s)" ;;
esac

ok()   { printf '  [ok]       %s\n' "$1"; }
bad()  { printf '  [missing]  %s\n' "$1"; }
note() { printf '  [note]     %s\n' "$1"; }
later(){ printf '  [skipped]  %s\n' "$1"; }

# version_at_least 20.9.0 22.11.0 -> true
version_at_least() {
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | head -n1)" = "$1" ]
}

ask_yes() {  # ask_yes "Question" -> default yes
  [ "$INTERACTIVE" = 1 ] || return 1
  local reply
  read -r -p "$1 [Y/n] " reply || return 1  # no answer at all (input closed) means no
  case "$reply" in n|N|no|No) return 1 ;; *) return 0 ;; esac
}

MISSING=()   # short descriptions, used in the AI prompt
FIXES=()     # what to do, one block per missing thing

install_step() {  # install_step <tool>: the exact command for this OS
  case "$1:$OS" in
    git:mac)      echo "xcode-select --install     (or, with Homebrew: brew install git)" ;;
    git:apt)      echo "sudo apt-get update && sudo apt-get install -y git" ;;
    git:dnf)      echo "sudo dnf install -y git" ;;
    git:windows)  echo "winget install --id Git.Git -e     (or download Git for Windows: https://git-scm.com/download/win)" ;;
    git:*)        echo "see https://git-scm.com/downloads" ;;
    gh:mac)       echo "brew install gh     (no Homebrew? download the installer: https://cli.github.com)" ;;
    gh:apt)       echo "sudo apt-get install -y gh     (if apt can't find it, follow https://github.com/cli/cli/blob/trunk/docs/install_linux.md)" ;;
    gh:dnf)       echo "sudo dnf install -y gh" ;;
    gh:windows)   echo "winget install --id GitHub.cli -e" ;;
    gh:*)         echo "see https://cli.github.com" ;;
    uv:windows)   echo "winget install --id astral-sh.uv -e" ;;
    uv:mac)       echo "brew install uv     (or: curl -LsSf https://astral.sh/uv/install.sh | sh)" ;;
    uv:*)         echo "curl -LsSf https://astral.sh/uv/install.sh | sh" ;;
    node:mac)     echo "brew install node     (or the installer from https://nodejs.org, LTS version)" ;;
    node:windows) echo "winget install --id OpenJS.NodeJS.LTS -e" ;;
    node:*)       echo "install the LTS version from https://nodejs.org/en/download (the apt/dnf package is often too old)" ;;
    pnpm:*)       echo "npm install -g pnpm@9.14.4" ;;
  esac
}

missing() {  # missing <tool> <line> <what it is>: a required tool
  bad "$2"
  MISSING+=("$2")
  FIXES+=("$2
    What it is: $3
    Install it: $(install_step "$1")")
}

GH_WHY="GitHub lets you back up your spaces and share them with your team. It's free.
You can skip this now: your spaces will stay only on this computer, and you can connect
GitHub later from the dashboard."
indent() { sed 's/^/    /'; }

echo
echo "SelfHub setup"
echo "This checks what SelfHub needs, installs it, and writes your settings."
echo "Computer: $OS_NAME. SelfHub folder: $ROOT"
echo
echo "Checking what's needed"

# a. git
if command -v git >/dev/null 2>&1; then
  ok "git $(git --version | awk '{print $3}')"
else
  missing git "git is not installed" "the tool that keeps the history of every space."
fi

# b. GitHub CLI and c. GitHub login: recommended, not required. Without them, spaces stay
# "Only on this computer" until the user connects GitHub.
logged_in() { gh auth status --hostname github.com >/dev/null 2>&1; }
HAVE_GH=0
GITHUB=0
if command -v gh >/dev/null 2>&1; then
  HAVE_GH=1
  ok "GitHub CLI (gh) $(gh --version | head -n1 | awk '{print $3}')"
  if logged_in; then
    GITHUB=1
  else
    later "Not logged in to GitHub"
    echo
    echo "$GH_WHY" | indent
    echo "    No account yet? Make one first: https://github.com/signup"
    echo "    To log in, your browser opens and you type a short code."
    echo
    if ask_yes "    Log in to GitHub now?"; then
      gh auth login --hostname github.com --git-protocol https --web
      echo
      logged_in && GITHUB=1
    fi
  fi
  [ "$GITHUB" = 1 ] && ok "logged in to GitHub as $(gh api user --jq .login 2>/dev/null || echo 'your account')"
else
  later "GitHub CLI (gh) is not installed, so GitHub isn't connected"
  echo
  echo "$GH_WHY" | indent
  echo "    How to install it and log in is at the end."
  echo
fi
if [ "$GITHUB" = 1 ]; then
  scopes="$(gh auth status --hostname github.com 2>&1 | grep -i 'token scopes' || true)"
  if [ -n "$scopes" ] && ! { echo "$scopes" | grep -q "'repo'" && echo "$scopes" | grep -q "'read:org'"; }; then
    note "your GitHub login can't read repos or teams yet. Fix: gh auth refresh -h github.com -s repo,read:org"
  fi
  [ -n "$OWNER" ] || OWNER="$(gh api user --jq .login 2>/dev/null || true)"
else
  PASS+=("--local-only")
fi

# d. uv and Python (pyproject.toml: requires-python >= 3.12)
HAVE_UV=0
if command -v uv >/dev/null 2>&1; then
  HAVE_UV=1
  ok "uv $(uv --version | awk '{print $2}')"
  if py="$(uv python find '>=3.12' 2>/dev/null)"; then
    ok "Python $("$py" -c 'import platform; print(platform.python_version())')"
  else
    note "Python 3.12 or newer not found. uv downloads it during the install below."
  fi
else
  missing uv "uv is not installed" "installs SelfHub's Python code and the Python version it needs."
fi

# e. Node.js and pnpm (dashboard/package.json: Next.js 16 needs Node >= 20.9, pnpm 9.14.4)
PNPM=()
if [ "$DASHBOARD" = 1 ]; then
  if command -v node >/dev/null 2>&1; then
    v="$(node -v | sed 's/^v//')"
    if version_at_least "$MIN_NODE" "$v"; then
      ok "Node.js $v"
      if command -v pnpm >/dev/null 2>&1; then
        PNPM=(pnpm); ok "pnpm $(pnpm --version)"
      elif command -v corepack >/dev/null 2>&1; then
        PNPM=(corepack pnpm); ok "pnpm (through corepack, which comes with Node.js)"
      else
        missing pnpm "pnpm is not installed" "installs the dashboard's code."
      fi
    else
      missing node "Node.js $v is too old (need $MIN_NODE or newer)" "runs the dashboard."
    fi
  else
    missing node "Node.js is not installed" "runs the dashboard."
  fi
fi

# ---------- fix steps and the Claude Code / Codex prompt ----------

github_fixes() {
  if [ "$HAVE_GH" = 0 ]; then
    echo
    echo "  - GitHub CLI (gh) is not installed"
    echo "    What it's for: backing up your spaces and sharing them with your team."
    echo "    Install it: $(install_step gh)"
  fi
  echo
  echo "  - Not logged in to GitHub"
  echo "    What it's for: backing up your spaces and sharing them with your team."
  echo "    No account yet? Make a free one: https://github.com/signup"
  echo "    Log in: gh auth login --hostname github.com --git-protocol https --web"
}

ai_prompt() {
  echo "Prefer to have an AI assistant do it? Open Claude Code or Codex, paste everything"
  echo "between the two lines below, and press Enter."
  echo
  echo "------------------------------ copy from here ------------------------------"
  echo "I'm setting up SelfHub on my computer ($OS_NAME). I've never used a terminal, so"
  echo "please run the commands for me, and before each one tell me in one plain sentence"
  echo "what it does. If you need my password or a click in my browser, tell me exactly"
  echo "what to do and wait for me."
  echo
  echo "SelfHub's setup check found these things to fix:"
  for m in ${MISSING[@]+"${MISSING[@]}"}; do echo "- $m"; done
  if [ "$GITHUB" = 0 ]; then
    [ "$HAVE_GH" = 0 ] && echo "- The GitHub CLI (gh) is not installed"
    echo "- I'm not logged in to GitHub"
  fi
  echo
  echo "Please:"
  n=1
  if [ ${#MISSING[@]} -gt 0 ] || [ "$HAVE_GH" = 0 ]; then
    echo "$n. Install whatever is missing above, using the normal installer for $OS_NAME."; n=$((n + 1))
  fi
  if [ "$GITHUB" = 0 ]; then
    echo "$n. Ask me if I have a GitHub account. If I don't, help me make a free one at"
    echo "   https://github.com/signup and wait while I finish it in my browser."; n=$((n + 1))
    echo "$n. Log me in to GitHub with the GitHub CLI (gh) by running:"
    echo "   gh auth login --hostname github.com --git-protocol https --web"
    echo "   Tell me the one-time code to type in the browser page it opens."; n=$((n + 1))
  fi
  echo "$n. Run SelfHub's setup again with this exact command:"
  echo "   $SETUP_CMD"; n=$((n + 1))
  echo "$n. If it reports another problem, fix it the same way and run it again until it"
  echo "   says \"SelfHub is set up\" with nothing left to fix. Answer its questions with me."
  echo "Don't create any GitHub repositories and don't edit files in the SelfHub folder."
  echo "------------------------------- copy to here -------------------------------"
  echo
}

# A required tool is missing: say how to fix it, then stop.
if [ ${#MISSING[@]} -gt 0 ]; then
  echo
  echo "Setup can't continue yet. Here's how to fix each item."
  echo "(A terminal command is a line you paste into the Terminal app and run with Enter.)"
  for fix in "${FIXES[@]}"; do
    echo
    echo "  - $fix"
  done
  if [ "$GITHUB" = 0 ]; then
    echo
    echo "Optional, while you're at it: connect GitHub."
    github_fixes
  fi
  echo
  echo "Then run setup again:"
  echo "    $SETUP_CMD"
  echo
  ai_prompt
  exit 1
fi

# ---------- install ----------

if [ "$INSTALL" = 1 ]; then
  echo
  echo "Installing SelfHub (this can take a few minutes the first time)"
  (cd "$ROOT" && uv sync --all-packages) || { echo "  The Python install failed (uv sync). The error is above."; exit 1; }
  ok "Python packages"
  if [ "$DASHBOARD" = 1 ]; then
    (cd "$ROOT/dashboard" && "${PNPM[@]}" install) || { echo "  The dashboard install failed (pnpm install). The error is above."; exit 1; }
    ok "dashboard packages"
  fi
else
  note "skipped installing (--skip-install)"
fi

# ---------- settings and spaces ----------

echo
echo "Writing your settings"
[ -n "$OWNER" ] && PASS+=("--github-owner" "$OWNER")
(cd "$ROOT" && uv run --no-sync python -m selfhub_cli.onboarding ${PASS[@]+"${PASS[@]}"}) || {
  echo
  echo "Setup stopped at the step above. Fix what it says, then run: $SETUP_CMD"
  exit 1
}

CONFIG_ENV=""
[ -n "${SELFHUB_CONFIG_DIR:-}" ] && CONFIG_ENV="SELFHUB_CONFIG_DIR=\"$SELFHUB_CONFIG_DIR\" "
echo
echo "SelfHub is set up."
if [ "$GITHUB" = 0 ]; then
  echo "GitHub isn't connected, so your spaces are only on this computer for now."
fi
echo
echo "To open the dashboard, run these in two Terminal windows:"
echo "    cd \"$ROOT\" && ${CONFIG_ENV}SELFHUB_API_PORT=8788 uv run selfhub-api"
if [ "$DASHBOARD" = 1 ]; then
  echo "    cd \"$ROOT/dashboard\" && NEXT_PUBLIC_SELFHUB_API=http ${PNPM[*]:-pnpm} dev"
  echo "Then open http://localhost:3000"
fi
echo "Running setup again is safe: it keeps everything that's already set up."

if [ "$GITHUB" = 0 ]; then
  echo
  echo "Optional: connect GitHub later"
  echo
  echo "$GH_WHY" | indent
  github_fixes
  echo
  echo "Then run setup again, or connect a space from the dashboard:"
  echo "    $SETUP_CMD"
  echo
  ai_prompt
fi
exit 0
