# Авторизация Claude (официальная, по подписке)

Сервис **не хранит и не подменяет** доступ: он работает через официальный Claude Code CLI.
API-ключи Anthropic и SDK не используются — только CLI и подписочный вход.

## Способ A — подписка Claude Pro/Max (рекомендуется)

1. Установить официальный CLI на сервере:
   `npm i -g @anthropic-ai/claude-code`
2. Один раз войти подпиской — прямо в интерфейсе **Настройки → Вход в Claude Code**
   (кнопка запускает `claude setup-token` и показывает ссылку/вывод CLI), либо вручную:
   `claude setup-token`
   После подтверждения на claude.ai CLI выдаёт долгоживущий токен. Токен остаётся на сервере
   в конфиге CLI (`~/.claude/.credentials.json`); в браузер он не передаётся.
3. Проверка: `curl -s http://127.0.0.1:8787/api/health` → в блоке `claude` должно быть
   `"installed": true` и `"loginFilePresent": true`.

Альтернатива для контейнера: `export CLAUDE_CODE_OAUTH_TOKEN=...` в окружении сервиса (не в git).

## Способ B — API-ключ (оплата по токенам)

`export ANTHROPIC_API_KEY=sk-ant-...` — но это уже не подписка, а платный API.

## Как это подключено в коде

- `POST /api/claude/stream` запускает `claude -p --output-format stream-json --verbose --model <alias>`
  в каталоге выбранного проекта и отдаёт фронтенду SSE-события `started / delta / activity / done / error`;
- session id CLI сохраняется в SQLite и передаётся обратно через `--resume`, поэтому чат продолжается;
- `GET /api/claude/status` показывает честный статус: найден ли CLI, какая версия, выполнен ли вход;
- `POST /api/claude/login` + `/api/claude/login/input` — обёртка над `claude setup-token` для входа из UI.

## Безопасность

- сервер по умолчанию слушает `127.0.0.1`; наружу — только через TLS-прокси (Caddy/nginx) и с паролем владельца;
- файлы `.env`, `.credentials.json`, `*.pem`, `*.key` не читаются и не показываются интерфейсом;
- в браузере секреты Claude никогда не запрашиваются.
