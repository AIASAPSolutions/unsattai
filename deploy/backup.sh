#!/usr/bin/env bash
# Safe online backup of the UrJersey database (works while the API is running).
# Keeps 14 daily copies in ./backups. Add to cron: 30 2 * * * /opt/urjersey/deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
stamp=$(date -u +%Y%m%d-%H%M%S)
docker compose exec -T api python - <<'PY'
import sqlite3
src = sqlite3.connect("/data/urjersey.db")
dst = sqlite3.connect("/data/backup.db")
src.backup(dst)
dst.close(); src.close()
PY
docker compose cp api:/data/backup.db "backups/urjersey-$stamp.db"
docker compose exec -T api rm -f /data/backup.db
gzip -f "backups/urjersey-$stamp.db"
ls -1t backups/urjersey-*.db.gz | tail -n +15 | xargs -r rm -f
echo "backup: backups/urjersey-$stamp.db.gz"
# Optional off-site copy (recommended): e.g. rclone copy backups remote:urjersey-backups
