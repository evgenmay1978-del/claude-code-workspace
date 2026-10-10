# Архитектурный синтез: безопасный минимальный self-hosted Claude chat + Claude Code

**Статус:** рекомендуемое минимальное решение для существующего `claudesk` на VPS.  
**Основание:** пять приложенных исследований, опирающихся на первичные документы Anthropic.  
**Граница:** это технический дизайн, **не юридическое заключение**. Перед коммерческим запуском и особенно при наличии исключительного предварительного одобрения Anthropic нужно сверить актуальные документы и условия.

## Решение в одном абзаце

Строить следует **собственный application shell**, а не клон Claude.ai и не self-hosted inference: браузер обращается только к собственному HTTPS API, который хранит пользователей, Projects, историю, ACL, файлы и квоты; этот backend вызывает официальный **Messages API**. Claude Code запускается только как **одноразовый Agent SDK worker на job** в жёстко ограниченном непривилегированном контейнере с подготовленным сервером checkout. Канонические репозитории, проектные данные и метаданные персистентны, но рабочая директория, `$HOME`/`CLAUDE_CONFIG_DIR` и credentials агента — одноразовые. Принятие diff в постоянный Git-репозиторий — отдельное контролируемое действие после проверки, а не право агента на canonical repo.

**Не использовать:** Claude.ai/consumer OAuth, Pro/Max/Free credentials или `CLAUDE_CODE_OAUTH_TOKEN` как способ обслуживать пользователей веб-приложения; VPN/forward proxy/географический relay для обхода региональных ограничений; Docker socket, host home или облачные/SSH credentials в agent worker. Модельные вызовы оплачиваются **отдельно через Claude Console/API** и это должно быть явно видно пользователю продукта.

---

## 1. Зафиксированные архитектурные решения (ADR)

| Решение | Выбор | Почему |
|---|---|---|
| Model layer для чата | Официальный **Messages API** через server-side BFF | API stateless: продукт получает полный контроль над историей, ACL, квотами и UX; ключ не попадает в браузер. [Messages API](https://platform.claude.com/docs/en/api/messages/create) |
| Code-agent layer | Официальный **Claude Agent SDK** в disposable worker | Agent SDK запускает Claude Code с file/shell tools; это управляемый моделью subprocess, а не безопасный chat endpoint. [SDK overview](https://docs.anthropic.com/en/docs/claude-code/sdk) |
| Identity | Собственный IdP/SSO приложения, server-side RBAC | Anthropic plan/Team roles не являются RBAC VPS-сервиса; SDK не поставляет multi-tenancy. |
| Auth к Anthropic | Console API key/service-account key; предпочтительно WIF для production, если у workload есть поддерживаемый OIDC issuer | Это документированные server/CI механизмы; WIF сокращает время жизни credential. [API auth](https://platform.claude.com/docs/en/manage-claude/authentication), [WIF](https://platform.claude.com/docs/en/manage-claude/workload-identity-federation) |
| Consumer OAuth | **Не поддерживать и не принимать** | Third-party product не может предлагать Claude.ai login, проксировать запросы через plan credentials или посредничать в таких credentials без предварительного одобрения Anthropic. [Legal & compliance](https://docs.anthropic.com/en/docs/claude-code/legal-and-compliance) |
| Project persistence | PostgreSQL для metadata/ACL/messages; object storage для вложений; canonical bare Git для кода | Позволяет персистентность без общей writable home/worktree для агентов. |
| Agent persistence | Хранить job/events/diff и при необходимости защищённый session store; **не** монтировать persistent `~/.claude` | Default transcripts в `~/.claude/projects` — plaintext. Resume требует контролируемого SessionStore, а не общего домашнего каталога. [SDK sessions](https://docs.anthropic.com/en/docs/claude-code/sdk/sessions) |
| Запись в репозиторий | Agent меняет только temporary checkout; отдельный trusted merge/publish step применяет одобренный diff | У агента нет доступа к canonical repository, deploy token или Docker control plane. |
| Сеть worker | Default-deny egress, точный список model/auth/Git/package endpoints; без пользовательского proxy | Снижает exfiltration/prompt-injection surface; broad domain allowlist без TLS inspection не является достаточной защитой. [Sandboxing](https://docs.anthropic.com/en/docs/claude-code/sandboxing) |

> **Ключевое различие:** `Projects` в этом продукте — объекты собственной БД. Они **не являются** Claude.ai Projects и не получают автоматически Claude.ai memory, project RAG, history search, sharing или Artifacts. Эти функции нужно сознательно реализовать в приложении либо честно не обещать.

---

## 2. Целевая минимальная топология на VPS

```text
Browser
  │ HTTPS + application session (own IdP)
  ▼
[edge reverse proxy] ── только 443 ─────────────────────────────────────┐
  ▼                                                                       │
[API/BFF] ── internal ── [PostgreSQL] [queue] [object storage]           │
  │                    [canonical bare Git repositories]                 │
  │                                                                       │
  ├─ Messages API / Files API / Models API ─────► Anthropic              │
  │                                                                       │
  └─ authorized job ─► [host-side job supervisor] ─► one Agent SDK job   │
                                                    container             │
                                                     ├─ /workspace only   │
                                                     ├─ ephemeral home    │
                                                     └─ constrained egress│
                                                                    │
                                                   patch/test/artifacts
                                                                    ▼
                                                [review + trusted publish]
                                                → canonical Git repository
```

### 2.1. Сервисы Docker Compose

| Компонент | Публикуемые порты | Persistent state | Обязанность и обязательные границы |
|---|---:|---|---|
| `edge` (Caddy/Nginx) | только `443` (и `80` исключительно для ACME redirect) | TLS certificates | TLS, HSTS, body-size/rate limits; forwards only to `api`. Админские и agent endpoints наружу не публикуются. |
| `api` / BFF | нет | нет или минимальный cache | Проверяет own IdP session, project membership, role, quota и ownership до чтения файла/repo/job. Вызывает Messages API; не выполняет shell и не имеет Docker socket. |
| `postgres` | нет | encrypted/backed-up DB volume | Users, orgs, Projects, ACL, chats, messages, attachments map, job state, immutable audit metadata, usage ledger. |
| `queue` | нет | очередь при необходимости | Отделяет создание job от исполнения; допускает cancellation и per-project concurrency limit. |
| `object-store` (S3/MinIO) | нет, либо private endpoint | encrypted persistent volume/bucket | Оригиналы вложений, generated artifacts, patch/test results. Object key никогда не служит авторизацией: каждый доступ проверяет API. |
| `repo-store` | нет | persistent server-owned bare Git volume | Canonical bare repositories и refs. Не монтируется в agent worker; доступен только trusted ingestion/publish process. |
| `agent-job` (Compose profile, одноразовый) | **нет** | только `/workspace` на время job | Непривилегированный образ с Agent SDK. Создаётся supervisor'ом на один job, затем удаляется вместе с workspace/home. |
| host-side `job-supervisor` | нет | только control state | Доверенный systemd/CI-like process под отдельным host account: materializes checkout, запускает `docker compose run --rm agent-job`, забирает patch/artifacts и уничтожает job. Это **не** сервис, доступный пользователям или агенту. |

### 2.2. Почему supervisor находится вне публичного Compose API

Приложение не должно получать `/var/run/docker.sock`: компрометация API или prompt injection не должны превращаться в root-equivalent доступ к VPS. Для per-job контейнера безопаснее, чтобы отдельный **host-side supervisor** с фиксированной логикой запускал заранее определённый образ и заранее определённые mounts. Он получает только уже авторизованную задачу из private queue/DB, а не пользовательскую команду, путь, image, environment или Compose override.

Операционная модель:

1. `api` создаёт job после ACL/quota checks и фиксирует `project_id`, разрешённый repo/ref, capability profile и hash policy.
2. Supervisor из доверенного canonical repo materializes конкретный ref в новый сервером созданный каталог/volume `job-<uuid>`. Пользователь не выбирает host path.
3. Supervisor запускает pinned image по наперёд заданной команде наподобие `docker compose run --rm --no-deps agent-job`; в него монтируется **только** `/workspace` и tmpfs для `/tmp` и home.
4. По завершении supervisor собирает diff, test output и разрешённые artifacts, сохраняет их через API/object store, уничтожает контейнер, workspace и transient credential.
5. API создаёт review record. Только отдельная trusted publish/merge операция после policy/approval применяет diff к canonical bare repo или создаёт PR минимально scoped bot token. Worker не получает Git push token.

Так репозиторий и проект остаются персистентными, но модель не сохраняет себе долговечный доступ. Для простого MVP можно требовать явного **Accept diff** владельцем проекта; auto-merge — отдельная будущая capability, а не default.

### 2.3. Обязательный hardening `agent-job`

| Область | Минимальное требование |
|---|---|
| Identity/fs | `user` non-root, `read_only: true`, только `/workspace` writable; tmpfs `/tmp` и ephemeral home/`CLAUDE_CONFIG_DIR`; не монтировать host `$HOME`, `/`, `.ssh`, GPG, cloud credentials, Docker socket или canonical Git volume. |
| Linux privilege | `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, без `privileged`, host PID/IPC/network namespace; `pids_limit`, `cpus`, `mem_limit`, timeout job. |
| Image | Версионированный/pinned digest, минимум packages, SBOM/vulnerability patching; hooks и policy code только из образа, не из repo. |
| Network | Нет published ports. Separate worker network и host firewall/proxy allowlist. Разрешать только реальные Anthropic API/auth endpoints и только обязательные Git/package domains для конкретного profile. Держать package install выключенным по умолчанию. |
| Credentials | Отдельный service account/short-lived WIF credential на worker/tenant, не owner key; нет persistent `.claude`. Docker secret полезен для доставки, но **не** защищает secret от процесса с тем же UID — credential должен быть минимальным и короткоживущим. |
| Cleanup | `--rm`, delete volume/worktree/temp files after artifact extraction; scrubbing и retention policy для test logs. |
| Monitoring | Correlation ID, immutable job lifecycle/tool decision/outcome/image digest/repo ref/diff hash; секреты и full transcript не писать в общедоступные логи. |

Встроенный Claude Code Bash sandbox стоит включить как **второй** барьер с allowlisted filesystem/network, `allowUnsandboxedCommands: false`, без `excludedCommands` и без `enableWeakerNestedSandbox`. Но он охватывает Bash/PowerShell и descendants, а не Read/Edit/Write/WebFetch/MCP/hooks/LSP; поэтому Docker/VM boundary остаётся обязательной.

---

## 3. Projects, чаты, файлы и репозитории: модель данных и поток

### 3.1. Минимальные persistent сущности

| Сущность | Где хранить | Правило авторизации/retention |
|---|---|---|
| User, organization, role | own IdP subject + PostgreSQL | API проверяет membership на каждом request; Anthropic identity для этого не используется. |
| Project | PostgreSQL | `project_id`, owner, members/roles, instructions, default model/profile, budget, retention. Никаких public-by-ID Projects. |
| Conversation/message | PostgreSQL | Полная модель сообщений и системная инструкция; сохранять content blocks без потери `tool_use`, `tool_result`, `thinking` signature и `redacted_thinking`. |
| Project knowledge | object store + metadata + optional own retrieval index | В MVP — явно выбранные files/snippets и server-side context policy. Не полагаться на автоматический Claude.ai Project RAG. |
| Attachment | object store + DB map `attachment_id → owner/project → Anthropic file_id` | Никогда не принимать от браузера произвольный Anthropic `file_id`: Files API workspace-scoped, не user-scoped. |
| Canonical repo | server-owned bare Git storage + DB ACL | Agent видит лишь ephemeral checkout конкретного разрешённого ref. |
| Agent job/session | DB + object store | Сохранять task, repo SHA, policy, event metadata, outputs, patch hash и `session_id`; session transcript только при явной необходимости/retention. |
| Usage ledger | PostgreSQL | Per request/job: model, actual input/output/cache/thinking tokens, request ID, timestamps, price-table version, estimated vs actual cost, quota decision. |

### 3.2. Chat request через Messages API

1. Browser отправляет текст и `attachment_id`, но не provider key и не raw provider `file_id`.
2. BFF аутентифицирует user, authorizes Project/conversation, валидирует size/MIME/ownership, проверяет лимит и отбирает историю + project instructions + разрешённый context.
3. BFF читает доступные модели с `GET /v1/models` и cache'ирует capability metadata. Picker и UI controls включаются **runtime capability-aware**, а фактически использованный model ID/version сохраняется в message.
4. BFF вызывает `POST /v1/messages` с `stream: true`, транслирует SSE клиенту и записывает lifecycle: `message_start`, blocks/deltas, `message_delta.usage`, stop/error. UI не считает разрыв клиентского SSE завершением upstream turn.
5. После `message_stop` BFF использует final cumulative `usage` для usage ledger и пересчёта quota. `count_tokens` годится для предупреждения/предварительной оценки, но не для счёта.

**Нужно реализовать самостоятельно:** context compaction/summaries, cancellation/idempotency/retry, partial-state recovery, chat search/export/deletion, Project sharing/RBAC, citations rendering, retention, user quotas и cost dashboard. Messages API не создаёт conversation object и не переносит контекст сам.

### 3.3. Attachments и knowledge

- Поддержать upload gateway с MIME/size policy, antivirus/PII policy при необходимости, server-side ownership mapping, deletion и retention.
- Images API принимает base64/URL/`file_id`; PDF — URL/base64/`file_id`. Для больших/reused attachments предпочтителен Files API, но доступ к нему контролируется только собственной DB mapping/ACL.
- Direct document blocks поддерживают PDF; `.docx`/`.xlsx` для API нужно на стороне продукта конвертировать в text/PDF. PDF ограничены standard unencrypted file, page/payload/context limits; эти правила проверяются до запроса.
- Вложения отправляются внешнему model provider. Это должно быть отражено в privacy notice и data classification; self-hosted UI не означает локальный inference.
- В MVP **не** обещать автоматический RAG/long-term memory. Если нужен retrieval, строить собственный per-project index, фильтровать по ACL до поиска и логировать source selection; не смешивать docs разных Projects.

### 3.4. Строгая модель Git persistence

```text
canonical bare repo (persistent, server-only)
      │ materialize approved ref
      ▼
ephemeral /workspace (one job, one project/ref)
      │ Agent SDK: edit/test only under approved profile
      ▼
patch + test output + artifacts (immutable review record)
      │ owner/policy approval
      ▼
trusted server-side commit/PR → canonical bare repo
```

Это также облегчает rollback, audit, conflict handling и review. Если нужна сессия Agent SDK между job, использовать documentированный `SessionStore` в защищённом service-owned storage и связывать его с `project_id`/owner/ref. Не использовать default shared `~/.claude/projects` и помнить: fork ветвит conversation history, **не** filesystem.

---

## 4. Что использовать из официального API и что не обещать

| Возможность | Как применять в `claudesk` | Обязательная реализация приложения / лимит |
|---|---|---|
| Messages | Structured history + system + model + `max_tokens`; ответ содержит content, stop reason, usage | API stateless: history, summaries, idempotency, cancellation и DB — ответственность приложения. |
| Streaming | `stream: true` SSE; учитывать text, thinking, partial tool JSON, ping, errors, cumulative usage и unknown events | Нельзя ограничиться `text_delta`; нужен reducer per content-block, backpressure/reconnect/partial message state. [Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming) |
| Models API | `GET /v1/models`, capability-based picker | Не hard-code model names/features; сохранять actual model ID; graceful fallback для unavailable capability. |
| Vision/PDF/Files | Images/PDF blocks; Files API reuse | Files are workspace-scoped, не end-user scoped; backend validation/map/ACL обязательны. Direct DOCX/XLSX document block отсутствует. |
| Client tools | Только opt-in, registry по role/tenant; validate JSON; tool result в следующем turn | В MVP chat не должен иметь shell/filesystem/client tool. При включении нужны authorization, sandbox, approval, timeout/idempotency и audit — SDK не делает их за продукт. |
| Anthropic server tools | Включать только если current model capability/policy позволяют; сохранять citations | Это всё равно cloud execution/usage и не заменяет policy; web fetch/search нельзя считать безопасным для code worker. |
| Thinking | UI только для capability-compatible models; опционально показать **summary** | Thinking tokens billable; не обещать raw chain-of-thought. `thinking`, signatures и `redacted_thinking` нужно сохранять/round-trip unchanged в multi-turn/tool loops. |
| Count Tokens | Estimate до вызова для size/cost warning | Не является billing truth и не поддерживает URL/file image/docs, большинство server tools/MCP. Final response `usage` — источник факта. |
| Rate/Cost API | Read rate headers; при Admin access сверять с Rate Limits и Usage & Cost APIs | Admin prerequisites; не доступны individual accounts, Cost API не доступен programmatically на Claude Platform on AWS. Собственный ledger всё равно нужен. |
| Agent SDK | Async events/result, session ID/resume, Claude Code tools | Это local process harness, не multi-tenant backend и не обычный Messages client. Pin SDK/Claude Code version and revalidate release notes. |

---

## 5. Agent SDK policy profiles

### 5.1. Общие правила любого job

- Headless, non-interactive, **bare-equivalent** launch: не читать repository/user/local settings, `CLAUDE.md`, hooks, skills, plugins, auto-memory и `.mcp.json` автоматически.
- В SDK задать `settingSources: []`, `strictMcpConfig: true`, fixed `cwd: /workspace`, минимальный explicit `tools`, explicit `disallowedTools`, `permissionMode: "dontAsk"`, `permissionPrompts: "none"`.
- В production не включать plugins/MCP/hook code из checkout. `PreToolUse` hook допускается только из immutable trusted image как дополнительное policy enforcement; он не является sandbox.
- Не использовать `bypassPermissions` / `--dangerously-skip-permissions` как normal mode. `allowedTools` лишь auto-approves, **не** создаёт allowlist; deny rules и список `tools` обязательны.
- Пользователь не выбирает `cwd`, `additionalDirectories`, image, environment, MCP URL, network proxy, shell command, permissions или mounts.

### 5.2. Разделить capabilities на profiles

| Profile | Разрешение | Запрещено по умолчанию | Применение |
|---|---|---|---|
| `code-read` | `Read`, `Glob`, `Grep` | Write/Edit/Bash/WebFetch/WebSearch/MCP/plugins/subagents | Объяснение кода, review, план изменения. Это default. |
| `code-edit-review` | Read/Glob/Grep + Write/Edit в `/workspace`; final diff only | Bash, network, MCP, external paths, publishing | Малые правки, которые затем обязательно review'ятся. |
| `code-test` | Предыдущий набор + крайне узкий, profile-specific Bash (например, утверждённый test command) | Generic `Bash`, `curl`, `wget`, SSH, Docker, package install, Web tools, MCP | Только disposable worker, sandbox и explicit test time/resource budget. |
| `publish` | **Нет у Agent SDK worker** | Любой agent-originated git push/PR/secret access | Trusted server-side action после approval/policy. |

Ни `allowedTools`, ни модельный prompt сами по себе не гарантируют отсутствие побочных действий. Враждебный issue, README, dependency output, webpage или MCP response рассматриваются как потенциальный prompt injection.

---

## 6. Аутентификация, регионы и billing

### 6.1. Identity и поддерживаемая auth схема

1. **Внешний пользователь** входит только через own IdP (OIDC/SAML/passwordless, MFA для admin). Backend проверяет project membership/role, quotas и job ownership; Claude account не нужен для входа в `claudesk`.
2. **Backend и agent worker** используют Claude Console API credential: initial small closed deployment — отдельный limited service-account API key из secret manager; production при поддерживаемом workload OIDC — WIF/короткоживущие tokens. Разделять credentials/budgets для chat и agent, а при multi-tenant — по tenant/workspace, где это доступно.
3. Не принимать `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, browser session/token, password или Pro/Max credential от end user как путь к Claude.ai. Нельзя хранить/relay таких данных.
4. Cloud-provider варианты (Bedrock, Claude Platform on AWS, Google Cloud Agent Platform, Microsoft Foundry) допустимы только как осознанный альтернативный model provider path с их IAM; не смешивать их с consumer OAuth.

### 6.2. Региональное соответствие: fail closed

- До deployment подтвердить, что **оператор, billing entity, VPS/workload и предполагаемые пользователи** находятся в поддерживаемой для выбранного Anthropic service стране/регионе и соответствуют применимым terms.
- Не размещать forwarding server, VPN, SOCKS/HTTP proxy, relay, residential proxy, geo-spoofing или CDN-routing с целью выдать unsupported location за supported. Egress proxy допускается **только** как security allowlist к официальным endpoint'ам, а не как region-bypass.
- Не предоставлять в UI поля для proxy endpoints и блокировать `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` в worker process, кроме жёстко заданного operator security proxy. Не разрешать shell web clients в profile по умолчанию.
- Если service/region недоступны или compliance непонятен, не запускать job и не предлагать обход: вернуть policy error и запросить compliance/legal/vendor confirmation.

### 6.3. Явное раскрытие API billing

Показать до первого model/code-job request и в Settings/Billing:

> **«Этот self-hosted сервис вызывает Anthropic API. Claude Pro/Max/Free подписка пользователя не покрывает это использование и не применяется для входа. Использование учитывается и оплачивается отдельно по API/Console тарифам оператора; лимиты и возможные внутренние квоты отображаются в продукте.»**

Реализовать:

- собственные per-user/per-project/monthly budgets, rate limits и hard stop до dispatch job;
- preflight estimate через Count Tokens только как estimate; после каждого завершённого response/job — final `usage` (input/output/cache/thinking) и actual-cost ledger;
- price-table version/effective date, model ID, request ID, token counts, stop reason и state кэша в прозрачном usage view;
- предупреждение до дорогого model/thinking/large attachment, alert на budget, отсутствие скрытой маржи/округления или понятное раскрытие своего тарифа;
- периодическую reconciliation с Anthropic Usage & Cost API, когда Admin credentials/plan позволяют; не публиковать Admin key пользователям;
- отдельные модельные credentials и quotas для chat/agent, чтобы code job не съедал непредсказуемо общий budget.

**Существенное правило:** Pro/Max subscription и API/Console billing — разные контуры. API требует отдельного Console setup/usage billing; API key имеет приоритет над subscription при соответствующем запуске Claude Code. Для shared production automation Anthropic указывает Console API key/WIF, а не subscription credential.

---

## 7. Эксплуатационные требования до запуска

### Must-have до public/organization rollout

1. **TLS + own IdP + RBAC:** никакого unauthenticated `POST /chat` или `POST /agent`; MFA/admin separation; API authorization до file, repo, MCP, secret и job dispatch.
2. **Isolation:** per-job container/workspace/UID; no docker socket/host mounts; default-deny egress; resource/time/concurrency limits; immutable image; automated cleanup.
3. **Data:** encrypted backups, restore test, DB/object/Git ACL, retention/delete workflow, data-export/incident process. Notice, что content направляется model provider; standard commercial retention указан как 30 дней, Zero Data Retention требует eligible Enterprise и activation.
4. **Capability gating:** runtime `GET /v1/models`, validation before API call, feature fallback; no hard-coded claims that every model has PDF, thinking, tools, web, code execution or structured outputs.
5. **Observability:** app audit + host/network audit + OTel; `request/job/user/tenant`, authz decision, SDK/CLI version, image digest, repo SHA, effective policy, tool decision/outcome and diff hash. By default redact content. Не включать `OTEL_LOG_TOOL_CONTENT`/raw API bodies без formal data review и protected SIEM retention.
6. **Abuse/cost controls:** input/uploads/concurrency/token budgets, 429 backoff using `retry-after`, request-id logging, cancellation, per-project queue and daily/monthly hard cap.
7. **Supply chain:** pin SDK/Claude Code/image versions; test release updates in staging; trust only operator-managed base image and allowlisted repository source/ref. A repository is untrusted input, not configuration authority.
8. **Review:** all agent-authored diffs/tests visible before merge in MVP; protected branches/CI remain independent. No `dangerously-skip-permissions` in host or production worker.

### Полезные, но не заменяют must-have

- Claude Code managed settings, Bash sandbox, `PreToolUse`, project instructions и permission modes — defence in depth, не tenant/OS isolation.
- Docker Secret/file mode `0600` — delivery/access control, не защита от code/agent в том же container UID.
- Anthropic Enterprise audit export — account audit, а не полная история действий worker; он ограничен планом, 180 днями и не содержит chat/project content.

---

## 8. Ограничения и явно неподдерживаемые варианты

1. **Нет self-hosted Claude inference.** Prompt/output, Files API content и Anthropic server tools остаются в облачной инфраструктуре Anthropic (или выбранного cloud provider).
2. **Нет Claude.ai Projects parity по умолчанию.** Web-app Projects, memory, automated project RAG, internal sharing, artifacts и history search — отдельные product functions, а не API primitive. Для MVP достаточно project ACL + instructions + selected knowledge + messages + repos.
3. **Нет consumer OAuth/proxy.** Не встраивать Claude.ai login, не пользоваться Pro/Max/Free credentials пользователей, не хранить их session tokens и не «продавать» subscription rate limits через продукт без prior approval Anthropic.
4. **Нет обхода регионов.** Не использовать proxy/VPN/relay/geolocation spoofing. Несоответствие региона — причина остановить rollout, не техническая задача для обхода.
5. **Нет произвольного terminal/chat-agent endpoint.** `Agent SDK` job получает заранее выбранный repo/ref/profile; не исполняет user-provided shell, Docker, MCP, host path или arbitrary URL.
6. **Files API не даёт end-user isolation.** Непроверенный `file_id` — potential cross-user data exposure; mapping/ACL и delete policy обязательны.
7. **Thinking не равен открываемому reasoning trace.** Показывать только допустимый summary, сохранять protocol blocks как opaque data и раскрывать additional cost/latency.
8. **Prompt injection остаётся риском.** `dontAsk`, tool deny и sandbox уменьшают, но не исключают его; злоумышленный repo/web/MCP content не должен иметь путь к secrets, network или canonical repo.
9. **Docker не равно microVM.** Для adversarial public multi-tenant code, сильной эксфильтрационной модели или high-value secrets перейти на VM/microVM isolation и отдельный egress/security boundary; описанный Compose baseline предназначен для одного оператора или небольшого закрытого сервиса.
10. **Bash sandbox coverage ограничена.** Он не защищает file/web tools, MCP, hooks, LSP и helpers; `settingSources: []` только отключает settings discovery, не создаёт полноценный sandbox.
11. **Count Tokens и статичные model docs не являются источником окончательного billing/capability.** Использовать final usage и runtime Model API; Admin APIs требуют соответствующих credentials и могут быть недоступны individual accounts.
12. **Legal/commercial terms меняются.** Для prior approval, large-scale shared automation или спорного region/billing scenario обратиться к Anthropic Sales/Legal; этот отчёт не подтверждает наличие исключения.

---

## 9. Поэтапный минимальный rollout

| Этап | Включить | Явно не включать |
|---|---|---|
| 0. Foundation | VPS hardening, TLS, own IdP, PostgreSQL, object storage, bare Git, backups, no public agent endpoint, Console billing/credential, privacy/billing notice | Claude.ai OAuth, public registration без quota, external MCP, agent shell |
| 1. Safe chat | Text + small PDF/image attachments, project ACL/instructions, persistent messages, SSE, Models API picker, final-usage ledger | Client tools, auto-RAG, arbitrary URLs/files, cross-project file reuse |
| 2. Read-only code assistant | `code-read` jobs, ephemeral checkout, no network/MCP/Bash, audit + generated review artifact | Writes, tests, persistent agent home/session sharing |
| 3. Controlled edits | `code-edit-review`, temporary worktree, patch/test record, human Accept diff | Push/merge from agent, arbitrary Bash, generic package install |
| 4. Narrow CI-like test profile | sandboxed one-job worker, preapproved narrow command set, strict egress, approval gates | `bypassPermissions`, Docker socket, host credentials, unrestricted internet |
| 5. Scale only after threat review | Per-tenant isolation/budgets/WIF, security testing, SIEM, perhaps VM/microVM | Assumption that Compose/permission prompt alone is sufficient |

---

## 10. Полный каталог первичных источников

### Claude web app / Projects

| Title | URL |
|---|---|
| What are projects? — Claude Help Center | https://support.anthropic.com/en/articles/9517075-what-are-projects |
| How can I create and manage projects? — Claude Help Center | https://support.anthropic.com/en/articles/9519177-how-can-i-create-and-manage-projects |
| Retrieval augmented generation (RAG) for projects — Claude Help Center | https://support.anthropic.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects |
| Delete or rename a conversation — Claude Help Center | https://support.anthropic.com/en/articles/8230524-how-can-i-delete-or-rename-a-conversation |
| Use Claude’s chat search and memory to build on previous context — Claude Help Center | https://support.anthropic.com/en/articles/11817273-using-claude-s-chat-search-and-memory-to-build-on-previous-context |
| Export your Claude data — Claude Help Center | https://support.anthropic.com/en/articles/9450526-how-can-i-export-my-claude-ai-data |
| Upload files to Claude — Claude Help Center | https://support.anthropic.com/en/articles/8241126-what-kinds-of-documents-can-i-upload-to-claude-ai |
| What are artifacts and how do I use them? — Claude Help Center | https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them |
| Create and edit files with Claude — Claude Help Center | https://support.anthropic.com/en/articles/12111783-create-and-edit-files-with-claude |
| Share artifacts — Claude Help Center | https://support.anthropic.com/en/articles/9547008-publishing-and-remixing-artifacts |
| Enable and use web search — Claude Help Center | https://support.anthropic.com/en/articles/10684626-enabling-and-using-web-search |
| Manage project visibility and sharing — Claude Help Center | https://support.anthropic.com/en/articles/9519189-project-visibility-and-sharing |
| Share and unshare chats — Claude Help Center | https://support.anthropic.com/en/articles/10593882-sharing-and-unsharing-chats |

### Messages API / Claude Platform

| Title | URL |
|---|---|
| Create a Message | https://platform.claude.com/docs/en/api/messages/create |
| Using the Messages API | https://platform.claude.com/docs/en/build-with-claude/working-with-messages |
| Streaming messages | https://platform.claude.com/docs/en/build-with-claude/streaming |
| List Models | https://platform.claude.com/docs/en/api/models/list |
| Models overview | https://platform.claude.com/docs/en/models/overview |
| Token counting | https://platform.claude.com/docs/en/build-with-claude/token-counting |
| Vision | https://platform.claude.com/docs/en/build-with-claude/vision |
| PDF support | https://platform.claude.com/docs/en/build-with-claude/pdf-support |
| Files API | https://platform.claude.com/docs/en/build-with-claude/files |
| Tool use with Claude | https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview |
| Thinking | https://platform.claude.com/docs/en/build-with-claude/thinking |
| Extended thinking | https://platform.claude.com/docs/en/build-with-claude/extended-thinking |
| Rate limits | https://platform.claude.com/docs/en/api/rate-limits |
| Rate Limits API | https://platform.claude.com/docs/en/manage-claude/rate-limits-api |
| Usage and Cost API | https://platform.claude.com/docs/en/manage-claude/usage-cost-api |
| SDKs, CLI, and libraries | https://platform.claude.com/docs/en/cli-sdks-libraries/overview |
| Python SDK | https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/python |
| TypeScript SDK | https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript |

### Claude Agent SDK / Claude Code

| Title | URL |
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

### Auth, terms и billing

| Title | URL |
|---|---|
| Legal and compliance — Claude Code Docs | https://docs.anthropic.com/en/docs/claude-code/legal-and-compliance |
| Authentication — Claude Code Docs | https://docs.anthropic.com/en/docs/claude-code/authentication |
| Agent SDK overview — Claude Code Docs | https://docs.anthropic.com/en/docs/claude-code/sdk |
| Agent SDK Quickstart — Claude Code Docs | https://docs.anthropic.com/en/docs/claude-code/sdk/quickstart |
| Claude Code GitHub Actions — Claude Code Docs | https://docs.anthropic.com/en/docs/claude-code/github-actions |
| Authentication — Claude Platform Docs | https://platform.claude.com/docs/en/manage-claude/authentication |
| Workload Identity Federation — Claude Platform Docs | https://platform.claude.com/docs/en/manage-claude/workload-identity-federation |
| CLI authentication options — Claude Platform Docs | https://platform.claude.com/docs/en/cli-sdks-libraries/cli/authentication |
| Paid Claude subscription vs API/Console — Claude Help Center | https://support.claude.com/en/articles/9876003-i-subscribe-to-claude-pro-why-do-i-have-to-pay-separately-for-api-usage-on-console |
| How do I pay for my Claude API usage? — Claude Help Center | https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-api-usage |
| Use Claude Code with your Pro or Max plan — Claude Help Center | https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan |
| Use the Claude Agent SDK with your Claude plan — Claude Help Center | https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan |
| Consumer Terms of Service — Anthropic | https://www.anthropic.com/legal/consumer-terms |
| Commercial Terms of Service — Anthropic | https://www.anthropic.com/legal/commercial-terms |

### Self-hosted security / monitoring

| Title | URL |
|---|---|
| Claude Code Security | https://docs.anthropic.com/en/docs/claude-code/security |
| Configure permissions | https://docs.anthropic.com/en/docs/claude-code/permissions |
| Configure the sandboxed Bash tool | https://docs.anthropic.com/en/docs/claude-code/sandboxing |
| Agent SDK overview | https://docs.anthropic.com/en/docs/claude-code/sdk |
| Agent SDK reference — TypeScript | https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript |
| Authentication and credential management | https://docs.anthropic.com/en/docs/claude-code/iam |
| Development containers | https://docs.anthropic.com/en/docs/claude-code/devcontainer |
| Monitoring Claude Code | https://docs.anthropic.com/en/docs/claude-code/monitoring-usage |
| Data usage | https://docs.anthropic.com/en/docs/claude-code/data-usage |
| Deploy managed settings | https://docs.anthropic.com/en/docs/claude-code/managed-settings |
| Access audit logs | https://support.anthropic.com/en/articles/9970975-how-to-access-audit-logs |
| Hooks reference | https://docs.anthropic.com/en/docs/claude-code/hooks |

---

## Итоговая рекомендация

Запускать `claudesk` как **operator-funded, API-based, self-hosted control plane**: собственный IdP/RBAC, persistent Projects/metadata/files/bare Git, Messages API BFF и immutable per-job Agent SDK worker. Начать с safe chat и read-only code profiles, затем добавлять edits только через ephemeral checkout + reviewable patch. Эта модель одновременно сохраняет работоспособность (чат, файлы, проекты, repos, кодовые jobs), соблюдает документированный путь authentication/billing и не опирается на неразрешённый consumer OAuth или региональные обходы.
