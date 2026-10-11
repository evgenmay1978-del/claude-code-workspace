#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run this script as your normal owner account; it will request sudo only for system packages and Docker operations." >&2
  exit 1
fi
if [[ ! -f /etc/os-release ]]; then
  echo "Cannot identify this operating system; supported target: Ubuntu 22.04, 24.04 or 26.04 LTS." >&2
  exit 1
fi
# shellcheck disable=SC1091
. /etc/os-release
UBUNTU_SUITE="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
case "${ID:-}" in
  ubuntu) ;;
  *) echo "This installer supports Ubuntu only (detected: ${PRETTY_NAME:-unknown})." >&2; exit 1 ;;
esac
case "$UBUNTU_SUITE" in
  jammy|noble|resolute) ;;
  *) echo "Unsupported Ubuntu release '$UBUNTU_SUITE'. Supported LTS releases: 22.04, 24.04 and 26.04." >&2; exit 1 ;;
esac
case "$(dpkg --print-architecture)" in
  amd64|arm64) ;;
  *) echo "Unsupported architecture for this app installer: $(dpkg --print-architecture). Use amd64 or arm64." >&2; exit 1 ;;
esac

if [[ ! -f Dockerfile || ! -f docker-compose.yml || ! -f scripts/setup.sh ]]; then
  echo "Run this from a complete Polar Workspace checkout containing Dockerfile and docker-compose.yml." >&2
  exit 1
fi
if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required. Run as a non-root Ubuntu owner account with sudo privileges." >&2
  exit 1
fi
sudo -v

DOCKER_READY=0
if command -v docker >/dev/null 2>&1; then
  if sudo docker info >/dev/null 2>&1 && sudo docker compose version >/dev/null 2>&1; then
    DOCKER_READY=1
  else
    # An existing package may only need its daemon started; never remove packages automatically.
    sudo systemctl enable --now docker >/dev/null 2>&1 || true
    if sudo docker info >/dev/null 2>&1 && sudo docker compose version >/dev/null 2>&1; then
      DOCKER_READY=1
    fi
  fi
fi

if [[ "$DOCKER_READY" -eq 0 ]]; then
  read -r -p "Docker Engine/Compose is not ready. Install from Docker's official Ubuntu apt repository? [Y/n] " answer
  case "${answer,,}" in
    n|no) echo "No system changes made. Install Docker Engine and Compose v2, then rerun this script." >&2; exit 1 ;;
  esac

  conflicts=()
  for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
    status="$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || true)"
    if [[ "$status" == installed ]]; then conflicts+=("$package"); fi
  done
  if (( ${#conflicts[@]} > 0 )); then
    printf 'Conflicting installed packages were found: %s\n' "${conflicts[*]}" >&2
    echo "No packages were removed. Review Docker's official Ubuntu installation instructions, resolve conflicts deliberately, then rerun." >&2
    exit 1
  fi

  sudo apt-get update
  sudo apt-get install -y ca-certificates curl
  key_file="$(mktemp)"
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o "$key_file"
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo install -m 0644 "$key_file" /etc/apt/keyrings/docker.asc
  rm -f "$key_file"
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  arch="$(dpkg --print-architecture)"
  source_file="$(mktemp)"
  cat > "$source_file" <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $UBUNTU_SUITE
Components: stable
Architectures: $arch
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  sudo install -m 0644 "$source_file" /etc/apt/sources.list.d/docker.sources
  rm -f "$source_file"
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo systemctl enable --now docker
fi

if ! sudo docker info >/dev/null 2>&1 || ! sudo docker compose version >/dev/null 2>&1; then
  echo "Docker Engine or Compose v2 is still unavailable. No app containers were started." >&2
  exit 1
fi

echo
echo "Docker Engine and Compose v2 are ready."
echo "Before continuing, ensure the DNS A record points to this VM and the provider firewall permits inbound TCP 80 and 443."
echo "Docker-published ports may bypass UFW rules; this installer does not change host or provider firewall rules."
echo "The app's only public service is Caddy on 80/443; the owner creates the VM and DNS record."
echo
exec "$ROOT_DIR/scripts/setup.sh"
