#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Run ./scripts/install-ubuntu.sh on Ubuntu, or install Docker Engine and Compose v2, then rerun this script." >&2
  exit 1
fi

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    DOCKER=(sudo docker)
  else
    echo "The Docker daemon is not available to this account (even through sudo). Start Docker Engine, then rerun this script." >&2
    exit 1
  fi
fi
if ! "${DOCKER[@]}" compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required (docker compose)." >&2
  exit 1
fi
if [[ -e .env ]]; then
  echo ".env already exists; it was left unchanged. Edit it deliberately, then run: sudo docker compose up -d --build" >&2
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

"${DOCKER[@]}" compose config --quiet
echo
echo "Building the app and starting Caddy. Ensure inbound TCP ports 80 and 443 (and UDP 443 for HTTP/3) are open."
"${DOCKER[@]}" compose up -d --build
echo
echo "Setup started. Open https://$domain after the containers become healthy."
echo "Create the single local owner account, then open the in-app Terminal and run: claude"
echo "Complete the official Claude Code CLI login there; this app never collects CLI credentials."
