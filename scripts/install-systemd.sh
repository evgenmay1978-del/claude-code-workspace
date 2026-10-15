#!/usr/bin/env bash
# Установка Polar Workspace как systemd-сервиса, без Docker.
#
# Для серверов, где Docker нежелателен (меняет iptables) или где Workspace должен
# работать с уже залогиненным Claude Code и каталогами сервера.
#
# Скрипт:
#   - собирает проект (pnpm install --frozen-lockfile, pnpm build, по умолчанию и pnpm test);
#   - создаёт каталоги данных и /etc/polar-workspace.env (0600), если его ещё нет;
#   - ставит и запускает polar-workspace.service, слушающий ТОЛЬКО 127.0.0.1:<порт>;
#   - проверяет /_app/health.
# Скрипт НЕ трогает nginx, firewall, DNS и сертификаты — шаблон nginx лежит в
# deploy/nginx-polar-workspace.conf.example, подключается отдельно и вручную.
#
# Пример (S1, от root, полный доступ, тот же логин Claude Code, что у root):
#   sudo ./scripts/install-systemd.sh --origin https://claude.wapmixx.ru:8911 --port 3020 --run-as root
set -euo pipefail

ORIGIN=""
PORT="3020"
RUN_AS="polar"
SKIP_TESTS=0
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="/etc/polar-workspace.env"
UNIT_FILE="/etc/systemd/system/polar-workspace.service"

usage() {
  cat <<EOF
Использование: sudo $0 --origin https://домен[:порт] [--port 3020] [--run-as root|polar] [--skip-tests]
  --origin      публичный HTTPS-адрес, ровно как в браузере (с портом, если он не 443)
  --port        локальный порт приложения (слушает только 127.0.0.1)
  --run-as      root — полный доступ: HOME=/root, логин Claude Code из /root/.claude,
                проекты можно открывать в любых каталогах сервера;
                polar — отдельный непривилегированный пользователь (по умолчанию)
  --skip-tests  не запускать pnpm test перед установкой
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --origin) ORIGIN="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --run-as) RUN_AS="${2:-}"; shift 2 ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Неизвестный параметр: $1" >&2; usage; exit 2 ;;
  esac
done

fail() { echo "ОШИБКА: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || fail "запустите от root (sudo)."
[[ "$ORIGIN" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || fail "--origin должен быть вида https://claude.example.com или https://claude.example.com:8911"
[[ "$PORT" =~ ^[0-9]{2,5}$ ]] || fail "--port должен быть числом."
[ "$RUN_AS" = root ] || [ "$RUN_AS" = polar ] || fail "--run-as: root или polar."
command -v systemctl >/dev/null || fail "нужен systemd."

step "Проверка порта 127.0.0.1:$PORT"
if ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q . && ! systemctl is-active --quiet polar-workspace; then
  fail "порт $PORT уже занят другим процессом: $(ss -ltnpH "sport = :$PORT" | head -1)"
fi

step "Node.js и pnpm"
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || fail "Node.js не найден."
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || fail "нужен Node.js 22+, найден $("$NODE_BIN" -v)."
command -v pnpm >/dev/null || fail "pnpm не найден (corepack enable && corepack prepare pnpm@10.15.0 --activate)."
echo "node $("$NODE_BIN" -v), pnpm $(pnpm -v)"

step "Сборка в $SRC"
cd "$SRC"
pnpm install --frozen-lockfile
pnpm build
if [ "$SKIP_TESTS" -eq 0 ]; then
  step "Тесты"
  pnpm test
fi

step "Каталоги и пользователь"
if [ "$RUN_AS" = root ]; then
  SERVICE_USER=root
  APP_HOME=/root
  CONFIG_DIR=/root/.claude
  DATA_DIR=/var/lib/polar-workspace/data
  WORKSPACES_DIR=/root/workspaces
  ALLOW_HOST_PATHS=1
else
  SERVICE_USER=polar
  id polar >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/polar-workspace/home --shell /bin/bash polar
  APP_HOME=/var/lib/polar-workspace/home
  CONFIG_DIR=/var/lib/polar-workspace/claude-config
  DATA_DIR=/var/lib/polar-workspace/data
  WORKSPACES_DIR=/var/lib/polar-workspace/workspaces
  ALLOW_HOST_PATHS=0
fi
install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR" "$WORKSPACES_DIR" "$CONFIG_DIR" "$APP_HOME"

# Глобальный (уже залогиненный) claude предпочтительнее закреплённого в node_modules.
CLAUDE_BIN="$(command -v claude || true)"
[ -n "$CLAUDE_BIN" ] || CLAUDE_BIN="$SRC/node_modules/.bin/claude"
echo "Claude Code: $CLAUDE_BIN ($("$CLAUDE_BIN" --version 2>/dev/null || echo 'версия не определена'))"

step "Окружение $ENV_FILE"
if [ -f "$ENV_FILE" ]; then
  echo "уже существует — не перезаписываю. Проверьте PUBLIC_ORIGIN и API_PORT вручную."
else
  umask 077
  cat > "$ENV_FILE" <<EOF
# Polar Workspace (systemd). Изменили — выполните: systemctl restart polar-workspace
NODE_ENV=production
HOST=127.0.0.1
API_PORT=$PORT
PUBLIC_ORIGIN=$ORIGIN
SESSION_COOKIE_SECURE=1
CLAUDE_ENABLED=1
WEB_ROOT=$SRC/dist
DATA_DIR=$DATA_DIR
DB_PATH=$DATA_DIR/claude-workspace.sqlite
WORKSPACES_DIR=$WORKSPACES_DIR
CLAUDE_CONFIG_DIR=$CONFIG_DIR
CLAUDE_HOME=$APP_HOME
CLAUDE_BIN=$CLAUDE_BIN
POLAR_ALLOW_HOST_PATHS=$ALLOW_HOST_PATHS
TZ=Europe/Moscow
LANG=C.UTF-8
CLAUDE_STREAM_TIMEOUT_MS=1800000
MAX_CONCURRENT_STREAMS=3
PATH=$(dirname "$NODE_BIN"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EOF
  chmod 0600 "$ENV_FILE"
fi

step "systemd-юнит"
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Polar Workspace (web UI for Claude Code)
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$SRC
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $SRC/dist-server/server/index.js
Restart=on-failure
RestartSec=3
# Терминалы и запуски Claude Code завершаются вместе с сервисом.
KillMode=mixed
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable polar-workspace >/dev/null
systemctl restart polar-workspace

step "Проверка"
for _ in $(seq 1 20); do
  if curl -fsS -m 2 "http://127.0.0.1:$PORT/_app/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
curl -fsS -m 3 "http://127.0.0.1:$PORT/_app/health" && echo
systemctl --no-pager --lines=5 status polar-workspace | head -12
ss -ltnpH "sport = :$PORT"

cat <<EOF

Готово: приложение слушает 127.0.0.1:$PORT (наружу не опубликовано).
Дальше — публикация через nginx по шаблону:
  $SRC/deploy/nginx-polar-workspace.conf.example
Обновление: git pull && sudo $0 --origin $ORIGIN --port $PORT --run-as $RUN_AS
EOF
