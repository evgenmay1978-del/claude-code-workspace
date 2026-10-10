#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
if ! docker compose ps --status running --services | grep -qx 'polar-app'; then
  echo "The polar-app service must be running to create a database snapshot." >&2
  exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
container_archive="/tmp/polar-backup-$stamp.tar.gz"
target="${1:-$ROOT_DIR/backups/polar-$stamp.tar.gz}"
mkdir -p "$(dirname -- "$target")"
target="$(realpath -m -- "$target")"
cleanup() {
  docker compose exec -T polar-app rm -f "$container_archive" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose exec -T -e "BACKUP_ARCHIVE=$container_archive" polar-app node /app/scripts/backup-data.mjs
docker compose cp "polar-app:$container_archive" "$target"
chmod 600 "$target"
echo "Encrypted-storage note: this archive contains local chat history, project files, attachments and CLI login configuration. Store it privately and encrypt it before sending it off-server."
echo "Backup saved to $target"
