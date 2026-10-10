# Polar Workspace

A private, single-owner web workspace for Claude Code. It combines project conversations, local chat history, project files, Git status/diff/staging/commit, private attachments, and a real PTY terminal in a responsive desktop/mobile PWA.

> **Коротко по-русски.** Приватное self-hosted веб-приложение «Polar Workspace»: чаты, проекты,
> файлы, Git и настоящий терминал в браузере. Все запросы уходят в **официальный Claude Code CLI**
> по подписке — без API-ключей, SDK и посредников. Ставится на свой Linux-VPS через Docker Compose
> и Caddy: `./scripts/setup.sh` → откройте `https://ваш-домен` → создайте владельца → в проекте
> откройте **Терминал** и выполните `claude`, чтобы пройти официальный вход. Подробности ниже.

> **Not an Anthropic product.** This project launches the unmodified official Claude Code CLI. It does not use the Anthropic Messages API, an Anthropic SDK, an API key, or a proxy. It is designed for the server owner’s personal workspace only. Do not expose it as a multi-user service or route your subscription credentials/usage for other people. Review Anthropic’s current [Claude Code Legal & Compliance](https://docs.anthropic.com/en/docs/claude-code/legal-and-compliance) and plan terms before use.

The application has its own local history and project data. It does **not** sync with Claude.ai chats, account settings, plan usage, or limits. Requests run only after the owner sends them and consume whatever limits apply to the owner’s official Claude Code login.

## Features

- Russian-language responsive interface with desktop workspace panels and touch-first mobile navigation.
- Installable PWA; private chats, files, terminal output, and login data are not placed in a public service-worker cache.
- Single-owner password setup, authenticated application sessions, CSRF protection, login rate limiting, and private API/WebSocket routes.
- Persistent SQLite project/session/message history and project-local workspace files.
- Chat streaming and resumable Claude Code sessions through the official CLI.
- A real terminal running in the selected project directory, plus local Git status, diff, stage/unstage, and commit tools.
- Private project attachments stored within the corresponding workspace.
- Docker Compose, Caddy-managed HTTPS, persistent volumes, a health check, and backup/restore scripts.

## Requirements

- A Linux VPS with Docker Engine and the Docker Compose v2 plugin (`docker compose`). Claude Code documents a 4 GB RAM minimum; allow additional memory for the web app, native dependencies, and active coding sessions.
- A public DNS name with an `A` record (and an `AAAA` record only if IPv6 is routed to the VPS).
- Inbound TCP ports **80** and **443** open. UDP 443 is optional and enables HTTP/3.
- An official Claude Code login owned by the one person using this private installation, with a plan and region supported by Anthropic.

The app container runs as UID 10001, is read-only except for its explicit data volumes and `/tmp`, drops Linux capabilities, and is not published directly to the host. Caddy is the only service binding public ports.

## Install on an Ubuntu VPS

1. Point your domain at the VPS and allow DNS to propagate. If the VPS does not accept IPv6, remove any `AAAA` record for this hostname.
2. Install Docker Engine and the Compose v2 plugin using Docker’s official instructions. Place the checkout in a directory controlled by the owner account; membership in the `docker` group is effectively root access.
3. Clone this **private** repository using an account that has access:

   ```bash
   gh repo clone evgenmay1978-del/claude-code-workspace
   cd claude-code-workspace
   ```

   If `gh` is not installed, use Git over SSH or HTTPS with your existing GitHub access.
4. Run the setup script and enter the public DNS name:

   ```bash
   ./scripts/setup.sh
   ```

   It creates a mode-0600 `.env`, validates the Compose configuration, builds the image, and starts the app and Caddy. It does not write an owner password or any Anthropic credential to `.env`.
5. Open `https://your-domain`, create the one local workspace owner account, and use a unique password of at least 12 characters. Initial setup is available only while no owner exists; there is no public registration after setup.
6. Sign in, open a project’s **Terminal**, and run:

   ```text
   claude
   ```

   Complete the login flow displayed by the official CLI in the terminal. If it prints an authorization URL or code, open that URL yourself and finish the flow on Anthropic’s own page. Do not paste passwords, browser cookies, access tokens, or credential files into the web app, chat, or issue tracker. The CLI stores its own configuration in the private `polar_claude_config` volume.
7. Confirm the app and reverse proxy are healthy:

   ```bash
   docker compose ps
   docker compose logs --tail=100 polar-app caddy
   ```

The web-app password and Claude Code CLI login are separate. The first protects this workspace; the second is handled by the unmodified CLI. If a CLI session expires, sign in again through `claude` in the in-app Terminal.

### Update

From the checkout, fetch the latest approved changes and rebuild the service:

```bash
git pull --ff-only origin main
docker compose up -d --build
```

The named data volumes survive rebuilds and container replacement. Do not run `docker compose down -v` unless you intend to delete all application data and CLI configuration.

## Mobile / PWA installation

Open the HTTPS address on the phone after signing in:

- **iPhone/iPad:** Safari → Share → **Add to Home Screen**.
- **Android:** Chrome → menu → **Install app** (or **Add to Home screen**).

The PWA is an online client for this server, not an offline Claude runtime or native mobile app. Keep the HTTPS origin and server available. Private API responses are not saved in the service-worker cache.

## Storage and backups

Docker Compose uses these persistent volumes:

| Volume | Contents |
| --- | --- |
| `polar_data` | SQLite database: owner account/session records, projects, local conversations, messages, and metadata. |
| `polar_workspaces` | Project files, attachments, and generated workspace artifacts. |
| `polar_claude_config` | Private Claude Code CLI configuration/login state and CLI home files. Treat it as a credential store. |
| `polar_caddy_data`, `polar_caddy_config` | Caddy TLS certificates and proxy state. These are not included in the app backup; Caddy can obtain certificates again when DNS and ports are available. |

Create a backup while the app is running:

```bash
./scripts/backup.sh
```

An archive is written to `backups/` with owner-only file permissions. The script uses SQLite’s online backup API for a consistent database snapshot and includes workspace and CLI configuration files. The archive is **not encrypted**. It contains private project content and CLI login configuration: encrypt it before copying it off the VPS, restrict access, and never commit it to Git or attach it to a public issue.

Restore from a backup (this replaces the current app database, workspace files, and CLI configuration):

```bash
./scripts/restore.sh backups/polar-YYYYMMDDTHHMMSSZ.tar.gz
```

The restore script validates the archive layout, stops the app, and requires you to type `RESTORE` before replacing data. Keep a second copy of the current state before restoring. Once complete, check `docker compose ps` and test the app over HTTPS.

## Configuration and operations

- Change domain and origin in `.env` together: `POLAR_DOMAIN` and `PUBLIC_ORIGIN` must match the public HTTPS origin. Keep `SESSION_COOKIE_SECURE=1` for HTTPS.
- `CLAUDE_ENABLED=1` enables the CLI-backed chat route. No `ANTHROPIC_API_KEY` is needed or passed to the CLI child process.
- Health check: `GET /_app/health` (intentionally unauthenticated for container readiness).
- Application logs: `docker compose logs -f polar-app`; proxy/TLS logs: `docker compose logs -f caddy`.
- Restart services after changing `.env`: `docker compose up -d`.
- The app does not mount the Docker socket, host root, or home directory. The owner’s terminal is still a real shell inside the app container and can read/write the mounted owner workspaces and CLI volume; protect the owner account and VPS accordingly.

## Authentication and privacy boundaries

This application intentionally has a single owner account. Do not use it to share a Claude login, terminal, files, subscription quota, or CLI credentials. The web server does not accept Claude passwords or tokens and does not implement an OAuth proxy; the CLI itself completes its official login. The CLI config volume is mounted only inside the app container, but an authenticated owner’s terminal runs as the same unprivileged container user and can access that owner’s files.

Project files and prompts are sent to Claude Code when the owner invokes the CLI, under the account and plan selected in that CLI. Keep `.env`, `backups/`, SQLite files, workspace files, and the CLI volume private. Enable VPS firewalling, use a unique workspace password, and keep Docker, the OS, the CLI package, and this project updated.

## Development

```bash
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

The development web app uses Vite; the Express API runs separately. Run the automated checks with:

```bash
pnpm test
pnpm build
```

See [plan.md](plan.md) for architecture/design decisions and [TODO.md](TODO.md) for tracked acceptance criteria.


For a focused Russian-language explanation of the owner-run CLI login and credential storage, see [docs/AUTH.md](docs/AUTH.md).
