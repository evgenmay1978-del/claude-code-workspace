#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
archive="${1:-}"
if [[ -z "$archive" || ! -f "$archive" ]]; then
  echo "Usage: $0 /path/to/polar-backup-YYYYMMDDTHHMMSSZ.tar.gz" >&2
  exit 2
fi
archive="$(realpath -- "$archive")"
listing="$(tar -tzf "$archive")"
if ! grep -qE '^\./data/claude-workspace\.sqlite$' <<<"$listing" \
  || ! grep -qE '^\./workspaces(/|$)' <<<"$listing" \
  || ! grep -qE '^\./claude-config(/|$)' <<<"$listing"; then
  echo "The archive does not have the expected Polar Workspace backup layout." >&2
  exit 1
fi
if grep -qE '(^/|(^|/)\.\.(/|$))' <<<"$listing"; then
  echo "The archive contains an unsafe absolute or parent-traversal path; refusing to restore." >&2
  exit 1
fi

echo "WARNING: restoring replaces the existing database, workspace files and Claude CLI configuration."
read -r -p "Type RESTORE to continue: " confirmation
if [[ "$confirmation" != "RESTORE" ]]; then
  echo "Restore cancelled; no data changed."
  exit 0
fi

echo "Stopping the app before replacing persistent data..."
docker compose stop polar-app

docker compose run --rm -T --no-deps \
  -v "$archive:/restore/polar-backup.tar.gz:ro" \
  --entrypoint /bin/sh polar-app -c '
    set -eu
    mkdir -p /tmp/polar-restore/data /tmp/polar-restore/workspaces /tmp/polar-restore/claude-config
    tar --extract --gzip --file /restore/polar-backup.tar.gz --directory /tmp/polar-restore --no-same-owner --no-same-permissions
    for directory in data workspaces claude-config; do
      find "/$directory" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
      cp -a "/tmp/polar-restore/$directory/." "/$directory/"
    done
    chown -R 10001:10001 /data /workspaces /claude-config
  '

docker compose up -d --no-deps polar-app
echo "Restore finished. Check service health with: docker compose ps"
