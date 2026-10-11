#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    DOCKER=(sudo docker)
  else
    echo "The Docker daemon is not available to this account (even through sudo)." >&2
    exit 1
  fi
fi
if ! "${DOCKER[@]}" compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required (docker compose)." >&2
  exit 1
fi
if ! "${DOCKER[@]}" compose ps --status running --services | grep -qx 'polar-app'; then
  echo "The polar-app service must be running to create a database snapshot." >&2
  exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
container_archive="/tmp/polar-backup-$stamp.tar.gz"
target="${1:-$ROOT_DIR/backups/polar-$stamp.tar.gz}"
mkdir -p "$(dirname -- "$target")"
target="$(realpath -m -- "$target")"
cleanup() {
  "${DOCKER[@]}" compose exec -T polar-app rm -f "$container_archive" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"${DOCKER[@]}" compose exec -T -e "BACKUP_ARCHIVE=$container_archive" polar-app node /app/scripts/backup-data.mjs
"${DOCKER[@]}" compose cp "polar-app:$container_archive" "$target"
chmod 600 "$target"
echo "Encrypted-storage note: this archive contains local chat history, project files, attachments and CLI login configuration. Store it privately and encrypt it before sending it off-server."
echo "Backup saved to $target"
