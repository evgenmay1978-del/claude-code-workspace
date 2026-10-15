import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { ArrowDown, ArrowDownToLine, ArrowUp, Check, CheckCheck, ChevronDown, Copy, FileText, FileType2, Globe2, Image, Paperclip, Pencil, RefreshCw, ShieldAlert, ShieldCheck, Square, Wrench, X } from 'lucide-react'
import type { AttachmentInfo, ChatMessage, PermissionMode, PermissionRequest, Project, Session, ToolStep } from '../types'
import { api } from '../lib/api'
import { MarkdownContent } from './MarkdownContent'

type Model = 'sonnet' | 'opus' | 'haiku'

export function ChatView({ project, session, contextCount, messages, busy, activity, permissionRequests, onDecidePermission, permissionMode, onPermissionModeChange, attachments, uploadBusy, webSearchAvailable, onUploadFiles, onRemoveAttachment, onSend, onResend, onRetryLastMessage, onStop }: {
  project: Project
  session: Session
  contextCount: number
  messages: ChatMessage[]
  busy: boolean
  activity: ToolStep[]
  permissionRequests: PermissionRequest[]
  onDecidePermission: (requestId: string, decision: 'allow' | 'deny') => void
  permissionMode: PermissionMode
  onPermissionModeChange: (mode: PermissionMode) => void
  attachments: AttachmentInfo[]
  uploadBusy: boolean
  webSearchAvailable: boolean
  onUploadFiles: (files: File[]) => void
  onRemoveAttachment: (attachmentId: string) => void
  onSend: (value: string, model: Model, webSearch: boolean) => void
  onResend: (value: string) => void
  onRetryLastMessage: (message: ChatMessage) => void
  onStop: () => void
}) {
  const [draft, setDraft] = useState('')
  const [model, setModel] = useState<Model>(project.defaultModel === 'opus' || project.defaultModel === 'haiku' ? project.defaultModel : 'sonnet')
  const [webSearch, setWebSearch] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null)
  const [copyFeedback, setCopyFeedback] = useState<{ id: string; copied: boolean } | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const stickToBottomRef = useRef(true)
  const lastUserMessage = [...messages].reverse().find(message => message.role === 'user')
  const sessionUsage = messages.reduce((total, message) => {
    if (message.role !== 'assistant') return total
    return { input: total.input + (message.inputTokens ?? 0), output: total.output + (message.outputTokens ?? 0) }
  }, { input: 0, output: 0 })

  useEffect(() => { setModel(project.defaultModel === 'opus' || project.defaultModel === 'haiku' ? project.defaultModel : 'sonnet') }, [project.id, project.defaultModel])
  useEffect(() => {
    stickToBottomRef.current = true
    setIsAtBottom(true)
    setDraft('')
    setEditingMessage(null)
  }, [session.id])
  useEffect(() => {
    const container = scrollAreaRef.current
    if (container && stickToBottomRef.current) {
      container.scrollTop = container.scrollHeight
      setIsAtBottom(true)
    }
  }, [messages, busy, activity, permissionRequests])

  const send = () => {
    const value = draft.trim()
    if ((!value && attachments.length === 0) || busy || uploadBusy) return
    if (editingMessage) onRetryLastMessage({ ...editingMessage, content: value, model })
    else onSend(value || 'Проанализируй прикреплённые файлы.', model, webSearch && webSearchAvailable)
    setDraft('')
    setEditingMessage(null)
  }
  const pickFiles = (files: FileList | File[]) => {
    const allowed = Array.from(files).slice(0, 8)
    if (allowed.length) onUploadFiles(allowed)
  }
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragActive(false)
    if (event.dataTransfer.files.length) pickFiles(event.dataTransfer.files)
  }
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length) { event.preventDefault(); pickFiles(files) }
  }
  const handleScroll = () => {
    const container = scrollAreaRef.current
    if (!container) return
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 96
    stickToBottomRef.current = nearBottom
    setIsAtBottom(nearBottom)
  }
  const scrollToLatest = () => {
    const container = scrollAreaRef.current
    if (!container) return
    stickToBottomRef.current = true
    setIsAtBottom(true)
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
  }
  const editMessage = (message: ChatMessage) => {
    setEditingMessage(message)
    setDraft(message.content)
    if (message.model === 'opus' || message.model === 'haiku' || message.model === 'sonnet') setModel(message.model)
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }
  const copyAnswer = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopyFeedback({ id: message.id, copied: true })
    } catch {
      setCopyFeedback({ id: message.id, copied: false })
    }
    window.setTimeout(() => setCopyFeedback(current => current?.id === message.id ? null : current), 1800)
  }
  const formatTokens = (value: number) => new Intl.NumberFormat('ru-RU').format(value)

  return <div className={`chat-view${dragActive ? ' chat-view--drag-active' : ''}`} onDragOver={event => { event.preventDefault(); setDragActive(true) }} onDragLeave={event => { if (event.target === event.currentTarget) setDragActive(false) }} onDrop={handleDrop}>
    {dragActive && <div className="chat-drop-overlay" aria-live="polite"><Paperclip size={22} /><strong>Отпустите, чтобы прикрепить</strong><span>Файл будет сохранён только в этом чате</span></div>}
    <div className="chat-scroll-area" ref={scrollAreaRef} onScroll={handleScroll}>
      {messages.length === 0 && <div className="session-intro"><div className="intro-orbit"><div className="intro-orbit__ring" /><div className="intro-core"><span className="brand-mark"><span /><span /><i /></span></div><span className="orbit-point" /></div><div className="intro-meta"><span className="session-path">{project.name}<span>/</span>{session.title}</span><h1>С чего начнём?</h1><p>Задайте вопрос по проекту или поручите Claude Code исследовать рабочую папку.</p><div className="intro-chips"><span>{contextCount} файлов в контексте</span><span className="intro-safe"><ShieldCheck size={12} /> Рабочее пространство проекта</span></div></div></div>}
      {messages.length > 0 && <div className="conversation-divider"><span>История этой сессии</span><i /></div>}
      <div className="messages-list" aria-live="polite">{messages.map((message, index) => <article key={message.id} className={`message message--${message.role}`}>
        <div className={`message-avatar message-avatar--${message.role}`}>{message.role === 'assistant' ? <span className="mini-claude-mark"><i /><i /><i /><i /></span> : 'Я'}</div>
        <div className="message-content-wrap"><div className="message-meta"><strong>{message.role === 'assistant' ? 'Claude' : 'Вы'}</strong>{message.role === 'assistant' && <span className="message-model">{message.model ?? model}</span>}<span className="message-time">{message.time}</span></div>
          {message.attachments?.length ? <div className="message-attachments">{message.attachments.map(file => <a key={file.id} className="message-attachment" href={api.attachmentDownloadUrl(project.id, file.id)} download={file.name}><AttachmentIcon mimeType={file.mimeType} /><span><strong>{file.name}</strong><small>{formatBytes(file.byteSize)}</small></span><ArrowDownToLine size={14} /></a>)}</div> : null}
          {message.steps?.length ? <details className="message-steps"><summary><Wrench size={12} /> Действия Claude Code: {message.steps.length}</summary><ol>{message.steps.map((step, stepIndex) => <li key={stepIndex}><strong>{toolLabel(step.tool)}</strong>{step.summary && <code>{step.summary}</code>}</li>)}</ol></details> : null}
          {message.content && <div className="message-body"><MarkdownContent source={message.content} /></div>}
          {message.role === 'user' && message.id === lastUserMessage?.id && !busy && <div className="message-actions"><button onClick={() => editMessage(message)} aria-label="Исправить последний запрос"><Pencil size={13} /> Исправить</button><button onClick={() => onRetryLastMessage(message)} aria-label="Повторить последний запрос"><RefreshCw size={13} /> Повторить</button></div>}
          {message.role === 'assistant' && !busy && message.content.trim() && <div className="message-reactions"><button onClick={() => void copyAnswer(message)} aria-label="Скопировать ответ"><Copy size={13} />{copyFeedback?.id === message.id ? copyFeedback.copied ? 'Скопировано' : 'Не скопировано' : 'Копировать ответ'}</button>{index === messages.length - 1 && <button onClick={() => onResend('Продолжи с текущего результата и предложи следующий небольшой шаг.')}><RefreshCw size={13} /> Продолжить</button>}{(message.inputTokens || message.outputTokens) ? <span className="message-token-usage" title="Использование токенов, сообщённое Claude Code CLI">CLI: {formatTokens(message.inputTokens ?? 0)} вход · {formatTokens(message.outputTokens ?? 0)} выход</span> : null}{index === messages.length - 1 && <span><CheckCheck size={12} /> История сохранена</span>}</div>}
        </div>
      </article>)}{busy && <div className="message message--assistant"><div className="message-avatar message-avatar--assistant"><span className="mini-claude-mark"><i /><i /><i /><i /></span></div><div className="message-content-wrap"><div className="message-meta"><strong>Claude Code</strong><span className="message-model">{model}</span><span className="message-time">сейчас</span></div><div className="typing-indicator"><span /><span /><span /> <small>собирает ответ…</small></div></div></div>}
      {busy && activity.length > 0 && <div className="activity-feed" aria-live="polite"><span className="activity-feed-label">Ход работы</span>{activity.slice(-6).map((item, index) => <span key={`${item.tool}-${index}`}><Check size={11} /> <strong>{toolLabel(item.tool)}</strong>{item.summary && <code>{item.summary}</code>}</span>)}</div>}
      {permissionRequests.length > 0 && <div className="permission-list" aria-live="assertive">{permissionRequests.map(request => <PermissionCard key={request.id} request={request} onDecide={onDecidePermission} />)}</div>}
      {busy && messages.at(-1)?.role !== 'assistant' && <div className="message message--assistant"><div className="message-avatar message-avatar--assistant"><span className="mini-claude-mark"><i /><i /><i /><i /></span></div><div className="message-content-wrap"><div className="typing-indicator"><span /><span /><span /> <small>Claude Code отвечает…</small></div></div></div>}
      </div>
    </div>
    {!isAtBottom && messages.length > 0 && <button className="chat-scroll-bottom" onClick={scrollToLatest}><ArrowDown size={15} /> К последним сообщениям</button>}
    <div className="composer-area"><div className="composer-card">
      {editingMessage && <div className="message-edit-banner"><div><strong>Исправляете последний запрос</strong><span>Изменённый текст отправится новым сообщением; история не удаляется.</span></div><button type="button" onClick={() => { setDraft(''); setEditingMessage(null) }} aria-label="Отменить исправление"><X size={15} /></button></div>}
      {attachments.length > 0 && <div className="upload-queue" aria-label="Вложения для следующего сообщения">{attachments.map(file => <div className="upload-queue-item" key={file.id}><AttachmentIcon mimeType={file.mimeType} /><span><strong>{file.name}</strong><small>{formatBytes(file.byteSize)}</small></span><button type="button" onClick={() => onRemoveAttachment(file.id)} disabled={busy || uploadBusy} aria-label={`Убрать ${file.name}`}><X size={14} /></button></div>)}</div>}
      <textarea ref={textareaRef} value={draft} onChange={event => setDraft(event.target.value)} onPaste={handlePaste} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); send() } }} rows={2} placeholder="Спросите Claude или опишите задачу для проекта…" aria-label="Сообщение Claude" />
      <div className="composer-footer"><div className="composer-tools">
        <label className={`composer-context composer-attach${uploadBusy ? ' is-busy' : ''}`} title="Прикрепить файл"><Paperclip size={14} /><span>{uploadBusy ? 'Загрузка…' : 'Файл'}</span><input type="file" multiple accept=".txt,.md,.mdx,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp" disabled={busy || uploadBusy || attachments.length >= 8} onChange={event => { if (event.target.files) pickFiles(event.target.files); event.target.value = '' }} /></label>
        <button className={`composer-context${webSearch ? ' is-active' : ''}${!webSearchAvailable ? ' is-unavailable' : ''}`} onClick={() => webSearchAvailable && setWebSearch(current => !current)} aria-pressed={webSearch} disabled={!webSearchAvailable} title={webSearchAvailable ? 'Разрешить веб-поиск штатными инструментами Claude Code' : 'Веб-поиск CLI недоступен на этом сервере'}><Globe2 size={13} /><span>Поиск</span></button>
        <button className="composer-context" title="Файлы проекта, включённые в контекст"><FileType2 size={13} /><span>{contextCount} в контексте</span><ChevronDown size={12} /></button>
        <label className={`model-select permission-select permission-select--${permissionMode}`} title="Что Claude Code может делать без вашего подтверждения"><ShieldCheck size={12} /><select aria-label="Права Claude Code" value={permissionMode} disabled={busy} onChange={event => onPermissionModeChange(event.target.value as PermissionMode)}><option value="ask">Спрашивать</option><option value="acceptEdits">Правки сами</option><option value="plan">Только чтение</option></select><ChevronDown size={11} /></label>
        <label className="model-select"><span className="model-orb" /><select aria-label="Модель Claude" value={model} onChange={event => setModel(event.target.value as Model)}><option value="sonnet">Sonnet</option><option value="opus">Opus</option><option value="haiku">Haiku</option></select><ChevronDown size={11} /></label>
      </div><div className="composer-send-wrap">{busy ? <button className="send-button send-button--stop" onClick={onStop} aria-label="Остановить ответ"><Square size={13} /></button> : <><span className="composer-hint"><kbd>⌘</kbd><kbd>↵</kbd></span><button className={`send-button${draft.trim() || attachments.length ? ' send-button--ready' : ''}`} onClick={send} disabled={(!draft.trim() && !attachments.length) || uploadBusy} aria-label="Отправить сообщение"><ArrowUp size={16} /></button></>}</div></div></div><div className="composer-disclaimer"><span><ShieldCheck size={12} /> Выполнение на сервере владельца</span><span>{sessionUsage.input || sessionUsage.output ? `CLI · ${formatTokens(sessionUsage.input)} вход / ${formatTokens(sessionUsage.output)} выход токенов в этом чате` : busy ? 'Ответ поступает потоково' : 'Лимиты — по вашей подписке Claude Code'}</span></div></div>
  </div>
}

const toolNames: Record<string, string> = {
  Bash: 'Команда', Edit: 'Правка', MultiEdit: 'Правки', Write: 'Запись файла', Read: 'Чтение', Glob: 'Поиск файлов', Grep: 'Поиск в коде',
  LS: 'Список', WebSearch: 'Веб-поиск', WebFetch: 'Загрузка страницы', TodoWrite: 'План', NotebookEdit: 'Правка notebook', Task: 'Подзадача',
}

function toolLabel(tool: string): string {
  return toolNames[tool] ?? tool
}

function PermissionCard({ request, onDecide }: { request: PermissionRequest; onDecide: (requestId: string, decision: 'allow' | 'deny') => void }) {
  const state = request.state ?? 'pending'
  const status = state === 'allowed' ? 'Разрешено' : state === 'denied' ? 'Отклонено' : state === 'expired' ? 'Запрос закрыт' : state === 'sending' ? 'Отправляем…' : null
  return <section className={`permission-card permission-card--${state}`} aria-label={`Запрос разрешения: ${toolLabel(request.tool)}`}>
    <header><ShieldAlert size={15} /><strong>Claude Code просит разрешение</strong><span className="permission-tool">{toolLabel(request.tool)}</span></header>
    {request.summary && <p className="permission-summary"><code>{request.summary}</code></p>}
    {request.detail && <details open={request.tool === 'Bash' || request.tool === 'Edit' || request.tool === 'MultiEdit'}><summary>Что именно будет сделано</summary><pre>{request.detail}</pre></details>}
    {status ? <div className="permission-status">{status}</div> : <div className="permission-actions"><button type="button" className="button-secondary" onClick={() => onDecide(request.id, 'deny')}><X size={14} /> Отклонить</button><button type="button" className="button-primary" onClick={() => onDecide(request.id, 'allow')}><Check size={14} /> Разрешить</button></div>}
  </section>
}

function AttachmentIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('image/')) return <Image size={15} />
  if (mimeType === 'application/pdf') return <FileType2 size={15} />
  return <FileText size={15} />
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}
