# SelfHub dashboard

The company-brain dashboard: spaces, files, sync, people and rules. Design brief and token
decisions: `../docs/dashboard-design-brief.md`.

## Run

```bash
pnpm install
pnpm dev                 # http://localhost:3000, in-browser mock data (Northline)
```

Use the real API instead of the mock (port 8787 is reserved for AgentGrid locally, so the
dashboard defaults to 8788):

```bash
# from the repo root
uv run python scripts/seed_demo.py /tmp/selfhub-demo
SELFHUB_DEMO=1 SELFHUB_CONFIG_DIR=/tmp/selfhub-demo SELFHUB_API_PORT=8788 uv run selfhub-api

# in dashboard/
NEXT_PUBLIC_SELFHUB_API=http NEXT_PUBLIC_SELFHUB_API_URL=http://localhost:8788 pnpm dev
```

The browser calls same-origin `/selfhub-api/*` and Next proxies it to
`NEXT_PUBLIC_SELFHUB_API_URL`, so the API's CORS list doesn't matter. In demo mode the user
menu switches between Sam and Maya by sending `X-SelfHub-User: sam-okafor | maya-chen`.

In the mock, the user menu switches between Sam (ads specialist) and Maya (admin), and can
force a conflict on the next save. Reloading resets the sample data.

## Checks

```bash
pnpm lint
pnpm build
pnpm exec playwright install chromium   # once
pnpm qa                                 # mock journeys + screenshots, serves the build on :3100
pnpm qa:live                            # live: fresh seed, API on :8788, http build on :3200
```

`pnpm qa:live` (`qa/live/run.sh`) seeds a new demo company, starts the API and an http-mode
build (in `.next-live`), runs `qa/live/*.spec.ts`, and stops both. It refuses to start if
:8788 or :3200 is busy. `SKIP_BUILD=1` reuses the last live build.

Screenshots: mock in `qa/screenshots/{1440,1024,390}-{light,dark}/` and `qa/screenshots/journeys/`;
live in `qa/screenshots-live/{1440,390}-light/` and `qa/screenshots-live/journeys/`.

## Layout

- `src/lib/api/` — contract types, `client.ts` (adapter switch), `http.ts`, `mock/` (seed data + adapter)
- `src/lib/queries.ts` — TanStack Query hooks
- `src/components/shell/` — sidebar, user menu, ⌘K palette
- `src/components/explorer/` — tree, editor, history, file dialogs
- `src/app/` — Home, `spaces/[spaceId]` (Files, History, Members, Settings), People, Rules, Settings
