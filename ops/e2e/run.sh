#!/usr/bin/env bash
# Start a throw-away API (port 8200, its own database) and the built ops app (port 5200),
# run the end-to-end flow, then stop both. Usage: npm run e2e:full
set -euo pipefail
cd "$(dirname "$0")/.."
OPS_DIR=$(pwd)
SERVER_DIR="$OPS_DIR/../server"
API_PORT=${API_PORT:-8200}
OPS_PORT=${OPS_PORT:-5200}
DB=${E2E_DB:-/tmp/unsattai-ops-e2e.db}
export ADMIN_EMAIL=${ADMIN_EMAIL:-admin@unsattai.test}
export ADMIN_PASSWORD=${ADMIN_PASSWORD:-Adm1nPassword!}

rm -f "$DB"
# Windows virtual environments keep their programs in Scripts/ instead of bin/.
UVICORN=.venv/bin/uvicorn
[ -x "$SERVER_DIR/$UVICORN" ] || UVICORN=.venv/Scripts/uvicorn.exe
( cd "$SERVER_DIR" && DB_PATH="$DB" DESIGN_PROVIDER=rule AI_EDITS=off exec "$UVICORN" app.main:app --port "$API_PORT" > /tmp/unsattai-ops-api.log 2>&1 ) &
API_PID=$!
VITE_API_BASE_URL="http://127.0.0.1:$API_PORT" VITE_WEB_STORE_URL="http://127.0.0.1:3000" npx vite build --logLevel warn
./node_modules/.bin/vite preview --host 127.0.0.1 --port "$OPS_PORT" --strictPort > /tmp/unsattai-ops-preview.log 2>&1 &
PREVIEW_PID=$!
cleanup() { kill "$PREVIEW_PID" "$API_PID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null && break; sleep 0.5; done
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$OPS_PORT/" >/dev/null && break; sleep 0.5; done

API_URL="http://127.0.0.1:$API_PORT" OPS_URL="http://127.0.0.1:$OPS_PORT" node e2e/ops-flow.mjs
