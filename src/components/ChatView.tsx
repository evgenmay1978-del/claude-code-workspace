import { useEffect, useState, type ClipboardEvent, type DragEvent } from 'react'
import { ArrowDownToLine, ArrowUp, Check, CheckCheck, ChevronDown, FileText, FileType2, Globe2, Image, Paperclip, RefreshCw, ShieldCheck, Square, ThumbsUp, X } from 'lucide-react'
import type { AttachmentInfo, ChatMessage, Project, Session } from '../types'
import { api } from '../lib/api'
import { MarkdownContent } from './MarkdownContent'

type Model = 'sonnet' | 'opus' | 'haiku'

export function ChatView({ project, session, contextCount, messages, busy, activity, attachments, uploadBusy, webSearchAvailable, onUploadFiles, onRemoveAttachment, onSend, onResend, onStop }: {
  project: Project
  session: Session
  contextCount: number
  messages: ChatMessage[]
  busy: boolean
  activity: string[]
  attachments: AttachmentInfo[]
  uploadBusy: boolean
  webSearchAvailable: boolean
  onUploadFiles: (files: File[]) => void
  onRemoveAttachment: (attachmentId: string) => void
  onSend: (value: string, model: Model, webSearch: boolean) => void
  onResend: (value: string) => void
  onStop: () => void
}) {
  const [draft, setDraft] = useState('')
  const [model, setModel] = useState<Model>(project.defaultModel === 'opus' || project.defaultModel === 'haiku' ? project.defaultModel : 'sonnet')
  const [webSearch, setWebSearch] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  useEffect(() => { setModel(project.defaultModel === 'opus' || project.defaultModel === 'haiku' ? project.defaultModel : 'sonnet') }, [project.id, project.defaultModel])

  const send = () => {
    const value = draft.trim()
    if ((!value && attachments.length === 0) || busy || uploadBusy) return
    onSend(value || 'Проанализируй прикреплённые файлы.', model, webSearch && webSearchAvailable)
    setDraft('')
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

  return <div className={`chat-view${dragActive ? ' chat-view--drag-active' : ''}`} onDragOver={event => { event.preventDefault(); setDragActive(true) }} onDragLeave={event => { if (event.target === event.currentTarget) setDragActive(false) }} onDrop={handleDrop}>
    {dragActive && <div className="chat-drop-overlay" aria-live="polite"><Paperclip size={22} /><strong>Отпустите, чтобы прикрепить</strong><span>Файл будет сохранён только в этом чате</span></div>}
    <div className="chat-scroll-area">
      {messages.length === 0 && <div className="session-intro"><div className="intro-orbit"><div className="intro-orbit__ring" /><div className="intro-core"><span className="brand-mark"><span /><span /><i /></span></div><span className="orbit-point" /></div><div className="intro-meta"><span className="session-path">{project.name}<span>/</span>{session.title}</span><h1>С чего начнём?</h1><p>Задайте вопрос по проекту или поручите Claude Code исследовать рабочую папку.</p><div className="intro-chips"><span>{contextCount} файлов в контексте</span><span className="intro-safe"><ShieldCheck size={12} /> Рабочее пространство проекта</span></div></div></div>}
      {messages.length > 0 && <div className="conversation-divider"><span>История этой сессии</span><i /></div>}
      <div className="messages-list">{messages.map((message, index) => <article key={message.id} className={`message message--${message.role}`}>
        <div className={`message-avatar message-avatar--${message.role}`}>{message.role === 'assistant' ? <span className="mini-claude-mark"><i /><i /><i /><i /></span> : 'Я'}</div>
        <div className="message-content-wrap"><div className="message-meta"><strong>{message.role === 'assistant' ? 'Claude' : 'Вы'}</strong>{message.role === 'assistant' && <span className="message-model">{model}</span>}<span className="message-time">{message.time}</span></div>
          {message.attachments?.length ? <div className="message-attachments">{message.attachments.map(file => <a key={file.id} className="message-attachment" href={api.attachmentDownloadUrl(project.id, file.id)} download={file.name}><AttachmentIcon mimeType={file.mimeType} /><span><strong>{file.name}</strong><small>{formatBytes(file.byteSize)}</small></span><ArrowDownToLine size={14} /></a>)}</div> : null}
          {message.content && <div className="message-body"><MarkdownContent source={message.content} /></div>}
          {message.role === 'assistant' && index === messages.length - 1 && !busy && <div className="message-reactions"><button aria-label="Полезный ответ"><ThumbsUp size={13} /></button><button onClick={() => onResend('Продолжи с текущего результата и предложи следующий небольшой шаг.')}><RefreshCw size={13} /> Продолжить</button><span><CheckCheck size={12} /> История сохранена</span></div>}
        </div>
      </article>)}{busy && <div className="message message--assistant"><div className="message-avatar message-avatar--assistant"><span className="mini-claude-mark"><i /><i /><i /><i /></span></div><div className="message-content-wrap"><div className="message-meta"><strong>Claude Code</strong><span className="message-model">{model}</span><span className="message-time">сейчас</span></div><div className="typing-indicator"><span /><span /><span /> <small>собирает ответ…</small></div></div></div>}
      {busy && activity.length > 0 && <div className="activity-feed" aria-live="polite"><span className="activity-feed-label">Ход работы</span>{activity.slice(-4).map((item, index) => <span key={`${item}-${index}`}><Check size={11} /> {item}</span>)}</div>}
      {busy && messages.at(-1)?.role !== 'assistant' && <div className="message message--assistant"><div className="message-avatar message-avatar--assistant"><span className="mini-claude-mark"><i /><i /><i /><i /></span></div><div className="message-content-wrap"><div className="typing-indicator"><span /><span /><span /> <small>Claude Code отвечает…</small></div></div></div>}
      </div>
    </div>
    <div className="composer-area"><div className="composer-card">
      {attachments.length > 0 && <div className="upload-queue" aria-label="Вложения для следующего сообщения">{attachments.map(file => <div className="upload-queue-item" key={file.id}><AttachmentIcon mimeType={file.mimeType} /><span><strong>{file.name}</strong><small>{formatBytes(file.byteSize)}</small></span><button type="button" onClick={() => onRemoveAttachment(file.id)} disabled={busy || uploadBusy} aria-label={`Убрать ${file.name}`}><X size={14} /></button></div>)}</div>}
      <textarea value={draft} onChange={event => setDraft(event.target.value)} onPaste={handlePaste} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); send() } }} rows={2} placeholder="Спросите Claude или опишите задачу для проекта…" aria-label="Сообщение Claude" />
      <div className="composer-footer"><div className="composer-tools">
        <label className={`composer-context composer-attach${uploadBusy ? ' is-busy' : ''}`} title="Прикрепить файл"><Paperclip size={14} /><span>{uploadBusy ? 'Загрузка…' : 'Файл'}</span><input type="file" multiple accept=".txt,.md,.mdx,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp" disabled={busy || uploadBusy || attachments.length >= 8} onChange={event => { if (event.target.files) pickFiles(event.target.files); event.target.value = '' }} /></label>
        <button className={`composer-context${webSearch ? ' is-active' : ''}${!webSearchAvailable ? ' is-unavailable' : ''}`} onClick={() => webSearchAvailable && setWebSearch(current => !current)} aria-pressed={webSearch} disabled={!webSearchAvailable} title={webSearchAvailable ? 'Разрешить веб-поиск штатными инструментами Claude Code' : 'Веб-поиск CLI недоступен на этом сервере'}><Globe2 size={13} /><span>Поиск</span></button>
        <button className="composer-context" title="Файлы проекта, включённые в контекст"><FileType2 size={13} /><span>{contextCount} в контексте</span><ChevronDown size={12} /></button>
        <label className="model-select"><span className="model-orb" /><select aria-label="Модель Claude" value={model} onChange={event => setModel(event.target.value as Model)}><option value="sonnet">Sonnet</option><option value="opus">Opus</option><option value="haiku">Haiku</option></select><ChevronDown size={11} /></label>
      </div><div className="composer-send-wrap">{busy ? <button className="send-button send-button--stop" onClick={onStop} aria-label="Остановить ответ"><Square size={13} /></button> : <><span className="composer-hint"><kbd>⌘</kbd><kbd>↵</kbd></span><button className={`send-button${draft.trim() || attachments.length ? ' send-button--ready' : ''}`} onClick={send} disabled={(!draft.trim() && !attachments.length) || uploadBusy} aria-label="Отправить сообщение"><ArrowUp size={16} /></button></>}</div></div>
    </div><div className="composer-disclaimer"><span><ShieldCheck size={12} /> Выполнение на сервере владельца</span><span>{busy ? 'Ответ поступает потоково' : 'Лимиты — по вашей подписке Claude Code'}</span></div></div>
  </div>
}

function AttachmentIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('image/')) return <Image size={15} />
  if (mimeType === 'application/pdf') return <FileType2 size={15} />
  return <FileText size={15} />
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}
