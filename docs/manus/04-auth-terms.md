# Claude Pro/Max, API billing и аутентификация — обзор официальных материалов Anthropic

**ID:** `04-auth-terms`  
**Проверено:** 2026-10-07  
**Охват:** только первичные страницы Anthropic: документация `docs/platform.claude.com`, Help Center `support.claude.com` и условия `anthropic.com/legal`. Это технический/документальный обзор, а не юридическое заключение.

## Краткий ответ

1. **Claude Pro/Max и Claude API/Console — разные продукты и контуры биллинга.** Подписка Pro/Max даёт доступ к Claude на web/desktop/mobile и к Claude Code в рамках плановых лимитов; доступ к API и Console она сама по себе не включает. Для API требуется отдельно настроить Console и оплачивать API-использование. [Help Center: paid plan vs Console](https://support.claude.com/en/articles/9876003-i-subscribe-to-claude-pro-why-do-i-have-to-pay-separately-for-api-usage-on-console), [Claude Code with Pro/Max](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)
2. **Для стороннего self-hosted web app/server нельзя предлагать Claude.ai login или проксировать запросы через Free/Pro/Max credentials пользователей.** Это сказано прямо в официальной странице Claude Code: разработчикам не разрешено предлагать Claude.ai login в собственных приложениях, направлять запросы от имени пользователей через credentials планов Free/Pro/Max, а также собирать, хранить или посредничать с Claude.ai credentials/session tokens. Для Agent SDK указана та же оговорка: вместо этого использовать API-key authentication из Quickstart, если нет предварительного одобрения Anthropic. [Claude Code Legal & compliance](https://docs.anthropic.com/en/docs/claude-code/legal-and-compliance), [Agent SDK overview](https://docs.anthropic.com/en/docs/claude-code/sdk), [Agent SDK Quickstart](https://docs.anthropic.com/en/docs/claude-code/sdk/quickstart)
3. **Практический fallback для собственного приложения/сервера:** Claude Console **API key** (для разделяемой автоматизации — service-account key) либо **Workload Identity Federation (WIF)**; также в SDK документированы Amazon Bedrock, Claude Platform on AWS, Google Cloud’s Agent Platform и Microsoft Foundry. Для production CI/containers Anthropic называет WIF подходящим вариантом без статического секрета. [API authentication](https://platform.claude.com/docs/en/manage-claude/authentication), [WIF](https://platform.claude.com/docs/en/manage-claude/workload-identity-federation)

## 1. Что именно отличается в оплате

| Тема | Claude Pro / Max subscription | Claude API / Console billing |
|---|---|---|
| Назначение по Help Center | Платные планы для Claude на web, desktop и mobile; дают больше использования и приоритет при высокой нагрузке. | Developer platform: Console, API keys и доступ к моделям для приложений и интеграций. |
| Включает ли одно другое | Нет: платная подписка улучшает чат, но **не включает** доступ к API или Console. | Нужна отдельная настройка Console/API billing, даже если уже есть Pro/Max. |
| Как учитывается Claude Code | При входе с Pro/Max terminal/IDE Claude Code расходует общие с Claude плановые лимиты. | Если Claude Code использует `ANTHROPIC_API_KEY` либо пользователь выбирает API credits, это API usage по стандартным API rates, а не расход включённой квоты Pro/Max. |
| Оплата API | — | Обычно предоплаченные usage credits; для организаций с invoicing arrangement — ежемесячный счёт по фактическому pay-as-you-go usage. API usage, Playground и Claude Code через Console покрываются credits. |
| Термины | Consumer Terms относятся к Claude.ai/Claude Pro для индивидуальных пользователей. | Consumer Terms прямо отсылают API key и Console к Commercial Terms; Commercial Terms разрешают Customer использовать Services для продуктов и сервисов, доступных его end users, при соблюдении условий. |

**Источники:** [Paid plan vs. API/Console](https://support.claude.com/en/articles/9876003-i-subscribe-to-claude-pro-why-do-i-have-to-pay-separately-for-api-usage-on-console), [Claude Code billing with Pro/Max](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan), [How to pay for API usage](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-api-usage), [Consumer Terms](https://www.anthropic.com/legal/consumer-terms), [Commercial Terms](https://www.anthropic.com/legal/commercial-terms).

> Нюанс: в Claude Code при наличии `ANTHROPIC_API_KEY` ключ имеет приоритет над подпиской; Help Center предупреждает, что это приводит к API charges. Чтобы оставаться в лимите Pro/Max, документ предлагает не выбирать API credits и войти только с plan credentials.

## 2. Consumer subscription/OAuth credentials в стороннем self-hosted web app или server

### Прямое официальное правило

Страница **Legal and compliance** для Claude Code разделяет цели OAuth и API keys:

- OAuth предназначен исключительно для покупателей Claude Free/Pro/Max/Team/Enterprise и рассчитан на обычное использование Claude Code и других нативных приложений Anthropic.
- Разработчики продуктов/сервисов, включая использующих Agent SDK, **должны использовать API-key authentication через Claude Console или поддерживаемого cloud provider**.
- Если Anthropic не одобрил заранее иное, разработчик не может: (а) дать Claude.ai login в собственном приложении; (б) маршрутизировать запросы через credentials Free/Pro/Max от имени пользователей; (в) собирать, хранить или посредничать с Claude.ai credentials/session tokens. Вход в Claude account должен происходить через собственный flow Anthropic.

[Официальный источник: Legal and compliance → Authentication and credential use](https://docs.anthropic.com/en/docs/claude-code/legal-and-compliance)

Agent SDK повторяет ограничение в двух местах: overview говорит, что без предварительного одобрения нельзя предлагать Claude.ai login или rate limits своего продукта, включая агенты на Agent SDK; Quickstart предписывает API-key methods. [Overview](https://docs.anthropic.com/en/docs/claude-code/sdk), [Quickstart](https://docs.anthropic.com/en/docs/claude-code/sdk/quickstart)

### Дополнительные условия для consumer account

Consumer Terms говорят, что пользователь не может делиться логином, API key или credentials учётной записи и не может делать свой account доступным другому лицу. Они также запрещают automated/non-human access через bot/script, **кроме** доступа через Anthropic API Key или когда Anthropic явно это разрешает. Это согласуется с выбором Console API key/WIF для серверной автоматизации. [Consumer Terms §§2–3](https://www.anthropic.com/legal/consumer-terms)

### Узкое явно описанное исключение — не общий OAuth для web app

Для продукта, который **предустанавливает или запускает неизменённый Claude Code binary** (например, hosted sandbox/agent infrastructure), документация допускает модель, при которой **каждый end user сам** аутентифицируется собственным API key, plan credentials или credential поддерживаемого cloud provider; usage биллится этому end user. При этом сам продукт должен подпадать под Commercial Terms; ему нельзя платить за usage, перепродавать или посредничать в usage от имени end users. Это исключение не описано как разрешение встроить Claude.ai OAuth в произвольный self-hosted web app. [Legal and compliance → Can customers offer Claude Code in their products?](https://docs.anthropic.com/en/docs/claude-code/legal-and-compliance)

### Fallback, прямо вытекающий из документов

| Сценарий | Официально документированный вариант | Важная граница |
|---|---|---|
| Собственный self-hosted web app/backend или Agent SDK product | Console API key; для shared workload — service-account key; при наличии OIDC identity — WIF. | Не принимать/не хранить Claude.ai OAuth credentials пользователей и не проксировать ими запросы. |
| Production server, container, Kubernetes, CI/CD | WIF: короткоживущий token из AWS/GCP/Azure/GitHub Actions/Kubernetes/совместимого OIDC IdP, привязанный к service account. | Требуются Console setup: service account, issuer и federation rule. |
| Claude Code GitHub Actions в собственном repo | `ANTHROPIC_API_KEY` или, технически, `CLAUDE_CODE_OAUTH_TOKEN` для plan subscriber. | Для org-level/repo-shared secret документация рекомендует API key, поскольку OAuth token привязан к subscription человека, который выполнил `claude setup-token`; для исключительных случаев документов — contact sales. |
| Платформа, размещающая неизменённый Claude Code | Каждый end user проходит собственную auth в unmodified binary (API key/plan/cloud credential). | Нельзя оплачивать, перепродавать или intermediate usage за пользователя; применимы Commercial Terms. |

## 3. Поддерживаемые Anthropic способы auth для автоматизации, Agent SDK и Claude Code

Ниже — не попытка перечислить все значения переменных, а именно способы, которые официальные страницы называют поддерживаемыми.

| Вариант | Где и для чего документирован | Вывод для автоматизации |
|---|---|---|
| **Console API key** (`ANTHROPIC_API_KEY`) | Claude API: API key из Console; Agent SDK Quickstart задаёт этот ключ; Claude Code учитывает его и в `-p` non-interactive mode. | Подходит для local dev, prototype, scripts и servers с контролируемым secret storage. Для общей автоматики есть service-account key. |
| **WIF** | Claude API auth: short-lived bearer credentials от IdP; best for production cloud workloads, CI/CD и Kubernetes. Claude Code может использовать federation profile/variables; SDK автоматически меняет полученный short-lived token. | Предпочтительный документированный вариант для production server/CI/container без долгоживущего статического API secret. |
| **Cloud-provider credentials** | Agent SDK Quickstart и Claude Code Auth: Amazon Bedrock, Claude Platform on AWS, Google Cloud’s Agent Platform, Microsoft Foundry. | Поддерживаемый выбор, когда inference идёт через соответствующую платформу и её IAM/credentials. |
| **`apiKeyHelper` / `ANTHROPIC_AUTH_TOKEN`** | Claude Code Auth: helper выдаёт API key, в том числе short-lived token из vault; bearer `ANTHROPIC_AUTH_TOKEN` для LLM gateway/proxy. Эти источники применяются к CLI, VS Code extension, Agent SDK и GitHub Actions. | Подходят для динамических/rotating credentials или настроенного gateway, а не как Claude.ai user-login integration. |
| **Claude Console user OAuth profile (`ant auth login`)** | `ant` CLI; workspace-scoped Console OAuth. | Страница CLI прямо ограничивает его local development/scripting на собственной машине; для non-interactive CI, servers и containers рекомендует WIF. |
| **Pro/Max subscription OAuth via `/login`** | Claude Code для нативного interactive use; default auth для Pro/Max/Team/Enterprise. | Поддерживается для Claude Code, но не как OAuth, встраиваемый третьим разработчиком в его web app/service. Долгая unattended сессия может остановиться после невозможности refresh login. |
| **`CLAUDE_CODE_OAUTH_TOKEN` из `claude setup-token`** | Claude Code: one-year token для CI pipelines/scripts, требует Pro/Max/Team/Enterprise; GitHub Action также принимает его как repo secret. | Это документированная техническая опция для CI/scripts Claude Code. Она не отменяет прямого запрета для third-party developer на Claude.ai login/маршрутизацию через plan credentials от имени пользователей; для разделяемой production automation документация указывает Console API key/WIF. |
| **App Attest** | API auth page: short-lived access token для зарегистрированного iOS/macOS app, который вызывает Messages API прямо с устройства без backend/proxy. | Специализированный официальный вариант только для genuine attested iOS/macOS installations, не для self-hosted web server. |

**Детали о OAuth setup token:** `claude setup-token` открывает browser authorization flow, печатает token и не сохраняет его; token аутентифицируется с subscription, требует Pro/Max/Team/Enterprise и делает только model requests. В `--bare` этот token не читается — документация предписывает API key или `apiKeyHelper`. [Claude Code Authentication → Generate a long-lived token](https://docs.anthropic.com/en/docs/claude-code/authentication), [CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-reference), [Claude Code GitHub Actions](https://docs.anthropic.com/en/docs/claude-code/github-actions)

## 4. Важное состояние документации о Agent SDK и subscription usage

Текущая страница Help Center **Use the Claude Agent SDK with your Claude plan** содержит заметное обновление: изменения, анонсированные на 15 июня (отдельный месячный Agent SDK credit), **приостановлены**; на момент страницы «ничего не изменилось», и Agent SDK, `claude -p` и third-party app usage продолжают расходовать subscription usage limits. Остальная часть этой статьи помечена как сохранённый для справки текст до 15 июня и «не вступает в силу». Поэтому нельзя использовать её архивные таблицы будущих credits как текущую политику биллинга. В той же статье Anthropic отдельно говорит, что shared production automation at scale следует вести через Claude Platform с API key для предсказуемого pay-as-you-go billing. [Официальная статья](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

## Источники (все официальные Anthropic)

1. [Legal and compliance — Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code/legal-and-compliance)
2. [Authentication — Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code/authentication)
3. [Agent SDK overview — Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code/sdk)
4. [Agent SDK Quickstart — Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code/sdk/quickstart)
5. [Claude Code GitHub Actions — Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code/github-actions)
6. [Authentication — Claude Platform Docs](https://platform.claude.com/docs/en/manage-claude/authentication)
7. [Workload Identity Federation — Claude Platform Docs](https://platform.claude.com/docs/en/manage-claude/workload-identity-federation)
8. [CLI authentication options — Claude Platform Docs](https://platform.claude.com/docs/en/cli-sdks-libraries/cli/authentication)
9. [Paid Claude subscription vs API/Console — Claude Help Center](https://support.claude.com/en/articles/9876003-i-subscribe-to-claude-pro-why-do-i-have-to-pay-separately-for-api-usage-on-console)
10. [How do I pay for my Claude API usage? — Claude Help Center](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-api-usage)
11. [Use Claude Code with your Pro or Max plan — Claude Help Center](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)
12. [Use the Claude Agent SDK with your Claude plan — Claude Help Center](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
13. [Consumer Terms of Service — Anthropic](https://www.anthropic.com/legal/consumer-terms)
14. [Commercial Terms of Service — Anthropic](https://www.anthropic.com/legal/commercial-terms)

## Ограничения

- Это пересказ опубликованных страниц, а не оценка конкретной архитектуры, договора или юрисдикции. При варианте, который Anthropic формулирует как «unless previously approved»/«unless we’ve mutually agreed otherwise», сами документы направляют к [Contact Sales](https://www.anthropic.com/contact-sales).
- Страницы Help Center и документация меняются; особенно помечена как переходная/приостановленная статья об Agent SDK monthly credit. Перед внедрением следует сверить актуальную версию по ссылкам выше.
- В обзоре намеренно не использованы неофициальные блоги, форумы, GitHub issues или сторонние толкования.
