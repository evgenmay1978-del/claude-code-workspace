# Polar Workspace

A private, single-owner web workspace for Claude Code. It combines project conversations, local chat history, project files, Git status/diff/staging/commit, private attachments, and a real PTY terminal in a responsive desktop/mobile PWA.

> **Коротко по-русски.** Приватное self-hosted веб-приложение «Polar Workspace»: чаты, проекты,
> файлы, Git и настоящий терминал в браузере. Все запросы уходят в **официальный Claude Code CLI**
> по подписке — без API-ключей, SDK и посредников. На уже созданном Ubuntu VPS используйте
> `./scripts/install-ubuntu.sh` → откройте `https://ваш-домен` → создайте владельца → в проекте
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

- A pre-created Ubuntu 22.04, 24.04 or 26.04 LTS VPS (64-bit `amd64` or `arm64`) with a normal owner account and `sudo`. The installer can install Docker Engine and Compose v2 from Docker's official apt repository. Claude Code documents a 4 GB RAM minimum; allow additional memory for the web app, native dependencies, and active coding sessions.
- A public DNS name with an `A` record (and an `AAAA` record only if IPv6 is routed to the VPS).
- Inbound TCP ports **80** and **443** open. UDP 443 is optional and enables HTTP/3.
- An official Claude Code login owned by the one person using this private installation, with a plan and region supported by Anthropic.

## Free hosting and domain

The installer configures an **already-created** Linux host; it does not create a free cloud account, VM, domain, or DNS record. Free web-hosting tiers commonly sleep, lose local files, or lack enough memory for this CLI workspace. See [the verified free-hosting assessment](docs/FREE_HOSTING.md) for current provider limits and the Anthropic supported-region boundary. This project will not use a tunnel or foreign server to disguise an unsupported access location.

The app container runs as UID 10001, is read-only except for its explicit data volumes and `/tmp`, drops Linux capabilities, and is not published directly to the host. Caddy is the only service binding public ports. Docker warns that published container ports can bypass UFW rules; this installer does not alter host or provider firewall settings. Configure the cloud firewall deliberately and review Docker's [firewall guidance](https://docs.docker.com/engine/network/packet-filtering-firewalls/#docker-and-ufw).

## Install on an Ubuntu VPS

1. Point your domain at the VPS and allow DNS to propagate. If the VPS does not accept IPv6, remove any `AAAA` record for this hostname.
2. Clone the public repository under a normal owner account (not `root`):

   ```bash
   gh repo clone evgenmay1978-del/claude-code-workspace
   cd claude-code-workspace
   ```

   If `gh` is not installed, use Git over SSH or HTTPS with your existing GitHub access.
3. From the checkout, run the Ubuntu installer and enter the already-configured public DNS name when prompted:

   ```bash
   ./scripts/install-ubuntu.sh
   ```

   If Docker Engine/Compose v2 are absent, it asks permission and installs the official packages from Docker's apt repository. Then it creates a mode-0600 `.env`, validates Compose, builds the image, and starts the app and Caddy. It does not create a cloud account or VM, register a domain, change firewall rules, or write an owner password/Anthropic credential to `.env`. If Docker is already installed, you can run `./scripts/setup.sh` directly.
4. Open `https://your-domain`, create the one local workspace owner account, and use a unique password of at least 12 characters. Initial setup is available only while no owner exists; there is no public registration after setup.
5. Sign in, open a project’s **Terminal**, and run:

   ```text
   claude
   ```

   Complete the login flow displayed by the official CLI in the terminal. If it prints an authorization URL or code, open that URL yourself and finish the flow on Anthropic’s own page. Do not paste passwords, browser cookies, access tokens, or credential files into the web app, chat, or issue tracker. The CLI stores its own configuration in the private `polar_claude_config` volume.
6. Confirm the app and reverse proxy are healthy:

   ```bash
   sudo docker compose ps
   sudo docker compose logs --tail=100 polar-app caddy
   ```

The web-app password and Claude Code CLI login are separate. The first protects this workspace; the second is handled by the unmodified CLI. If a CLI session expires, sign in again through `claude` in the in-app Terminal.

### Install without Docker (systemd, behind an existing nginx)

Для сервера, где уже работает nginx и Docker нежелателен (например, из-за правил iptables):

```bash
sudo ./scripts/install-systemd.sh --origin https://claude.example.com:8911 --port 3020 --run-as root
```

Скрипт собирает проект, прогоняет тесты, создаёт `/etc/polar-workspace.env` (0600) и `polar-workspace.service`,
который слушает только `127.0.0.1:<порт>`. nginx, firewall, DNS и сертификаты он не трогает: блок `server`
для публикации — в `deploy/nginx-polar-workspace.conf.example` (SNI на уже открытом TLS-порту, SSE и WebSocket).

- `--run-as root` — полный доступ: тот же логин Claude Code, что у root (`/root/.claude`), домашний каталог `/root`,
  в окне «Добавить проект» можно указать существующую папку сервера (`POLAR_ALLOW_HOST_PATHS=1`).
  Пароль Workspace тогда защищает root-доступ к серверу — включите и `auth_basic` в nginx.
- `--run-as polar` — отдельный непривилегированный пользователь и свой логин Claude Code.

### Update

From the checkout, fetch the latest approved changes and rebuild the service:

```bash
git pull --ff-only origin main
sudo docker compose up -d --build
```

The named data volumes survive rebuilds and container replacement. Do not run `sudo docker compose down -v` unless you intend to delete all application data and CLI configuration.

Run this at least once a month: `DISABLE_AUTOUPDATER=1` keeps the bundled Claude Code CLI pinned, and Anthropic periodically raises the minimum supported CLI version — a stale binary starts failing with an unclear error. After updating, check the in-app Terminal: `claude --version`.

## Права Claude Code в чате

Над полем ввода есть переключатель «Права»:

| Режим | Что Claude Code делает сам | Что спрашивает |
| --- | --- | --- |
| **Спрашивать** (по умолчанию) | читает и ищет по файлам проекта | каждую правку файла, каждую команду shell и прочие действия |
| **Правки сами** | читает и правит файлы проекта | команды shell и прочие действия |
| **Только чтение** | читает и предлагает план | ничего не меняет |

Запрос разрешения появляется в чате карточкой: для команды показан её точный текст, для правки — дифф, для новой
записи — содержимое файла. «Разрешить» выполняет действие, «Отклонить» сообщает Claude Code об отказе, и он
продолжает без этого шага. Без ответа запрос автоматически отклоняется через 10 минут, а при остановке ответа или
закрытии страницы — сразу. Все шаги ответа сохраняются в истории («Действия Claude Code»).

Как это устроено: CLI запускается с `--permission-prompt-tool mcp__polar__approve`. Встроенный MCP-сервер
(`server/claude/permission-mcp.ts`, без сторонних зависимостей) пересылает запрос на внутренний маршрут
`/_internal/claude/permission`, который принимает только loopback-соединения и одноразовый токен текущего запуска.
Токен передаётся через временный mcp-config с правами 0600 и удаляется по завершении запуска.

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

The restore script validates the archive layout, stops the app, and requires you to type `RESTORE` before replacing data. Keep a second copy of the current state before restoring. Once complete, check `sudo docker compose ps` and test the app over HTTPS.

## Configuration and operations

- Change domain and origin in `.env` together: `POLAR_DOMAIN` and `PUBLIC_ORIGIN` must match the public HTTPS origin. Keep `SESSION_COOKIE_SECURE=1` for HTTPS.
- `CLAUDE_ENABLED=1` enables the CLI-backed chat route. No `ANTHROPIC_API_KEY` is needed or passed to the CLI child process.
- `TZ` (default `America/Los_Angeles`) plus `LANG`/`LC_ALL` (`en_US.UTF-8`) set the container locale so the CLI timestamps match the owner's time zone.
- `CLAUDE_STREAM_TIMEOUT_MS` (default 30 minutes) cancels a hung CLI run, `MAX_CONCURRENT_STREAMS` (default 3) caps parallel runs, `CLAUDE_STREAM_HEARTBEAT_MS` (default 25 s) keeps SSE alive through proxies. A second parallel run for the same chat is rejected with `409 stream_in_progress`.
- Health check: `GET /_app/health` (intentionally unauthenticated for container readiness).
- Application logs: `sudo docker compose logs -f polar-app`; proxy/TLS logs: `sudo docker compose logs -f caddy`.
- Restart services after changing `.env`: `sudo docker compose up -d`.
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
