# Claude Agent SDK (прежнее название: Claude Code SDK)

> **Scope:** обзор подготовлен исключительно по официальной документации Anthropic и официальному `CHANGELOG.md` репозитория `anthropics/claude-code`. Важное различие: **Claude Agent SDK** — библиотека, запускающая нативный бинарник Claude Code внутри приложения; это не обычный Client SDK для прямых вызовов Messages API.

## 1. Название, пакеты и версия

| Вопрос | Официальная позиция Anthropic |
|---|---|
| Текущее имя | **Claude Agent SDK**. Прежнее имя — **Claude Code SDK**; переименование отражает применение для агентов шире, чем программирование. |
| TypeScript/JavaScript | `@anthropic-ai/claude-agent-sdk`; установка: `npm install @anthropic-ai/claude-agent-sdk`. Старое имя: `@anthropic-ai/claude-code`. |
| Python | `claude-agent-sdk`; импорт: `claude_agent_sdk`; установка: `pip install claude-agent-sdk`. Старое имя: `claude-code-sdk` / `claude_code_sdk`. |
| API v0.1.0 | Миграционная документация отмечает breaking changes: `ClaudeCodeOptions` переименован в `ClaudeAgentOptions`, а минимальный system prompt стал поведением по умолчанию (нужный preset Claude Code надо запросить явно). |
| Связь версий | TypeScript SDK поставляет нативный Claude Code binary как optional dependency; **версия SDK отслеживает версию включённого Claude Code**. Документация приводит пример: SDK `v0.3.191` включает Claude Code `v2.1.191`; для CLI-функции минимальной версии нужен SDK с тем же или более новым patch. Не следует считать этот пример заявлением о текущей latest-версии: её нужно pin-ить и сверять по официальному changelog пакета/релиза. |

## 2. Поддержка Node, Python и среда выполнения

- Для Agent SDK quickstart требует **Node.js 18+** либо **Python 3.10+**. Для запуска TypeScript-примера используется ESM (`"type": "module"`) и, в примере, `tsx`.
- Отдельная установка Claude Code обычно **не нужна**: оба SDK поставляют нативный binary. Исключения: Python source distribution без platform wheel (например, ARM64 Windows) и TypeScript-установка без npm optional dependencies (`npm ci --omit=optional`); тогда надо нативно установить Claude Code и указать путь к binary (`pathToClaudeCodeExecutable` для TS; Python ищет `claude` в `PATH`).
- Для самого Claude Code заявлены: macOS 13+, Windows 10 1809+/Windows Server 2019+, Ubuntu 20.04+, Debian 10+, Alpine 3.19+; x64/ARM64, 4 GB+ RAM, интернет, Bash/Zsh/PowerShell/CMD и поддерживаемая Anthropic страна. На Alpine требуются `bash`, `curl`, `libgcc`, `libstdc++`, `ripgrep`.
- **Не смешивать два требования Node:** Agent SDK требует Node 18+; глобальный npm-пакет CLI требует Node 22+ для npm-установки, хотя загруженный нативный CLI затем не использует Node runtime.
- `env` в TS SDK при задании **заменяет**, а не дополняет `process.env`; следует передавать, например, `{ ...process.env, ANTHROPIC_API_KEY: ... }`, иначе можно потерять `PATH`. SDK не загружает `.env` автоматически.

## 3. Headless / non-interactive запуск

- CLI headless mode: `claude -p "<prompt>"` (синоним `--print`). Он подходит для scripts/CI, завершает процесс с `0` при успехе и ненулевым кодом при сбое. Полезные флаги: `--allowedTools`, `--permission-mode`, `--continue`, `--output-format`.
- Для scripted/SDK calls Anthropic рекомендует **`--bare`** (и указывает, что в будущем он станет default для `-p`): он отключает auto-discovery hooks, skills, commands, subagents, plugins, MCP, auto memory и `CLAUDE.md`; подключает только явно переданное (`--mcp-config`, `--settings`, и т. п.). Файловые Read/Edit и Bash остаются доступны при разрешении.
- Это существенная граница безопасности: без `--bare` headless `-p` загружает hooks из project settings и servers из `.mcp.json`, но **не показывает** dialog доверия к workspace или отдельное подтверждение MCP-server. Для CI/deployed/multi-tenant среды также можно из SDK установить `settingSources: []` (Python: `setting_sources=[]`), чтобы не читать user/project/local filesystem settings.
- `-p` не совместим с `--bg`; `--cloud` с task description также отклоняется (с session ID он вместо этого ставит follow-up в cloud session). В `--bare` не запускаются background tasks: команда, достигшая timeout, останавливается.

## 4. Filesystem и Bash tools

- SDK даёт agent loop и встроенные инструменты Claude Code: **чтение, запись и редактирование файлов**, выполнение команд, поиск по файлам и web search; также доступны hooks, subagents и MCP. По умолчанию quickstart сообщает доступ к файлам текущей директории и её поддиректорий; дополнительные пути задаются `additionalDirectories`/`add_dirs` (`--add-dir`).
- `allowedTools` — **auto-approval**, а не allowlist доступных инструментов: неуказанный tool всё ещё проходит далее в permission mode / callback. Для реального запрета используется `disallowedTools`: голое `"Bash"` убирает инструмент из контекста, а scoped правило вроде `Bash(rm *)` запрещает совпадающие вызовы во всех modes, включая `bypassPermissions`.
- В Manual/default mode Claude имеет read-only baseline; edit, shell и обычно network requests требуют разрешения. Manual boundary запрашивает разрешение на file read/write вне рабочей директории, но это **не** OS-изоляция: одобренная Bash-команда всё равно может писать туда, куда способен пользовательский аккаунт. Для ограничения на уровне ОС нужен Bash sandbox/контейнер.

## 5. Permission callbacks и режимы

### Callback в SDK

- TS: `canUseTool`; Python: `can_use_tool`. Callback является заменой интерактивного permission prompt и возвращает allow/deny (может скорректировать input/обновить permission rules).
- Он вызывается **только** когда вычисление permissions дошло до prompt. Вызов, уже auto-approved через `allowedTools`, allow rule или mode (`acceptEdits`, `bypassPermissions`), callback не получает. Если нужно контролировать **каждый** tool call, Anthropic предписывает `PreToolUse` hook.
- В TS возврат `null` допустим лишь если host уже сам отправил matching `control_response`; иначе tool call блокируется навсегда — prompts не имеют timeout. Для live UI есть потоковое событие `SDKPermissionDeniedMessage`.

### Permission modes и ограничения

| Mode | Базовое поведение |
|---|---|
| `default` (Manual) | Только чтение; остальные значимые действия спрашивают пользователя. |
| `acceptEdits` | Чтение, file edits и обычные filesystem-команды (`mkdir`, `touch`, `mv`, `cp` и др.). |
| `plan` | Изучение без изменений (с отдельными особенностями auto mode). |
| `auto` | Действия проверяет отдельный classifier; это baseline для interactive terminal/VS Code с Claude Code v2.1.283+. |
| `dontAsk` | Reads и pre-approved calls выполняются; всё, что спросило бы пользователя, запрещается. Подходит locked-down CI. |
| `bypassPermissions` | Выполнение без permission checks; только для изолированных контейнеров/VM. В TS требуется явный `allowDangerouslySkipPermissions`. |

**Даже `bypassPermissions` не снимает всё:** explicit `ask` rules, org connector tools, требующие interaction, встроенный `AskUserQuestion`, MCP tools с `requiresUserInteraction`, critical-path `rm`/`rmdir`, ограничения cross-session messaging и (при включении) некоторые reads вне working directories не auto-approve. Explicit deny rules блокируют во всех modes. Поэтому `--dangerously-skip-permissions` следует использовать только в non-root container/VM или sandbox runtime, не как стандартный режим на рабочей машине.

## 6. Sessions и resume

- `query()` возвращает новый session по умолчанию. Получите `session_id` из итогового `ResultMessage`/`SDKResultMessage` (на error result он тоже присутствует), затем передайте `resume=<id>` для восстановления полного контекста, даже после restart процесса.
- `continue` (TS) / `continue_conversation` (Python) продолжает последнюю беседу; `forkSession` / `fork_session` создаёт независимую ветвь истории с новым ID. Fork ветвит **только conversation history**, не filesystem: изменения файлов видны обоим потокам.
- По умолчанию transcripts лежат в `~/.claude/projects/<encoded-cwd>/*.jsonl` или `$CLAUDE_CONFIG_DIR/projects/...`; поэтому resume по умолчанию same-machine. Между машинами/serverless Anthropic предлагает mirror transcript в shared storage через `SessionStore` adapter.
- Session lookup может искать ID вне текущей directory; для CLI до v2.1.223 поиск был ограничен current project/worktrees. Исторические SDK с более старым bundled CLI наследуют это ограничение.

## 7. Streaming events

- TS `query()` — `AsyncIterable`, Python `query()` — async iterator: оба отдают message objects по мере поступления, включая assistant/tool/system и финальный result; `ClaudeSDKClient` (Python) удерживает подключение и контекст для continuous conversation. `includePartialMessages` / `include_partial_messages` добавляет partial events, `includeHookEvents` — lifecycle hooks.
- Финальный `ResultMessage` содержит `session_id`, статус/error, число turns, usage/cost, результат и diagnostic fields. Python `receive_response()` заканчивается на ResultMessage; `receive_messages()` нужен, если нужны события после него, например `session_state_changed` (с `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`).
- Headless CLI поддерживает structured streaming output (`--output-format`); SDK предпочтительнее для нативных typed message objects, structured outputs и callbacks. Official release notes фиксируют recent исправления: non-interactive sessions продолжают turn после mid-response API timeout, и были устранены несколько race/потерь контекста при `--resume`.

## 8. Аутентификация

- **Для встраиваемого Agent SDK:** основной документированный путь — API key из Claude Console в `ANTHROPIC_API_KEY`. SDK читает key из environment процесса, не из `.env`. В bare mode OAuth credentials и system keychain не читаются; для Anthropic API необходим `ANTHROPIC_API_KEY` либо `apiKeyHelper`.
- Поддержаны third-party providers при их credentials и переменных: Amazon Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`), Claude Platform on AWS (`CLAUDE_CODE_USE_ANTHROPIC_AWS=1` + `ANTHROPIC_AWS_WORKSPACE_ID`), Google Cloud Agent Platform (`CLAUDE_CODE_USE_VERTEX=1`), Microsoft Foundry (`CLAUDE_CODE_USE_FOUNDRY=1`).
- В интерактивном Claude Code доступны browser login Claude Pro/Max, Teams/Enterprise, Console, cloud providers и self-hosted gateway/SSO; для headless CI можно выпустить годовой `claude setup-token` и задать `CLAUDE_CODE_OAUTH_TOKEN`. Но **bare не читает этот OAuth token**.
- Политическое ограничение Anthropic: без предварительного одобрения third-party developers **не могут** предлагать в своих продуктах claude.ai login или subscription rate limits, включая агенты Agent SDK; используйте API-key authentication, описанную в quickstart.

## 9. Главные safety restrictions / практический baseline

1. Для автоматизации: `--bare`, `settingSources: []`, фиксированный `cwd`, явные `allowedTools` + `disallowedTools`, `dontAsk` в CI и только минимальные scoped Bash allows.
2. `allowedTools` не равен sandbox и не равен ограничению capability. Держите `Bash` scoped (`Bash(npm test)`) и включайте OS Bash sandbox, container/devcontainer для defence in depth.
3. Не используйте `bypassPermissions` на host; Anthropic ограничивает рекомендуемый случай изолированными VM/containers. Всегда review предложенных command/code для sensitive repository.
4. Network commands вроде `curl`/`wget` обычно не auto-approved в Manual mode; используйте deny rules или sandbox network isolation, если нужен реальный запрет независимо от текста команды. Prompt injection остаётся риском, особенно при чтении веб-данных и недоверенных репозиториев.
5. При headless без bare hooks/MCP из незнакомого checkout могут стартовать без trust dialogs; рассматривайте workspace configuration как executable/untrusted input.

## Официальные первичные источники

| Источник | URL |
|---|---|
| Agent SDK overview | https://docs.anthropic.com/en/docs/claude-code/sdk |
| Agent SDK Quickstart | https://docs.anthropic.com/en/docs/claude-code/sdk/quickstart |
| TypeScript Agent SDK reference | https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript |
| Python Agent SDK reference | https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-python |
| Migrate to Claude Agent SDK | https://docs.anthropic.com/en/docs/claude-code/sdk/migration-guide |
| Agent SDK sessions | https://docs.anthropic.com/en/docs/claude-code/sdk/sessions |
| Run Claude Code programmatically / headless | https://docs.anthropic.com/en/docs/claude-code/headless |
| Advanced setup / requirements | https://docs.anthropic.com/en/docs/claude-code/setup |
| Authentication | https://docs.anthropic.com/en/docs/claude-code/authentication |
| Choose a permission mode | https://docs.anthropic.com/en/docs/claude-code/permission-modes |
| Security | https://docs.anthropic.com/en/docs/claude-code/security |
| Official Claude Code CHANGELOG | https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md |
