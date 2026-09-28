#!/usr/bin/env bash
# Start a throw-away API (port 8200, its own database) and the built ops app (port 5200),
# run the end-to-end flow, then stop both. Usage: npm run e2e:full
set -euo pipefail
cd "$(dirname "$0")/.."
OPS_DIR=$(pwd)
SERVER_DIR="$OPS_DIR/../server"
API_PORT=${API_PORT:-8200}
OPS_PORT=${OPS_PORT:-5200}
DB=${E2E_DB:-/tmp/uj-ops-e2e.db}
export ADMIN_EMAIL=${ADMIN_EMAIL:-admin@urjersey.test}
export ADMIN_PASSWORD=${ADMIN_PASSWORD:-Adm1nPassword!}

rm -f "$DB"
( cd "$SERVER_DIR" && DB_PATH="$DB" DESIGN_PROVIDER=rule AI_EDITS=off exec .venv/bin/uvicorn app.main:app --port "$API_PORT" > /tmp/uj-ops-api.log 2>&1 ) &
API_PID=$!
VITE_API_BASE_URL="http://127.0.0.1:$API_PORT" VITE_WEB_STORE_URL="http://127.0.0.1:3000" npx vite build --logLevel warn
./node_modules/.bin/vite preview --port "$OPS_PORT" --strictPort > /tmp/uj-ops-preview.log 2>&1 &
PREVIEW_PID=$!
cleanup() { kill "$PREVIEW_PID" "$API_PID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null && break; sleep 0.5; done
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$OPS_PORT/" >/dev/null && break; sleep 0.5; done

API_URL="http://127.0.0.1:$API_PORT" OPS_URL="http://127.0.0.1:$OPS_PORT" NODE_PATH="${NODE_PATH:-$(npm root -g)}" node e2e/ops-flow.mjs
