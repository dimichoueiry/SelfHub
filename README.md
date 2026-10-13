https://github.com/user-attachments/assets/0bb198b5-0b00-4956-ac9e-37938251810f

_Once upon a time, personal context was scattered across a thousand chat windows and AI providers: half-remembered preferences, lost goals, forgotten life events, fragments of identity trapped behind product walls. Each new model asked the same questions like it had never met me before, and I kept reintroducing myself to machines that claimed to be intelligent. This era has to end. If AI is going to move from chatbot to true assistant, it needs a memory layer that is portable, inspectable, editable, and owned by the person it represents, not by the platform that captured it. I built SelfHub to close that gap, not for one model, but for AI as a whole. This repo is where it began.
— @dimichoueiry, March 2026 (writing style totally inspired by: @karpathy)_

# SelfHub

SelfHub is a CLI-first personal memory system.

It helps you own your identity data in plain Markdown files inside a Git repo you control. You can save, read, search, recall, delete, and sync personal knowledge with full version history.

## Recommendation (Current Best Experience)

For now, while SelfHub's native agent architecture is still being strengthened, the best experience is to pair SelfHub CLI with coding agents that can run terminal commands and tools (for example: Codex, Claude Code, Cursor, and OpenCode).

If SelfHub is installed and available on `PATH`, these agents can call `selfhub` commands directly to save, retrieve, and manage memory.

## What You Can Do Today

- Onboard with a guided setup wizard (`selfhub setup`)
- Save memory into structured or custom Markdown paths (`selfhub save`)
- Read any memory file or folder (`selfhub read`)
- Search and recall with lexical + semantic retrieval (`selfhub search`, `selfhub recall`)
- Delete bad saved entries (`selfhub delete`)
- Sync to GitHub with normal git history (`selfhub sync`)
- Use an interactive console with command/chat modes (`selfhub console`)

## Install And Run

Quick start: one command. It checks git, uv, Python and Node.js, tells you how to get
anything missing (or gives you a prompt to paste into Claude Code or Codex), installs SelfHub
and writes all its settings. GitHub (the GitHub CLI and a free account) is optional: without
it, your spaces stay only on this computer until you connect GitHub. You never create a config
file by hand. See [SETUP.md](SETUP.md).

```bash
git clone https://github.com/dimichoueiry/SelfHub.git
bash SelfHub/scripts/setup.sh
```

Manual install, if you prefer. Requirements:

- Python 3.12+
- [uv](https://docs.astral.sh/uv/)
- Git

Option A: Run from source (recommended for now)

```bash
git clone https://github.com/dimichoueiry/SelfHub.git
cd SelfHub
uv venv
source .venv/bin/activate
uv sync --all-packages
uv run selfhub --help
```

Option B: Install as a local uv tool after cloning

```bash
cd SelfHub
uv tool install --force --editable packages/selfhub-cli --with-editable packages/selfhub-core
selfhub --help
```

## First-Time Setup

Run the onboarding wizard:

```bash
selfhub setup
```

The wizard configures:

- local repo path
- local/remote/GitHub repo wiring
- thinking model (save classification and dedupe)
- chat model (`/chat` mode in console)
- key storage for GitHub/OpenRouter credentials when keychain is available

## Core Commands

```bash
selfhub init
selfhub setup
selfhub save "I am building SelfHub"
selfhub save --file preferences/coding-workflow.md "I like small, frequent commits."
selfhub read
selfhub read experiences/career.md
selfhub search "what do i do for work?" --mode hybrid
selfhub recall "what do you know about me?"
selfhub delete --file experiences/career.md --contains "wrong text"
selfhub sync
selfhub log --file experiences/career.md
```

## Console Mode

Start:

```bash
selfhub console
```

In console:

- command mode accepts normal commands (`read`, `save`, `delete`, `search`, `recall`, `status`, ...)
- `/chat` enters chat mode
- `/unchat` returns to command mode
- `/save <content>` saves immediately in chat mode
- `/save --file <path> <content>` saves to a specific file in chat mode
- `/tools` lists available CLI/slash tools
- `/exit` exits console

## Retrieval And Model Configuration

Thinking model overrides:

```bash
export SELFHUB_THINKING_PROVIDER=openrouter
export SELFHUB_THINKING_MODEL=anthropic/claude-3.5-haiku
export OPENROUTER_API_KEY=...
```

Chat model overrides:

```bash
export SELFHUB_CHAT_PROVIDER=ollama
export SELFHUB_CHAT_MODEL=qwen2.5:14b
export OLLAMA_BASE_URL=http://localhost:11434
```

Semantic embedding overrides (`search --mode semantic|hybrid`, `recall`):

```bash
export SELFHUB_EMBEDDING_PROVIDER=openrouter   # or ollama
export SELFHUB_EMBEDDING_MODEL=openai/text-embedding-3-small
```

Notes:

- If embedding vars are not set, SelfHub falls back to thinking/chat defaults.
- OpenRouter embeddings require `OPENROUTER_API_KEY`.
- Ollama embedding default is `nomic-embed-text`.

## Agent Integration

List tools and usage hints:

```bash
selfhub tools
```

Generate a strict agent spec:

```bash
selfhub agent-spec
selfhub agent-spec --json
```

## Company Brain (Spaces)

SelfHub can also serve a 5-50 person team. Next to your personal repo, connect **org**,
**team** and **client** spaces. Each one is its own git repo, and GitHub controls who can
access it.

```bash
selfhub space create ~/spaces/northline --name Northline --kind org --owner @northline/admins
selfhub space add git@github.com:northline/client-apex.git
selfhub context "Facebook ad for Apex spring promo, follow my ads SOP"
selfhub learn "Never use urgency phrasing." --space apex --why "too pushy"
selfhub rules approve <rule-id> --space apex
selfhub policy enable cite-sources
```

- Locked paths are loaded first on every task and are never written by SelfHub. On GitHub,
  CODEOWNERS and branch protection make the lock apply to people too.
- A client's memory loads only when the task names that client.
- Feedback becomes a rule, a human approves it, and it is loaded from then on.
- Org spaces send changes through pull requests by default.

Full guide: [`docs/company-brain.md`](docs/company-brain.md).

## Development

```bash
uv sync --group dev --all-packages
uv run pre-commit install
uv run pytest
uv run ruff check .
uv run mypy packages tests
```
