# Claude web app: подтверждённые функции, доступность и ограничения

> **Методика:** только официальные статьи Claude Help Center / Anthropic, открытые целиком по URL. Описывается текущий веб-интерфейс Claude; не включены функции, которые источники не подтверждают.

## 1. Projects и knowledge/files

- **Projects** — изолированные рабочие пространства со своей историей чатов и базой знаний; в них можно вести сфокусированные диалоги, добавлять контент и задать project instructions. Доступны на **Free, Pro, Max, Team и Enterprise**; у Free — **не более 5 проектов**. [Источник 1](#источники)
- Файлы, текст и код, добавленные в **Project knowledge / Files**, используются во всех чатах данного проекта; инструкции тоже применяются ко всем его чатам. **Контекст между отдельными чатами не передаётся автоматически**, если его не поместить в knowledge base. Обычный чат можно переместить в проект или между проектами. [Источник 2](#источники)
- На **платных планах** (Pro, Max, Team, Enterprise) при приближении базы знаний к пределу контекста автоматически включается **RAG**, увеличивая ёмкость project knowledge **до 10×**; Claude ищет релевантное в загруженных документах, а не постоянно загружает весь массив в контекст. Ручной настройки и ручного выбора момента включения нет. [Источник 3](#источники)
- Project можно архивировать и затем разархивировать; при архивации сохраняются knowledge и права доступа. Удалить архивный project нельзя, пока он не разархивирован. [Источник 2](#источники)

## 2. История диалогов, поиск и memory

- В веб-приложении историю можно открыть через **Chats and tasks**, переименовывать и удалять по одному или массово. Удалённый чат сразу исчезает из истории и удаляется из систем Anthropic в течение **30 дней**; projects и другие данные аккаунта при этом не удаляются. [Источник 4](#источники)
- **Search past chats** доступен на **Pro, Max, Team и Enterprise** в web, Desktop и Mobile. Claude может по запросу искать по прежним чатам: по всем чатам вне Projects либо только внутри конкретного Project; это RAG-инструмент и его вызов виден в текущем чате. Функцию можно выключить в Settings → Memory. [Источник 5](#источники)
- **Memory** включена по умолчанию для Free/Pro/Max на web, Desktop и Mobile. В Team/Enterprise её доступность определяет владелец организации (для участника она выключена, пока он её не включит). У каждого Project отдельная память и summary, отделённые от непроектных чатов. Memory можно выключить для одного нового чата до первого сообщения либо приостановить/сбросить на уровне аккаунта; reset необратимо удаляет памяти, включая project memories. [Источник 5](#источники)
- **Incognito chat** не сохраняется в history и не используется при поиске прошлых чатов. Но в Team/Enterprise такой чат всё же попадает в стандартные data exports и подчиняется политике хранения организации; поиск прошлых чатов недоступен при Enterprise customer-managed encryption keys. [Источник 5](#источники)
- Экспорт пользовательских данных, включая conversation data, доступен Free/Pro/Max из Settings → Privacy на web или Desktop; на Team/Enterprise экспорт доступен только Primary Owner. Импортировать экспорт в другой личный аккаунт нельзя. [Источник 6](#источники)

## 3. Загрузка файлов и изображений

- В отдельный чат можно прикреплять PDF, DOCX, CSV, TXT, HTML, ODT, RTF, EPUB, JSON и XLSX; изображения — JPEG, PNG, GIF, WebP. Возможна загрузка через кнопку, drag-and-drop и вставка изображения из буфера. **XLSX требует включённого code execution and file creation.** [Источник 7](#источники)
- Лимиты **chat upload**: до **500 MB на файл**, до **20 файлов на чат**, изображения до **8 000 × 8 000 px**, PDF до **1 000 страниц**. Claude анализирует текст и визуальные элементы PDF до 100 страниц; у PDF 101–1 000 страниц — только текст. В не-PDF документах извлекается только текст, встроенные изображения не интерпретируются. [Источник 7](#источники)
- Для **Project files** лимит — **30 MB на файл**; число файлов не ограничено, но суммарное содержимое должно поместиться в контекстное окно и могут действовать токенные лимиты. Для project files обычно только извлечение текста, кроме multimodal PDF. [Источник 7](#источники)

## 4. Artifacts и создание файлов

- **Artifacts** — самостоятельные результаты Claude (документы, код, одностраничные сайты, изображения, диаграммы, dashboards и небольшие интерактивные инструменты), которые открываются рядом с разговором, редактируются и сохраняются. Они доступны в чате на **Free, Pro, Max, Team, Enterprise**; в web и Desktop их можно создавать, редактировать и делиться ими. Все созданные artifacts доступны из вкладки **Artifacts**. [Источник 8](#источники)
- Для artifacts требуется включить **Cloud code execution and file creation**. Шаблоны Docs/Slides/Design — beta только на платных планах; у Enterprise владелец должен включить каждый из них. [Источник 8](#источники)
- Code execution/file creation на web, Desktop и Mobile доступен всем планам и позволяет создавать скачиваемые **.xlsx, .pptx, .docx и PDF**. Максимум upload/download для этой возможности — **30 MB на файл**. Владельцы Team/Enterprise могут отключить capability; сетевой доступ в Team/Enterprise настраивается отдельно и по умолчанию ограничен/отключён в зависимости от плана. [Источник 9](#источники)
- Artifacts изначально **приватны**. Для новых artifacts «anyone with the link» доступно Pro/Max/Team/Enterprise (в Team/Enterprise внешний доступ зависит от разрешения Owner); внутренняя публикация — Team/Enterprise, groups — Enterprise. Email-invites находятся в beta на Pro/Max/Team/Enterprise и имеют лимит **50 внешних приглашённых на artifact**. Открывающему shared artifact обычно нужен Claude account; исключение — legacy artifact, опубликованный из чата. Некоторые artifacts нельзя расшарить наружу: подключающиеся к apps или использующие Claude, а в Team/Enterprise пока и Docs. [Источник 10](#источники)

## 5. Web search / web access

- Claude может искать live web для актуальной информации и выдаёт **цитаты, ссылки и при необходимости выдержки**. При включённом Web search он также может делать **web fetch** по переданному URL и показывать результаты image search; изображения предоставляются поиском Bing и имеют ссылку на источник. [Источник 11](#источники)
- Web search подтверждён для указанных Anthropic моделей: **Sonnet 5.5, Opus 5.5, Fable 5.1, Opus 5, Sonnet 5, Fable 5, Opus 4.8, Opus 4.7, Sonnet 4.6, Opus 4.6, Haiku 4.5**. В привычном интерфейсе включается/выключается на старте чата через «+» → Web search; в новом Claude experience отдельного toggle нет и Claude ищет веб, когда это полезно. [Источник 11](#источники)
- Для Team/Enterprise Owner/Primary Owner должен сначала включить Web search для всего workspace. Ограничения: доступность зависит от connectivity, ссылки иногда не работают, время поиска зависит от запроса, а search/fetch расходуют usage limit. У Free лимит сбрасывается каждые 5 часов; fetch длинного URL может заметно израсходовать контекст/лимит. Claude может учитывать приблизительную геолокацию по IP для локальных запросов. [Источник 11](#источники)

## 6. Sharing и организация

- **Projects:** совместный доступ и видимость Projects доступны только **Team/Enterprise** и могут быть отключены администраторами. Project бывает private (только приглашённые) либо public для всей **своей организации**; public project можно найти через Organization tab. В public project сами чаты остаются приватными, пока их не расшарят отдельно. Роли: **Can view** (просмотр knowledge/instructions и чат в проекте) и **Can edit** (правка knowledge/instructions и состава участников). Group-sharing — beta только Enterprise; доступ ограничен участниками той же организации. [Источник 12](#источники)
- **Чаты:** приватны по умолчанию. У Free/Pro/Max link открывает snapshot сообщений до момента публикации (последующие сообщения приватны до обновления snapshot); приложенный файл и raw MCP-tool data не входят в shared snapshot. Team/Enterprise могут делиться чатами только с участниками своей организации, не публично. Ссылку можно отключить; Free/Pro/Max также видят журнал shared chats в Settings → Privacy. [Источник 13](#источники)
- При шаринге artifact, созданного в чате, проверяйте вложения: официальный Help Center предупреждает, что viewers получают доступ к attachments/files этого чата. Это отличается от chat snapshot, где attached file сам по себе не включается. [Источник 10](#источники)

## Источники

1. [What are projects? — Claude Help Center](https://support.anthropic.com/en/articles/9517075-what-are-projects)
2. [How can I create and manage projects? — Claude Help Center](https://support.anthropic.com/en/articles/9519177-how-can-i-create-and-manage-projects)
3. [Retrieval augmented generation (RAG) for projects — Claude Help Center](https://support.anthropic.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects)
4. [Delete or rename a conversation — Claude Help Center](https://support.anthropic.com/en/articles/8230524-how-can-i-delete-or-rename-a-conversation)
5. [Use Claude’s chat search and memory to build on previous context — Claude Help Center](https://support.anthropic.com/en/articles/11817273-using-claude-s-chat-search-and-memory-to-build-on-previous-context)
6. [Export your Claude data — Claude Help Center](https://support.anthropic.com/en/articles/9450526-how-can-i-export-my-claude-ai-data)
7. [Upload files to Claude — Claude Help Center](https://support.anthropic.com/en/articles/8241126-what-kinds-of-documents-can-i-upload-to-claude-ai)
8. [What are artifacts and how do I use them? — Claude Help Center](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)
9. [Create and edit files with Claude — Claude Help Center](https://support.anthropic.com/en/articles/12111783-create-and-edit-files-with-claude)
10. [Share artifacts — Claude Help Center](https://support.anthropic.com/en/articles/9547008-publishing-and-remixing-artifacts)
11. [Enable and use web search — Claude Help Center](https://support.anthropic.com/en/articles/10684626-enabling-and-using-web-search)
12. [Manage project visibility and sharing — Claude Help Center](https://support.anthropic.com/en/articles/9519189-project-visibility-and-sharing)
13. [Share and unshare chats — Claude Help Center](https://support.anthropic.com/en/articles/10593882-sharing-and-unsharing-chats)
