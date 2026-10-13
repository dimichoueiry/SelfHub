#!/usr/bin/env bash
# Restart only my API on 8788 with a fresh demo seed. Never touches 8787.
# Runs from the SelfHub folder this script is in, never another checkout.
cd "$(dirname "$0")/../../.." || exit 1
lsof -nP -tiTCP:8788 -sTCP:LISTEN | xargs kill 2>/dev/null; sleep 1
SEED=/tmp/selfhub-qa-re-$RANDOM$RANDOM; echo $SEED > dashboard/qa/independent/.seed
uv run python scripts/seed_demo.py $SEED >/dev/null
(SELFHUB_DEMO=1 SELFHUB_CONFIG_DIR=$SEED SELFHUB_API_PORT=8788 nohup uv run selfhub-api >> dashboard/qa/independent/api.log 2>&1 &)
for i in $(seq 20); do curl -sf localhost:8788/api/health >/dev/null && break; sleep 1; done; echo "seed $SEED"
