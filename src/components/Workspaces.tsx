import { useEffect, useMemo, useState } from 'react'
import { ArrowUp, ArrowUpRight, Braces, Check, CheckCheck, ChevronDown, ChevronRight, CircleDot, File, FileCode2, FileDiff, FilePlus2, FileText, GitBranch, GitCommitHorizontal, GitPullRequest, Globe2, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Square, ThumbsUp } from 'lucide-react'
import type { ChatMessage, ChangeFile, Project, ProjectFile, Session } from '../types'
import { api } from '../lib/api'
import { MarkdownContent } from './MarkdownContent'

interface Shared { project: Project; session: Session; contextCount: number }

export function ChatView({ project, session, contextCount, messages, busy, activity, onSend, onResend, onStop }: Shared & { messages: ChatMessage[]; busy: boolean; activity: string[]; onSend: (value: string, model: 'sonnet' | 'opus' | 'haiku', webSearch: boolean) => void; onResend: (value: string) => void; onStop: () => void }) {
  const [draft, setDraft] = useState('')
  const [model, setModel] = useState<'sonnet' | 'opus' | 'haiku'>('sonnet')
  const [webSearch, setWebSearch] = useState(false)
  const send = () => { const value = draft.trim(); if (!value || busy) return; onSend(value, model, webSearch); setDraft('') }
  return <div className="chat-view">
    <div className="chat-scroll-area">
      {messages.length === 0 && <div className="session-intro"><div className="intro-orbit"><div className="intro-orbit__ring" /><div className="intro-core"><span className="brand-mark"><span /><span /><i /></span></div><span className="orbit-point" /></div><div className="intro-meta"><span className="session-path">{project.name}<span>/</span>{session.title}</span><h1>С чего начнём?</h1><p>Задайте вопрос по проекту или поручите Claude Code исследовать рабочую папку.</p><div className="intro-chips"><span><GitBranch size={12} /> {project.branch}</span><span><FileCode2 size={12} /> {contextCount} файл{contextCount === 1 ? '' : contextCount > 1 && contextCount < 5 ? 'а' : 'ов'} выбрано</span><span className="intro-safe"><ShieldCheckIcon /> Рабочее пространство проекта</span></div></div></div>}
      {messages.length > 0 && <div className="conversation-divider"><span>История этой сессии</span><i /></div>}
      <div className="messages-list">{messages.map((message, index) => <article key={message.id} className={`message message--${message.role}`}>
        <div className={`message-avatar message-avatar--${message.role}`}>{message.role === 'assistant' ? <span className="mini-claude-mark"><i /><i /><i /><i /></span> : 'Я'}</div>
        <div className="message-content-wrap"><div className="message-meta"><strong>{message.role === 'assistant' ? 'Claude' : 'Вы'}</strong>{message.role === 'assistant' && <span className="message-model">{model}</span>}<span className="message-time">{message.time}</span>{message.role === 'assistant' && <button className="message-more icon-button tiny" aria-label="Действия сообщения"><MoreHorizontal size={15} /></button>}</div>
          <div className="message-body"><MarkdownContent source={message.content} /></div>
          {message.role === 'assistant' && index === messages.length - 1 && !busy && <div className="message-reactions"><button aria-label="Полезный ответ"><ThumbsUp size={13} /></button><button onClick={() => onResend('Продолжи с текущего результата и предложи следующий небольшой шаг.')}><RefreshCw size={13} /> Продолжить</button><span><CheckCheck size={12} /> История сохранена</span></div>}
        </div>
      </article>)}{busy && <div className="message message--assistant"><div className="message-avatar message-avatar--assistant"><span className="mini-claude-mark"><i /><i /><i /><i /></span></div><div className="message-content-wrap"><div className="message-meta"><strong>Claude Code</strong><span className="message-model">Sonnet</span><span className="message-time">сейчас</span></div><div className="typing-indicator"><span /><span /><span /> <small>собирает ответ…</small></div></div></div>}</div>
      {busy && activity.length > 0 && <div className="activity-feed" aria-live="polite"><span className="activity-feed-label">Ход работы</span>{activity.slice(-4).map((item, index) => <span key={`${item}-${index}`}><Check size={11} /> {item}</span>)}</div>}
      {busy && messages.at(-1)?.role !== 'assistant' && <div className="message message--assistant"><div className="message-avatar message-avatar--assistant"><span className="mini-claude-mark"><i /><i /><i /><i /></span></div><div className="message-content-wrap"><div className="typing-indicator"><span /><span /><span /> <small>Claude Code отвечает…</small></div></div></div>}
    </div>
    <div className="composer-area"><div className="composer-card"><textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); send() } }} rows={2} placeholder="Спросите Claude или опишите задачу для проекта…" aria-label="Сообщение Claude" /><div className="composer-footer"><div className="composer-tools"><button className={`composer-context${webSearch ? ' is-active' : ''}`} onClick={() => setWebSearch(current => !current)} aria-pressed={webSearch} title="Разрешить веб-поиск через Claude Code"><Globe2 size={13} /><span>Поиск</span></button><button className="composer-context" title="Файлы, которые вы добавили в контекст"><FileCode2 size={13} /><span>{contextCount} в контексте</span><ChevronDown size={12} /></button><label className="model-select"><span className="model-orb" /><select aria-label="Модель Claude" value={model} onChange={event => setModel(event.target.value as typeof model)}><option value="sonnet">Sonnet</option><option value="opus">Opus</option><option value="haiku">Haiku</option></select><ChevronDown size={11} /></label></div><div className="composer-send-wrap">{busy ? <button className="send-button send-button--stop" onClick={onStop} aria-label="Остановить ответ"><Square size={13} /></button> : <><span className="composer-hint"><kbd>⌘</kbd><kbd>↵</kbd></span><button className={`send-button${draft.trim() ? ' send-button--ready' : ''}`} onClick={send} disabled={!draft.trim()} aria-label="Отправить сообщение"><ArrowUp size={16} /></button></>}</div></div></div><div className="composer-disclaimer"><span><ShieldCheckIcon /> Выполнение на сервере владельца</span><span>{busy ? 'Ответ поступает потоково' : 'Вход через Claude Code CLI'}</span></div></div>
  </div>
}

function ShieldCheckIcon() { return <span className="tiny-shield">✓</span> }

function getFileLabel(path: string) { return path.split('/').pop() || path }
function getFileIcon(file: ProjectFile) {
  if (file.kind === 'folder') return <FolderGlyph />
  if (file.path.endsWith('.md')) return <FileText size={14} className="file-icon file-icon--purple" />
  if (file.path.endsWith('.css')) return <Braces size={14} className="file-icon file-icon--blue" />
  if (file.path.endsWith('.json')) return <Braces size={14} className="file-icon file-icon--gold" />
  if (file.path.endsWith('.svg')) return <File size={14} className="file-icon file-icon--gold" />
  return <FileCode2 size={14} className="file-icon file-icon--blue" />
}
function FolderGlyph() { return <span className="folder-glyph"><i /></span> }

export function FilesView({ projectId, files, selectedFile, projectName, branch, onSelectFile, onRefresh }: { projectId: string; files: ProjectFile[]; selectedFile: string; projectName: string; branch: string; onSelectFile: (path: string) => void; onRefresh: () => void }) {
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState(false)
  const [treeOpen, setTreeOpen] = useState(true)
  const [content, setContent] = useState('')
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const visibleFiles = useMemo(() => files.filter(file => file.path.toLowerCase().includes(query.toLowerCase())), [files, query])
  const markdown = selectedFile.endsWith('.md')
  const crumbs = selectedFile.split('/')

  useEffect(() => {
    let current = true
    if (!selectedFile) { setContent(''); setDraft(''); setEditing(false); return }
    setLoading(true); setError('')
    api.readFile(projectId, selectedFile)
      .then(result => { if (current) { setContent(result.content); setDraft(result.content); setEditing(false) } })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Не удалось прочитать файл.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [projectId, selectedFile])

  const createFile = async () => {
    const path = window.prompt('Путь нового файла в проекте', '')?.trim()
    if (!path) return
    try {
      await api.saveFile(projectId, path, '')
      onRefresh()
      onSelectFile(path)
      setQuery('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось создать файл.') }
  }
  const save = async () => {
    if (!selectedFile) return
    setLoading(true); setError('')
    try {
      await api.saveFile(projectId, selectedFile, draft)
      setContent(draft); setEditing(false)
      onRefresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить файл.') }
    finally { setLoading(false) }
  }
  return <div className="files-view">
    <div className="file-explorer"><div className="explorer-head"><span>ПРОЕКТ</span><div><button className="icon-button tiny" title="Новый файл" onClick={() => { void createFile() }}><FilePlus2 size={14} /></button><button className="icon-button tiny" title="Обновить" onClick={() => window.dispatchEvent(new CustomEvent('polar:refresh-files'))}><RefreshCw size={13} /></button><button className="icon-button tiny" title="Свернуть дерево" onClick={() => setTreeOpen(value => !value)}><MoreHorizontal size={14} /></button></div></div><div className="explorer-search"><Search size={13} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти файл" /></div><button className="tree-root" onClick={() => setTreeOpen(!treeOpen)}>{treeOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<FolderGlyph /><span>{projectName || 'проект'}</span></button>{treeOpen && <div className="file-tree">{visibleFiles.map(file => <button key={file.path} className={`tree-file${file.path === selectedFile ? ' is-active' : ''}${file.kind === 'folder' ? ' is-folder' : ''}`} style={{ paddingLeft: `${12 + Math.max(0, file.path.split('/').length - 1) * 14}px` }} onClick={() => file.kind === 'file' && onSelectFile(file.path)}>{getFileIcon(file)}<span>{getFileLabel(file.path)}</span>{file.context && <span className="tree-context-dot" title="В контексте" />}</button>)}{visibleFiles.length === 0 && <div className="context-empty">В этой папке пока нет файлов</div>}</div>}<div className="explorer-footer"><span><GitBranch size={12} /> {branch || 'без Git'}</span><span>{files.length} элем.</span></div></div>
    <div className="file-editor"><div className="editor-tabbar"><div className="editor-tab is-active">{selectedFile ? getFileIcon({ path: selectedFile, kind: 'file' }) : <FileCode2 size={14} />}<span>{selectedFile ? getFileLabel(selectedFile) : 'Файл не выбран'}</span><span className="editor-unsaved" /></div><div className="editor-tab-spacer" /></div>
      {selectedFile ? <><div className="editor-breadcrumb">{crumbs.map((part, index) => index < crumbs.length - 1 ? <span className="breadcrumb-segment" key={`${part}-${index}`}>{part}<ChevronRight size={12} /></span> : <strong key={`${part}-${index}`}>{part}</strong>)}<div className="editor-actions"><span className="language-tag">{files.find(file => file.path === selectedFile)?.language ?? 'Text'}</span>{editing ? <><button className="editor-save-button" disabled={loading} onClick={() => { void save() }}>{loading ? 'Сохраняем…' : 'Сохранить'}</button><button className="editor-cancel-button" onClick={() => { setDraft(content); setEditing(false) }}>Отмена</button></> : <button className="editor-edit-button" onClick={() => { setDraft(content); setEditing(true) }}><Pencil size={11} /> Редактировать</button>}{markdown && !editing && <div className="view-switch"><button className={!preview ? 'is-active' : ''} onClick={() => setPreview(false)}>Исходник</button><button className={preview ? 'is-active' : ''} onClick={() => setPreview(true)}>Preview</button></div>}</div></div>
      {error && <div className="file-error" role="alert">{error}</div>}{loading && !editing ? <div className="file-loading">Загружаем файл…</div> : preview && markdown ? <div className="markdown-preview"><MarkdownContent source={content} /><button className="preview-edit-button" onClick={() => { setPreview(false); setDraft(content); setEditing(true) }}>Редактировать Markdown</button></div> : <div className="code-editor">{editing ? <textarea className="editor-textarea" value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false} aria-label={`Редактировать ${selectedFile}`} /> : <><div className="line-numbers">{content.split('\n').map((_, index) => <span key={index}>{index + 1}</span>)}</div><pre className="editor-code"><code>{content.split('\n').map((line, index) => <span className="code-line" key={index}>{colorize(line)}</span>)}</code></pre></>}</div>}<div className="editor-status"><span><CircleDot size={12} /> {getFileLabel(selectedFile)}</span><span>UTF-8</span><span>{files.find(file => file.path === selectedFile)?.language ?? 'Text'}</span></div></> : <div className="files-empty-state"><FilePlus2 size={22} /><strong>Откройте или создайте файл</strong><span>Файлы сохраняются в рабочей папке этого проекта.</span><button className="button-secondary" onClick={() => { void createFile() }}>Создать файл</button></div>}
    </div>
  </div>
}
function colorize(line: string) {
  const safe = line
  return <>{safe.split(/(import|from|export|function|return|const|className|type|React|Button|section|span|h1|p|button|variant|children|primary|quiet)/g).map((part, index) => {
    const keywords = ['import', 'from', 'export', 'function', 'return', 'const', 'type']
    const jsx = ['Button', 'section', 'span', 'h1', 'p', 'button']
    if (keywords.includes(part)) return <span className="syntax-keyword" key={index}>{part}</span>
    if (jsx.includes(part)) return <span className="syntax-jsx" key={index}>{part}</span>
    if (['className', 'variant', 'children'].includes(part)) return <span className="syntax-prop" key={index}>{part}</span>
    if (part.startsWith("'") || part.startsWith('"') || ['primary', 'quiet'].includes(part)) return <span className="syntax-string" key={index}>{part}</span>
    return part
  })}</>
}

const diffPreview: Record<string, { old: string; next: string }> = {
  'src/components/Hero.tsx': { old: '<Button variant="secondary">Learn more</Button>\n<Button variant="primary">Get started</Button>', next: '<Button variant="primary">Open workspace</Button>' },
  'src/styles/tokens.css': { old: '--color-accent: #e8ae72;\n--space-hero: 3rem;', next: '--color-accent: #ff8066;\n--space-hero: 4rem;' },
  'src/components/Callout.tsx': { old: '', next: 'export function Callout() {\n  return <aside className="callout">\n    One clear next step.\n  </aside>\n}' },
}

export function SourceControlView({ changes, onToggleStaged, onCommit, project }: { changes: ChangeFile[]; onToggleStaged: (path: string) => void; onCommit: (message: string) => void; project: Project }) {
  const [selected, setSelected] = useState(changes[0]?.path ?? '')
  const [commitMessage, setCommitMessage] = useState('')
  const stagedCount = changes.filter(file => file.staged).length
  const currentDiff = diffPreview[selected] ?? { old: '', next: '// No changes selected' }
  const commit = () => { const message = commitMessage.trim(); if (!message || !stagedCount) return; onCommit(message); setCommitMessage('') }
  return <div className="git-view">
    <div className="git-sidebar"><div className="git-head"><span>SOURCE CONTROL</span><button className="icon-button tiny" title="Обновить"><RefreshCw size={13} /></button></div><div className="git-branch-card"><span className="git-branch-icon"><GitBranch size={15} /></span><span><strong>{project.branch}</strong><small>отходит от origin/main</small></span><ChevronDown size={13} /></div><div className="changes-head"><button><ChevronDown size={13} /><span>Изменения</span><span className="git-count">{changes.length}</span></button><button className="icon-button tiny" title="Stage all"><Plus size={13} /></button></div><div className="change-list">{changes.map(file => <div className={`change-file${selected === file.path ? ' is-selected' : ''}`} key={file.path}><button className={`stage-box${file.staged ? ' is-checked' : ''}`} onClick={() => onToggleStaged(file.path)} aria-label={file.staged ? 'Убрать из stage' : 'Добавить в stage'}>{file.staged && <Check size={11} />}</button><button className="change-file-name" onClick={() => setSelected(file.path)}><FileCode2 size={14} /><span>{getFileLabel(file.path)}</span></button><span className={`change-kind change-kind--${file.kind.toLowerCase()}`}>{file.kind}</span><button className="icon-button tiny change-more" aria-label="Опции"><MoreHorizontal size={13} /></button></div>)}</div><div className="staged-head"><button><ChevronDown size={13} /><span>В индексе</span><span className="git-count">{stagedCount}</span></button></div><div className="git-spacer" /><div className="git-commit-box"><label htmlFor="commit-message">Сообщение коммита</label><textarea id="commit-message" rows={2} value={commitMessage} onChange={event => setCommitMessage(event.target.value)} placeholder="Например: Simplify onboarding hero"/><button disabled={!stagedCount || !commitMessage.trim()} onClick={commit}><GitCommitHorizontal size={15} />Зафиксировать изменения<span>↵</span></button><small>{stagedCount ? `${stagedCount} файл${stagedCount > 1 ? 'а' : ''} в индексе` : 'Выберите файлы для коммита'}</small></div></div>
    <div className="diff-panel"><div className="diff-toolbar"><div className="diff-file-title"><FileDiff size={15} /><strong>{selected.split('/').slice(-2).join('/')}</strong><span className={`change-kind change-kind--${(changes.find(file => file.path === selected)?.kind ?? 'M').toLowerCase()}`}>{changes.find(file => file.path === selected)?.kind ?? 'M'}</span></div><div className="diff-actions"><button className="diff-option"><span>Все изменения</span><ChevronDown size={12} /></button><button className="icon-button" title="Открыть в редакторе"><ArrowUpRight size={15} /></button><button className="icon-button" title="Ещё"><MoreHorizontal size={15} /></button></div></div><div className="diff-subheader"><span>{selected}</span><span><span className="diff-add">+{currentDiff.next.split('\n').length}</span> <span className="diff-remove">−{currentDiff.old ? currentDiff.old.split('\n').length : 0}</span></span></div><div className="diff-code"><div className="diff-hunk">@@ -1,{currentDiff.old ? currentDiff.old.split('\n').length : 0} +1,{currentDiff.next.split('\n').length} @@</div>{currentDiff.old.split('\n').filter(Boolean).map((line, index) => <div className="diff-line diff-line--removed" key={`old-${index}`}><span className="diff-line-number">{index + 1}</span><span className="diff-sign">−</span><code>{line}</code></div>)}{currentDiff.next.split('\n').filter(Boolean).map((line, index) => <div className="diff-line diff-line--added" key={`new-${index}`}><span className="diff-line-number">{index + 1}</span><span className="diff-sign">+</span><code>{line}</code></div>)}<div className="diff-line diff-line--unchanged"><span className="diff-line-number">{currentDiff.next.split('\n').length + 1}</span><span className="diff-sign"> </span><code>{'  </code>'}</code></div></div><div className="diff-footer"><span><GitPullRequest size={13} /> Просмотр только локальных изменений</span><button onClick={() => onToggleStaged(selected)}><Check size={13} />{changes.find(file => file.path === selected)?.staged ? 'В индексе' : 'Добавить в индекс'}</button></div></div>
  </div>
}
