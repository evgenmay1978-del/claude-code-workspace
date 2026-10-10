# Anthropic Messages API и SDK для self-hosted чата уровня Claude App

> **Scope.** Это исследование охватывает только первичную документацию Anthropic Claude Platform/API и официальные SDK. Под «self-hosted чатом» ниже понимается собственный web/mobile/desktop-интерфейс и backend, развёрнутые оператором приложения; **инференс Claude остаётся облачным Anthropic API**, а не развёртывается локально.

## Вывод в одном абзаце

Anthropic предоставляет почти все **model-facing** возможности, нужные современному чату: Messages API, потоковый SSE, динамический список и capability-манифест моделей, изображения, PDF и загруженные файлы, reasoning/thinking, tool use, подсчёт токенов и организационный мониторинг usage/cost/rate limits. Но это не готовый Claude App: Messages API статeless, а Anthropic не берёт на себя интерфейс, хранение диалогов, идентификацию пользователей, изоляцию tenant-данных, выполнение client tools, политику доступа, UX загрузок и собственные пользовательские лимиты. Их должен реализовать оператор приложения.

## 1. Базовая архитектура: что даёт Messages API

`POST /v1/messages` принимает структурированную историю `messages` (текстовые и мультимодальные content blocks), `system`, выбранную модель и `max_tokens`; в ответ возвращает очередное сообщение ассистента с `content`, `stop_reason`, фактической моделью и `usage` ([Create a Message][messages-api]).

Ключевое последствие для чата: API **stateless**. На каждый новый turn backend обязан передавать требуемую историю диалога; Anthropic не хранит «conversation» как объект Messages API ([Using the Messages API][messages-guide]). Это хорошо подходит для собственного UX и хранилища, но оператор должен сам:

- хранить conversation/message records, системную инструкцию, выбранную модель и служебные content blocks;
- формировать и сокращать/компактировать контекст согласно лимиту выбранной модели;
- обеспечивать idempotency, отмену, retry и сохранение частичных/завершённых ответов;
- не отдавать `ANTHROPIC_API_KEY` в браузер: официальный TypeScript SDK отключает browser use по умолчанию именно во избежание раскрытия секретных API credentials ([TypeScript SDK][ts-sdk]).

**Рекомендуемый контур:** browser/app → собственный authenticated backend/BFF → Anthropic SDK/API. BFF хранит ключи и файлы, применяет per-user квоты/ACL, пишет аудит и проксирует события клиенту.

## 2. Потоковая выдача: SSE

### Подходит для чата

Добавление `stream: true` к Messages request создаёт **Server-Sent Events (SSE)**. Нативный порядок: `message_start` → для каждого content block `content_block_start` / один или несколько `content_block_delta` / `content_block_stop` → `message_delta` → `message_stop`; ping-события возможны в любой момент ([Streaming messages][streaming]).

Нужно отрисовывать не только `text_delta`:

| SSE delta / event | Назначение в чате | Что должен сделать backend/UI |
|---|---|---|
| `text_delta` | Инкрементальный ответ | дописывать текст в активный turn |
| `input_json_delta` | Аргументы client tool приходят кусками JSON | буферизовать и распарсить после `content_block_stop`; не выполнять JSON до валидации |
| `thinking_delta`, затем `signature_delta` | Потоковое thinking при включённом режиме | при выбранном UX показывать summary; сохранять signature вместе с блоком |
| `message_delta.usage` | Финальные/cumulative usage данные | брать итог для записи стоимости/квоты; значения usage в `message_delta` cumulative |
| `error` | Например, `overloaded_error` | корректно завершать turn, показать retriable error, применить backoff |
| незнакомый event | Протокол расширяем | не падать: Anthropic прямо требует graceful handling неизвестных event types |

Official SDKs дают высокоуровневые обёртки: Python/TypeScript и другие клиенты умеют итерировать события, получать text stream и агрегировать финальный `Message`; при необходимости сырые события экономнее по памяти, чем helper, который собирает весь объект ([Streaming messages][streaming], [Python SDK][python-sdk], [TypeScript SDK][ts-sdk]).

### Что реализовать самостоятельно

- Relay SSE к браузеру (или трансляцию в WebSocket), буферизацию по content-block index, lifecycle active message и cancel при disconnect.
- Надёжный UI состояний: generating, tool-running, завершён по `end_turn`/`tool_use`/`max_tokens`/`refusal`, retry/error.
- Политику reconnect: нельзя считать разорванный downstream stream завершённым upstream turn без собственной модели состояния/записи событий.
- Логи `request-id`, model, latency, stop reason и usage. SDK exposes `_request_id`; SDK по умолчанию повторяет connection errors, 408, 409, 429 и 5xx дважды, но продукт всё равно должен иметь свою политику timeout/retry ([Python SDK][python-sdk]).

## 3. Модели и model picker

Для живого selector не надо жёстко прошивать перечень. `GET /v1/models` возвращает доступные модели, сортируя новые первыми, и поддерживает cursor pagination (`after_id`, `before_id`, `limit` 1–1000). Для каждой модели возвращаются `id`, `display_name`, `max_input_tokens`, `max_tokens`, line и **capabilities**: image/PDF input, thinking types, effort levels, citations, code execution, structured outputs, batch и context-management ([List Models][models-api]).

Следовательно, backend может кэшировать `/v1/models`, строить picker из `display_name`, и включать attach/PDF/thinking/tool controls **только** если capability поддержан. Для воспроизводимости сохраните в сообщении фактически использованный `model`/версию; alias может облегчать обновления, pinned model ID фиксирует версию (см. [Models overview][models-overview]).

Текущий обзор Anthropic также сравнивает active lineup, контекст и max output; однако runtime eligibility нужно считать по `/v1/models`, а не по статичной таблице документации.

## 4. Токены, цена и контекст

### В одном запросе

У каждого результата Messages API есть `usage`, минимум `input_tokens` и `output_tokens`; при caching появляются `cache_read_input_tokens` и `cache_creation_input_tokens`. Полный input считается как:

```text
total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens + input_tokens
```

В streaming итоговое usage приходит в `message_delta`. В thinking-ответах реальный объём reasoning следует брать из `usage.output_tokens_details.thinking_tokens`, а не из заданного budget ([Rate limits][rate-limits], [Extended thinking][extended-thinking]).

### До отправки

`POST /v1/messages/count_tokens` принимает почти ту же structured request shape — system, client tools, images и PDF — и возвращает estimate input token count. Это полезно для предупреждения о слишком большом контексте, выбора модели, предварительной квоты и ограничения стоимости ([Token counting][token-counting]). Это **оценка**, а не биллинг; Anthropic также может добавить system tokens, за которые пользователь не платит.

Нельзя использовать Count Tokens как полный универсальный preflight: он отвергает URL/file источники image/document, почти все server tools и MCP connector. Для image/PDF надо передать base64, а с такими tools ориентироваться на фактическое `usage` из ответа.

### Что реализовать самостоятельно

- Настраиваемые product limits на один turn, день/месяц, пользователя, организацию и модель; оценка до запроса + reconciliation по `usage` после него.
- Контекстная стратегия: хранилище полной истории, выбор набора turns, summary/compact на своей стороне, особенно для прикреплённых документов.
- Свой pricing calculator/budget dashboard: API отдаёт токены, а product policy, валюту, маржу, лимиты и user-facing предупреждения определяет приложение.

## 5. Изображения, PDF и файлы

### Images

В `image` content block API принимает три source types: `base64`, `url` и `file_id` от Files API. Поддержаны JPEG, PNG, GIF и WebP; только первый кадр анимации. Direct API limit: 10 MB base64 на image, максимум 8,000×8,000 px, а число — 100/request для 200k context models либо 600 для остальных (при >20 вложениях действует более строгий per-image dimension limit). Визуальные токены считаются по patch formula `ceil(width/28) × ceil(height/28)`; oversized images могут быть downscaled ([Vision][vision]).

Для чата это означает: image attach и follow-up по уже переданному image работают, но UI должен заранее валидировать MIME/размер и показывать, что изображение влияет на контекст и стоимость. Для больших или повторно используемых файлов предпочтителен Files API вместо base64 в каждом request.

### PDF и text documents

`document` content block поддерживает PDF через `url`, base64 или `file_id`. Все active models поддерживают PDF. Claude может работать с text, image, chart и table-содержимым PDF; лимит стандартного незашифрованного PDF — до 600 pages/request (100, если context window <1M) и 32 MB на весь request. Плотные PDF могут исчерпать контекст раньше лимита pages; документы следует делить при необходимости ([PDF support][pdf]).

Plain text (`.txt`, `.csv`, `.md`) можно передать документом после upload с `text/plain`. `.xlsx` и `.docx` **не** поддержаны как document blocks: сначала конвертировать в text или PDF ([PDF support][pdf]).

### Files API

Files API — create-once/use-many-times: upload → `file_id` → использовать `source: {type: "file", file_id: ...}` в image/document content; доступны list/retrieve/delete. Upload/list/delete/free metadata calls бесплатны, но content в Messages тарифицируется как input tokens; file API rate limit ориентировочно 500 RPM ([Files API][files]).

**Критичный multi-tenant факт:** uploaded files доступны всей Anthropic workspace, а не конкретному end user/conversation/session. Нельзя принимать произвольный `file_id` от клиента; mapping user ↔ file ID хранится server-side. Anthropic рекомендует отдельную workspace на tenant ради hard isolation (до 100 workspaces/org без отдельного согласования) ([Files API][files]).

### Что реализовать самостоятельно

- Безопасную upload gateway: MIME/size/antivirus/PII policy, progress, error UX и server-side map attachment→owner→Anthropic `file_id`.
- Удаление/retention policy, ACL и аудит; File API не создаёт end-user isolation.
- Preprocessing/конвертацию DOCX/XLSX, при необходимости OCR, thumbnails и визуальное отображение attachments/citations. Anthropic API принимает поддерживаемые blocks, но не предоставляет UI файлового менеджера Claude App.

## 6. Tools и агентный цикл

Anthropic различает:

- **client tools**: модель возвращает `tool_use`; **ваш код** выполняет действие, затем отправляет `tool_result` в следующем user turn;
- **server tools** (например, web search/fetch, code execution, tool search): выполняются в инфраструктуре Anthropic, результат виден в response без собственного executor в типичном случае ([Tool use][tool-use]).

Для custom client tool объявите `name`, description и JSON `input_schema`; после `stop_reason: "tool_use"` обработайте все `tool_use` blocks, провалидируйте аргументы, выполните разрешённую операцию и приложите `tool_result` с соответствующим `tool_use_id`. Параллельность можно контролировать `tool_choice` (например, `disable_parallel_tool_use`) ([Tool use][tool-use]). TypeScript SDK имеет beta `toolRunner`, упрощающий loop, но это не отменяет обязанность безопасно спроектировать сами tools ([TypeScript SDK][ts-sdk]).

**Оператор чата обязан реализовать:** registry доступных tools по tenant/role, schema validation, авторизацию каждого действия, secret isolation, network/filesystem allowlists, sandbox для кода, timeouts, idempotency, approval UX для необратимых операций, журнал и вывод безопасных tool errors. Нельзя давать модели прямой неограниченный доступ к shell, сети или пользовательским данным только потому, что она запросила tool.

## 7. Extended/adaptive thinking

Thinking — feature модели, а не отдельный reasoning service. Современные модели могут использовать adaptive thinking; старые модели используют manual extended thinking как `thinking: {"type":"enabled", "budget_tokens": ...}`. Поддерживаемую конфигурацию лучше получать из Models API capabilities/документации. `budget_tokens` manual mode: минимум 1,024, обычно меньше `max_tokens`; thinking tokens входят в output limit и биллинг, budget — target, а `max_tokens` — hard ceiling ([Extended thinking][extended-thinking]).

Для UX важно, что видимый thinking — **summary**, не raw chain-of-thought. `display: "summarized"` возвращает summary, а `"omitted"` — block с пустым `thinking`; оба варианта биллятся одинаково. В multi-turn/tool loop нужно вернуть без изменений `thinking`/signature и возможный opaque `redacted_thinking`; отбрасывание этих blocks ломает протокол ([Thinking][thinking]). При streaming приходят `thinking_delta` и перед закрытием блока `signature_delta` ([Streaming messages][streaming]).

**Подходит для чата:** переключатель «reasoning effort/thinking» только для capability-compatible model; optional disclosure panel с summary; отображение дополнительной задержки/расхода. **Нужно реализовать:** UX disclosure, безопасное server-side хранение/round-trip opaque blocks, выбор и стабильность budget/effort, а также объяснение пользователю стоимости/латентности. Нельзя обещать показать полный внутренний chain-of-thought.

## 8. Лимиты и наблюдаемость

Messages API ограничивается **RPM**, **ITPM** и **OTPM** по model class. При превышении — 429 и `retry-after`; резкий рост трафика может вызвать acceleration limits. В response headers есть effective limit, remaining и reset для request/input/output tokens. На большинстве моделей cache reads не считаются в ITPM; это не отменяет их биллинга ([Rate limits][rate-limits]).

Рекомендуемый runtime monitoring:

1. На каждом response сохранять `usage`, `request-id`, model, latency/stop reason и `anthropic-ratelimit-*` headers; при 429 соблюдать `retry-after`.
2. На startup/по расписанию читать **Rate Limits Admin API** (`/v1/organizations/rate_limits`, workspace overrides), вместо hard-code лимитов. Нужен Admin API key/OAuth `org:admin`/unscoped personal-or-service key; workspace API key не подойдёт ([Rate Limits API][rate-limits-api]).
3. Для отчётов сверять собственные ledger records с **Usage & Cost Admin API**: usage report группируется/фильтруется по времени, model, workspace, API key и другим dimensions (1m/1h/1d), cost report выдаёт USD cost по дням. Это источник организации для billing reconciliation и alerting ([Usage and Cost API][usage-cost]).

**Ограничение доступа:** Admin API недоступен individual accounts; Usage & Cost API требует Admin credential и не доступен programmatically на Claude Platform on AWS. Поэтому dashboard конечного пользователя всё равно требует собственного metering, а организационные отчёты — соответствующей учётной записи/ключа.

## Практический минимальный план реализации

| Слой | Использовать у Anthropic | Реализовать у оператора self-hosted чата |
|---|---|---|
| Model API | `/v1/models`, `/v1/messages`, official SDK | picker/capability gating, pinned-model policy, backend proxy |
| Conversation UX | Stateless multi-turn Messages | auth, DB schema, history/context selection, search/share/export, cancellations |
| Streaming | `stream: true` SSE и SDK helpers | SSE/WebSocket relay, delta reducer, reconnect/partial message state, rendering |
| Attachments | vision, PDF document blocks, Files API | uploads/ACL/mapping, scan/retention, format conversion, attachment UI |
| Tools | `tool_use`/`tool_result`, eligible server tools | executor, tool registry, schema validation, sandbox, approvals, audit |
| Thinking | adaptive/extended thinking blocks and usage | controls, summary UI, block preservation, cost/latency policy |
| Cost/limits | usage fields, count tokens, rate headers, Admin APIs | per-user quotas/budgets, alerts, internal ledger, backpressure/retry queue |

## Ограничения и риски решения

1. **Не self-hosted inference.** Описанный путь создаёт self-hosted application shell; модельная обработка, server tools и Files API storage по-прежнему находятся в Anthropic.
2. **Состояние диалога — ответственность приложения.** Не теряйте tool/thinking/redacted content blocks при сериализации истории.
3. **Files API workspace-scoped, не user-scoped.** Без server-side ACL/mapping возможна утечка между пользователями. Не принимайте untrusted `file_id`.
4. **Count Tokens не равен счёту и не поддерживает все источники/tools.** Final usage и Admin Cost API нужны для reconciliation.
5. **Capability и model compatibility меняются.** Получайте доступные модели/возможности из `/v1/models`, валидируйте request и делайте graceful fallback; не базируйте product logic только на статичных именах.
6. **Streaming — не просто печать текста.** Надо обработать partial tool JSON, unknown SSE events, error events, cumulative usage, cancel и backpressure.
7. **Tool use требует production security engineering.** SDK/toolRunner облегчает protocol, но не предоставляет бизнес-авторизацию, sandbox или approval policy.
8. **Организационный мониторинг имеет административные prerequisites.** Admin endpoints недоступны individual accounts; workspace key не даёт нужных прав.

## Первичные источники Anthropic

1. [Create a Message][messages-api]
2. [Using the Messages API][messages-guide]
3. [Streaming messages][streaming]
4. [List Models][models-api] и [Models overview][models-overview]
5. [Token counting][token-counting]
6. [Vision][vision]
7. [PDF support][pdf]
8. [Files API][files]
9. [Tool use with Claude][tool-use]
10. [Thinking][thinking] и [Extended thinking][extended-thinking]
11. [Rate limits][rate-limits] и [Rate Limits API][rate-limits-api]
12. [Usage and Cost API][usage-cost]
13. [SDKs, CLI, and libraries][sdk-overview], [Python SDK][python-sdk], [TypeScript SDK][ts-sdk]

[messages-api]: https://platform.claude.com/docs/en/api/messages/create
[messages-guide]: https://platform.claude.com/docs/en/build-with-claude/working-with-messages
[streaming]: https://platform.claude.com/docs/en/build-with-claude/streaming
[models-api]: https://platform.claude.com/docs/en/api/models/list
[models-overview]: https://platform.claude.com/docs/en/models/overview
[token-counting]: https://platform.claude.com/docs/en/build-with-claude/token-counting
[vision]: https://platform.claude.com/docs/en/build-with-claude/vision
[pdf]: https://platform.claude.com/docs/en/build-with-claude/pdf-support
[files]: https://platform.claude.com/docs/en/build-with-claude/files
[tool-use]: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
[thinking]: https://platform.claude.com/docs/en/build-with-claude/thinking
[extended-thinking]: https://platform.claude.com/docs/en/build-with-claude/extended-thinking
[rate-limits]: https://platform.claude.com/docs/en/api/rate-limits
[rate-limits-api]: https://platform.claude.com/docs/en/manage-claude/rate-limits-api
[usage-cost]: https://platform.claude.com/docs/en/manage-claude/usage-cost-api
[sdk-overview]: https://platform.claude.com/docs/en/cli-sdks-libraries/overview
[python-sdk]: https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/python
[ts-sdk]: https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript
