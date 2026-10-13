#!/usr/bin/env bash
# Live QA: fresh demo seed -> selfhub-api on :8788 -> dashboard (http mode) on :3200 -> Playwright.
# Never touches :8787 (AgentGrid). Stops what it started on exit.
set -euo pipefail
DASH="$(cd "$(dirname "$0")/../.." && pwd)"
REPO="$(cd "$DASH/.." && pwd)"
API_PORT="${SELFHUB_API_PORT:-8788}"
WEB_PORT="${QA_WEB_PORT:-3200}"
SEED="$(mktemp -d "${TMPDIR:-/tmp}/selfhub-live.XXXXXX")"
EXTRA="$(mktemp -d "${TMPDIR:-/tmp}/selfhub-extra.XXXXXX")"
for port in "$API_PORT" "$WEB_PORT"; do
  if lsof -nP -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Stop that process first (this script never kills what it didn't start)." >&2
    exit 1
  fi
done

pids=()
cleanup() {
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  # `uv run` and `pnpm` spawn children; stop whatever now listens on the ports we started.
  for port in "$API_PORT" "$WEB_PORT"; do
    lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
  done
}
trap cleanup EXIT

(cd "$REPO" && uv run python scripts/seed_demo.py "$SEED" >/dev/null)
(cd "$REPO" && SELFHUB_DEMO=1 SELFHUB_CONFIG_DIR="$SEED" SELFHUB_API_PORT="$API_PORT" uv run selfhub-api >"$SEED/api.log" 2>&1) &
pids+=($!)

cd "$DASH"
export NEXT_DIST_DIR=.next-live NEXT_PUBLIC_SELFHUB_API=http NEXT_PUBLIC_SELFHUB_API_URL="http://localhost:$API_PORT"
[ "${SKIP_BUILD:-}" = 1 ] || pnpm build >/dev/null
pnpm exec next start -p "$WEB_PORT" >"$SEED/web.log" 2>&1 &
pids+=($!)

for _ in $(seq 60); do curl -sf "http://localhost:$API_PORT/api/health" >/dev/null && curl -sf "http://localhost:$WEB_PORT" >/dev/null && break; sleep 1; done

QA_API_URL="http://localhost:$API_PORT/api" QA_EXTRA_DIR="$EXTRA" QA_BASE_URL="http://localhost:$WEB_PORT" \
  pnpm exec playwright test -c playwright.live.config.ts "$@"
