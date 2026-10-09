#!/bin/sh
# Дымовой тест: поднимает сервер с фейковым CLI на временных данных и прогоняет API-проверки.
# Запуск: npm run test:api
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${SMOKE_PORT:-8799}"
TMP="$(mktemp -d)"
cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

DATA_DIR="$TMP/data" WORKSPACES_DIR="$TMP/ws" CLAUDE_BIN="$ROOT/server/test/fake-claude.sh" HOST=127.0.0.1 PORT="$PORT" node "$ROOT/server/index.mjs" >"$TMP/server.log" 2>&1 &
SERVER_PID=$!

i=0
while [ "$i" -lt 40 ]; do
  if node -e "fetch('http://127.0.0.1:$PORT/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then break; fi
  i=$((i+1))
  sleep 0.25
done

set +e
BASE="http://127.0.0.1:$PORT" node "$ROOT/server/test/api.mjs"
STATUS=$?
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
exit $STATUS
