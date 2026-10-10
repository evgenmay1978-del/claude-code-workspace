#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine and the Compose v2 plugin, then rerun this script." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required (docker compose)." >&2
  exit 1
fi
if [[ -e .env ]]; then
  echo ".env already exists; it was left unchanged. Edit it deliberately, then run: docker compose up -d --build" >&2
  exit 1
fi

read -r -p "Public domain for this workspace (DNS must point here): " domain
domain="${domain,,}"
if ! [[ "$domain" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
  echo "Enter a fully qualified public domain name, for example workspace.example.com." >&2
  exit 1
fi

cp .env.example .env
sed -i "s|^POLAR_DOMAIN=.*$|POLAR_DOMAIN=$domain|" .env
sed -i "s|^PUBLIC_ORIGIN=.*$|PUBLIC_ORIGIN=https://$domain|" .env
chmod 600 .env

docker compose config --quiet
echo
echo "Building the app and starting Caddy. Ensure inbound TCP ports 80 and 443 (and UDP 443 for HTTP/3) are open."
docker compose up -d --build
echo
echo "Setup started. Open https://$domain after the containers become healthy."
echo "Create the single local owner account, then open the in-app Terminal and run: claude"
echo "Complete the official Claude Code CLI login there; this app never collects CLI credentials."
