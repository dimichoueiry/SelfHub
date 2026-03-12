# SelfHub Architecture (Initial)

This repository follows a CLI-first layered architecture:

1. Local git clone (source of truth)
2. `selfhub-cli`
3. App / extension / MCP / API layers built above CLI

## Python Package Boundaries

- `selfhub-core`
  - domain constants
  - command I/O contracts
  - reusable logic (classification, search, git orchestration)
- `selfhub-cli`
  - CLI UX, argument parsing, command routing
  - output formatting (`human`, `json`)

This split keeps business logic decoupled from interface concerns and makes testing faster and cleaner.
