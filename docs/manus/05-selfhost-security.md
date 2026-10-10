# Self-hosted Claude Code / Agent SDK: минимальная модель безопасности для VPS

**Назначение:** один пользователь или небольшой закрытый сервис, запускающий Agent SDK в Docker Compose на собственном VPS. Это не модель для обработки недоверенного multi-tenant кода в общем контейнере и не замена полноценной песочницы уровня VM/microVM.

## Базовый вывод

Agent SDK — это библиотека, которая запускает бинарный Claude Code в процессе, который эксплуатирует владелец приложения. Ему доступны те же встроенные инструменты: чтение и запись файлов, shell-команды, web, MCP, hooks, сессии и subagents. Поэтому SDK нужно рассматривать не как «API чата», а как запуск недоверенного, управляемого моделью subprocess с теми правами, файлами, сетью и секретами, которые вы ему дали.[4]

Надёжная минимальная схема — **два независимых барьера**. Первый — политика Claude Code/SDK: минимальный набор инструментов, deny-правила и режим без неявных согласований. Второй — ОС-изоляция: отдельный непривилегированный контейнер или VM на задачу, изолированная файловая система и allowlist egress. Первый ограничивает *действия, которые разрешит harness*; второй остаётся в силе при prompt injection, ошибке конфигурации или обходе prompt-based решения. Anthropic прямо рекомендует контейнер/VM как границу для всего процесса, поскольку встроенный Bash sandbox не охватывает многие другие пути исполнения.[3]

## Trust prompts и permission modes

Workspace trust — это полезное предупреждение при интерактивном запуске в незнакомой папке; отдельное подтверждение требуется и для MCP-серверов из `.mcp.json`. Это **не** boundary для автоматизированного сервиса: в `-p`-сессии нет ни trust dialog, ни MCP approval prompt. Не запускайте agent в checkout, который пользователь или внешняя система может подготовить как недоверенный; добавление проектных instructions/MCP/hooks превращает содержимое репозитория в часть доверенной конфигурации.[1]

В Manual mode запись, shell, WebFetch и WebSearch требуют подтверждения, тогда как базовые read-only операции в рабочей области не требуют его. Auto mode отдаёт решение отдельному classifier; Accept Edits автоматически разрешает редактирование и некоторые файловые shell-команды; bypass permissions ослабляет проверки. Для unattended API эти режимы не дают человеческого review. В качестве безопасного baseline используйте `permissionMode: "dontAsk"` (непредодобренный вызов отклоняется), минимальный `tools` и конкретный `allowedTools`; только если приложение действительно умеет проводить собственное решение, подключайте `canUseTool`/host approval. Режим `permissionPrompts: "none"` также отклоняет операции, которые потребовали бы prompt.[2] [5]

`allowedTools` — **не allowlist возможностей**: он лишь auto-approve перечисленные инструменты, остальные могут пройти согласно permission mode или callback. Для запрета используйте `tools` (не передавать лишние инструменты), `disallowedTools` и policy deny. Bare deny, например `"Bash"`, удаляет инструмент из контекста модели; scoped deny, например `Bash(rm *)`, блокирует совпадение даже в `bypassPermissions`. Порядок разрешений — deny, затем ask, затем allow; более узкий allow не является исключением из широкого deny.[2] [5]

Практический профиль для режима **«анализ без исполнения»**: `tools: ["Read", "Glob", "Grep"]`, `permissionMode: "dontAsk"`, `settingSources: []`, `strictMcpConfig: true`, без plugins, Web-инструментов, Write/Edit/Bash/Agent и MCP. Для режима **«изменить код и прогнать тест»** добавляйте ровно нужные Write/Edit/Bash правила, но только в отдельном ephemeral worker; не включайте `bypassPermissions` и не используйте `--dangerously-skip-permissions`. `PreToolUse` hook может deny/ask/allow и изменять input, но это дополнительный policy enforcement, не изоляция: сам hook является исполняемым кодом и должен быть только из доверенного неизменяемого образа.[12]

## Файлы, subprocess и sandbox

Рабочая папка в Manual mode — лишь permission boundary: после одобренного Bash команда всё равно может писать туда, куда имеет право Unix-пользователь. В Agent SDK `cwd` определяет каталог, `additionalDirectories`/`addDirs` расширяют доступ, а по умолчанию SDK загружает user, project и local filesystem settings. Для сервисного worker явно задавайте `cwd` как единственный job workspace и `settingSources: []`; не используйте `$HOME` хоста, общий каталог проектов или произвольные дополнительные директории. В TypeScript `env` по умолчанию наследуется от `process.env`; при явной передаче он **заменяет**, а не merge-ит окружение subprocess. Формируйте маленький allowlist окружения вместо передачи окружения web/API-процесса целиком.[5]

Встроенный sandbox — OS-enforced граница для **Bash/PowerShell/Monitor и их дочерних процессов**. На Linux он использует `bubblewrap` и `socat`. Он выключен по умолчанию; при включении shell по умолчанию пишет только в working directory, user temp и добавленные dirs, а network идёт через proxy с пустым стартовым allowlist. Для разрешённых shell-задач включайте sandbox, задавайте точный `filesystem.allowWrite`/deny и `network.allowedDomains`, оставляйте `allowUnsandboxedCommands: false`, а `excludedCommands` пустым. Не разрешайте Docker socket/Unix sockets и не включайте `enableWeakerNestedSandbox` в качестве единственной защиты: Anthropic прямо характеризует этот nested-Docker режим как существенно более слабый.[3]

Критическое ограничение: Bash sandbox **не** охватывает Read/Edit/Write/WebFetch/WebSearch, MCP servers, command hooks, plugin monitors, LSP и другие helper-процессы; они работают с полными правами процесса. Sandbox `denyRead` не блокирует встроенный Read, а network allowlist не ограничивает WebFetch. Он также наследует environment, включая секреты. Поэтому Docker/VM boundary нужна даже когда built-in sandbox включён. Не давайте worker `privileged`, host PID/network namespace, `docker.sock`, `CAP_SYS_ADMIN`, host home или writable mount вне job workspace; запускайте non-root, root filesystem делайте read-only, предоставляйте отдельные tmpfs для `/tmp` и домашнего каталога, ограничивайте CPU/RAM/PIDs и удаляйте container/workspace после job.[3]

В контейнере не подменяйте защиту флагом `--dangerously-skip-permissions`: Anthropic отмечает, что он позволяет модифицировать весь bind-mounted workspace и позволяет exfiltrate всё, что доступно внутри container, включая credentials. Dev container — полезная изоляция, но только при недоверии к host mounts и в связке с egress policy; не монтируйте `~/.ssh` или cloud credentials.[7]

## Сеть и prompt injection

Permission prompts снижают риск prompt injection, но не являются гарантией. В Manual mode `curl`/`wget` не pre-approve, а неанализируемая командная строка fail-closed запрашивает согласие. В сервисе без человека в loop исходите из того, что текст issue, README, веб-страница, dependency output и MCP response может содержать injection: модель не должна иметь инструментов, которых не требуется задаче.[1]

На уровне Compose поставьте agent worker в отдельный bridge network без опубликованных портов. Egress firewall/security group/proxy должен разрешать лишь API/auth endpoints провайдера модели и явно нужные git/package domains. Не допускайте broad `github.com` как «надёжный DNS boundary»: Anthropic предупреждает, что proxy принимает решение по client-supplied hostname и без TLS inspection возможны domain-fronting-подобные обходы. При более сильной модели угроз применяйте собственный TLS-terminating/inspecting proxy либо более жёсткую сетевую сегментацию.[3]

## Секреты и данные

На Linux Claude Code хранит login в `~/.claude/.credentials.json` с mode `0600`, но это защищает от других Unix accounts, а не от agent/плагина/MCP, работающего как тот же account. Не сохраняйте этот каталог в общий persistent volume. Для серверного worker применяйте отдельный сервисный API key или короткоживущий credential из vault/workload identity, передавайте его только worker и ротуйте. `apiKeyHelper` поддерживает динамические ключи, но сам запускает shell script и относится к доверенной инфраструктуре. Не помещайте production cloud/SSH/Git tokens в environment: sandboxed child commands наследуют окружение с секретами.[3] [6]

Технически Docker Secret удобнее, чем запись ключа в image или Compose file, но не решает проблему доступа процесса: если модель получила Read или unsandboxed subprocess в том же worker, секрет, доступный процессу, может быть прочитан или эксфильтрован. Архитектурно отделите API/frontend от agent worker; храните секреты control plane вне workspace; выдавайте worker только ключ модели и только на время задачи. При необходимости push/PR создавайте репозиторный short-lived token с минимальным scope, а не предоставляйте персональный PAT.

Self-hosted исполнение не означает, что prompts остаются только на VPS. Для local Claude Code все user prompts и model outputs отправляются к model provider по TLS 1.2+; для commercial Team/Enterprise/API обычное retention — 30 дней, а Zero Data Retention требует подходящего Enterprise account и отдельного включения. Локальные session transcripts по умолчанию хранятся plaintext в `~/.claude/projects/` 30 дней. Для ephemeral jobs не монтируйте этот home persistent, задайте `persistSession: false` где это подходит и настройте очистку.[9]

## Один пользователь и небольшой закрытый сервис

Для **одного оператора** не публикуйте agent endpoint в интернет: предпочтительны VPN/SSH/reverse proxy с сильной аутентификацией, отдельный Unix/Docker service account и один выделенный workspace на job. Никаких общих home directories, credentials cache или session volumes между задачами. Пользователь всё равно должен ревьюить PR/diff и команды, если сервис имеет write/exec capability: Anthropic относит review к ответственности пользователя.[1]

Для **нескольких пользователей** SDK не создаёт вашу модель identity, RBAC, tenant isolation, rate limits или расходные лимиты. Официальный SDK предназначен для процесса, которым управляете вы, и запрещает third-party developers предлагать в своём продукте Claude.ai login или rate limits; используйте API-key auth, а внешний IdP, роли, quotas, job ownership и authz для проекта реализуйте в своём приложении.[4] Обязательные серверные правила: TLS reverse proxy с SSO/MFA или индивидуальными сервисными accounts; один контейнер/Unix UID и workspace на user/job; авторизация *до* checkout, MCP, secret issuance и вызова agent; раздельные model credentials/budget per tenant; запрет пользователю выбирать host path, image, Compose mounts, MCP URL или shell environment.

Team/Enterprise роли Anthropic управляют доступом к собственному plan: Enterprise даёт custom roles/SSO и Owner/Primary Owner права на audit logs; Team не является заменой RBAC вашего VPS-сервиса. Пользовательские и project settings могут добавлять permissions, hooks и plugins; централизованно непреодолимые rules доступны как managed settings, но файл `/etc/claude-code/managed-settings.json` в image не является непреодолимым, если пользователь может менять Dockerfile/repository. В self-hosted сервисе неизменяемый image, deploy credentials и host должны быть отделены от tenant write access.[10] [11]

## Наблюдаемость и auditability

Локально записывайте в удалённое, append-only хранилище: `request/job/user/tenant id`, время, image digest, SDK/Claude Code version, authz decision, workspace/repo revision, effective SDK policy, старт/конец job, tool decision и outcome, сетевые deny/allow, файлы/артефакты и hash diff. Не делайте transcript или tool output доступными всем операторам по умолчанию; в них могут быть source code и secrets. Логи должны иметь retention, доступ по least privilege и процедуру удаления.

Claude Code экспортирует usage, logs/events и tracing через OpenTelemetry. Tool details, prompts, responses, tool content и raw API bodies **redacted/disabled по умолчанию**; `OTEL_LOG_TOOL_DETAILS=1` позволит зафиксировать команды и tool arguments, но повышает риск утечки в SIEM. Не включайте `OTEL_LOG_TOOL_CONTENT` или `OTEL_LOG_RAW_API_BODIES` без отдельной оценки класса данных и защищённого retention; raw bodies содержат всю историю диалога. Связывайте собственный request ID с OTel событиями и экспортируйте OTel в collector, который контролируете.[8]

Не рассчитывайте на Anthropic audit logs как на аудит действий вашего worker: это Enterprise-only export за последние 180 дней, доступный Owner/Primary Owner, и он не содержит title/content chats или projects (только идентификаторы). Для customer-managed encryption keys export button недоступен и нужен Compliance API. Следовательно, для VPS-сервиса application/host audit trail остаётся обязательным.[11]

## Минимальный Compose baseline

1. **Ingress/API:** reverse proxy публикует только HTTPS; API проверяет identity, membership, quota и project authorization. Agent worker не имеет `ports`.
2. **Worker per job:** disposable non-root container, read-only rootfs, `cap_drop: [ALL]`, `no-new-privileges`, лимиты ресурсов; единственный writable bind/volume — созданный сервером workspace. Никогда не монтировать `/var/run/docker.sock`, host `$HOME`, `/`, SSH/GPG/cloud credentials.
3. **Policy inside worker:** `settingSources: []`, `strictMcpConfig: true`, explicit `tools`, explicit `disallowedTools`, `permissionMode: "dontAsk"`, `permissionPrompts: "none"`; добавлять только необходимый инструментарий. `allowedTools` применять точечно, понимая, что это не allowlist.
4. **Shell jobs:** built-in sandbox включён с filesystem/network allowlist; без `excludedCommands`, `allowUnsandboxedCommands`, weakened nested sandbox и bypass mode. При запуске agent внутри Docker проверяйте, что sandbox действительно активен, а не деградировал.
5. **Egress:** default-deny за пределами worker; короткий host/domain allowlist, DNS/HTTPS logging, отдельная policy для package installs. Секреты и production systems не должны быть достижимы из agent network.
6. **Secrets/data:** выделенный key на service/tenant, short-lived если возможно, no host credential mounts, ephemeral `CLAUDE_CONFIG_DIR`/home, cleanup workspaces and transcripts. Помните о внешней передаче prompts к model provider и retention.[9]
7. **Audit:** независимый OTel/SIEM plus app and host logs; redact secrets, lock down log readers, retain enough immutable events to расследовать tool use и network access.[8]

## Upstream ограничения, которые нельзя «закрыть» одной настройкой

- Permission system и trust prompts — harness-level controls. Они не заменяют container/VM и не работают как interactive review в non-interactive automation; `-p` не показывает trust/MCP prompts.[1]
- Sandbox охватывает только shell и дочерние shell processes. File tools, WebFetch, MCP, hooks, LSP и helpers находятся вне него; read/network policy sandbox не переносится автоматически на эти инструменты.[3]
- Встроенный network proxy не выполняет TLS inspection; broad allowlist доменов может допустить обход через domain fronting. Для строгого egress нужен иной сетевой контроль.[3]
- Docker/devcontainer не делает доступные внутри него secrets безопасными от malicious repository/agent при skip permissions; nested weak sandbox заметно ослабляет Linux isolation.[3] [7]
- `settingSources: []` не является полным продуктовым multi-tenant isolation. Его задача — отключить user/project/local settings; надо также явно выбрать tools, MCP (`strictMcpConfig`), plugins, trusted `cwd` и process environment.[5]
- SDK не поставляет public-service user auth/RBAC/tenant isolation; Claude.ai login/rate limits нельзя перепродавать через third-party Agent SDK service. Эти границы должны находиться в вашем API/IdP и deployment.[4]
- Self-hosting agent loop не исключает передачу prompt/output в Anthropic или выбранный model provider и не отменяет account-level retention. Enterprise audit export ограничен планом, сроком и полями, поэтому не является полнотой execution audit.[9] [11]

## References

[1]: https://docs.anthropic.com/en/docs/claude-code/security "Claude Code Security"
[2]: https://docs.anthropic.com/en/docs/claude-code/permissions "Configure permissions"
[3]: https://docs.anthropic.com/en/docs/claude-code/sandboxing "Configure the sandboxed Bash tool"
[4]: https://docs.anthropic.com/en/docs/claude-code/sdk "Agent SDK overview"
[5]: https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript "Agent SDK reference — TypeScript"
[6]: https://docs.anthropic.com/en/docs/claude-code/iam "Authentication and credential management"
[7]: https://docs.anthropic.com/en/docs/claude-code/devcontainer "Development containers"
[8]: https://docs.anthropic.com/en/docs/claude-code/monitoring-usage "Monitoring Claude Code"
[9]: https://docs.anthropic.com/en/docs/claude-code/data-usage "Data usage"
[10]: https://docs.anthropic.com/en/docs/claude-code/managed-settings "Deploy managed settings"
[11]: https://support.anthropic.com/en/articles/9970975-how-to-access-audit-logs "Access audit logs"
[12]: https://docs.anthropic.com/en/docs/claude-code/hooks "Hooks reference"
