#!/usr/bin/env bash
# Restore a backup made by backup.sh:  ./restore.sh backups/urjersey-YYYYMMDD-HHMMSS.db.gz
# The current database is saved first as backups/before-restore-<time>.db.gz.
set -euo pipefail
cd "$(dirname "$0")"
file=${1:?usage: ./restore.sh backups/urjersey-....db.gz}
tmp=$(mktemp)
trap 'rm -f "$tmp"; docker compose up -d' EXIT   # the apps always come back, even if a step fails
gunzip -c "$file" > "$tmp"
chmod 644 "$tmp"
# Refuse a damaged file before touching the live database.
docker compose run --rm --no-deps -T -v "$tmp:/check.db:ro" --entrypoint python api -c \
  "import sqlite3; r = sqlite3.connect('file:/check.db?mode=ro', uri=True).execute('pragma integrity_check').fetchone()[0]; assert r == 'ok', r"
./backup.sh >/dev/null
mv "$(ls -1t backups/urjersey-*.db.gz | head -1)" "backups/before-restore-$(date -u +%Y%m%d-%H%M%S).db.gz"
docker compose stop api web
docker compose run --rm --no-deps -T --user 0 -v "$tmp:/restore.db:ro" --entrypoint sh api \
  -c 'cp /restore.db /data/urjersey.db && rm -f /data/urjersey.db-wal /data/urjersey.db-shm && chown -R 10001:10001 /data'
echo "restored $file"
