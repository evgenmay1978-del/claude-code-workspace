import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Circle, FolderKanban, GitBranch, MessageSquare, PanelLeft, PanelRightClose, Plus, Settings2, ShieldCheck, TerminalSquare, X } from 'lucide-react'
import type { AttachmentInfo, ChatMessage, PermissionMode, PermissionRequest, Project, ProjectFile, Session, ToolStep, View } from './types'
import { api, toUiProject, type AuthStatus, type CliStatus, type GitStatus, type MessageSearchResult, type ProjectRecord } from './lib/api'
import { AuthGate } from './components/AuthGate'
import { Sidebar, NavigationRail } from './components/Sidebar'
import { ContextPanel } from './components/ContextPanel'
import { SettingsModal } from './components/SettingsModal'
import { ChatView } from './components/ChatView'
import { FilesView } from './components/Workspaces'
import { SourceControlView } from './components/SourceControl'

const TerminalView = lazy(() => import('./components/TerminalView').then(module => ({ default: module.TerminalView })))

const viewEntries: { key: View; icon: typeof MessageSquare }[] = [
  { key: 'Chat', icon: MessageSquare }, { key: 'Terminal', icon: TerminalSquare }, { key: 'Files', icon: FolderKanban }, { key: 'Source Control', icon: GitBranch },
]

function NewProjectModal({ onClose, onCreate, hostPathsAllowed }: { onClose: () => void; onCreate: (name: string, path?: string) => void; hostPathsAllowed: boolean }) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler) }, [onClose])
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><form className="new-project-modal" onSubmit={event => { event.preventDefault(); if (name.trim()) onCreate(name.trim(), path.trim() || undefined) }}>
    <div className="new-project-icon"><Plus size={17} /></div><button type="button" className="icon-button new-project-close" onClick={onClose} aria-label="Закрыть"><X size={16} /></button><span className="modal-kicker">НОВОЕ ПРОСТРАНСТВО</span><h2>Добавить проект</h2><p>Проект создаёт отдельную папку и личные сессии на вашем сервере.</p><label htmlFor="project-name">Название проекта</label><input id="project-name" autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="Например, northstar" maxLength={64} />{hostPathsAllowed && <><label htmlFor="project-path">Папка на сервере (необязательно)</label><input id="project-path" value={path} onChange={event => setPath(event.target.value)} placeholder="/root/maestro-memory — пусто: новая папка" maxLength={1024} autoCapitalize="off" autoCorrect="off" spellCheck={false} /></>}<div className="project-folder-preview"><span className="folder-preview-icon"><GitBranch size={15} /></span><span><strong>{path.trim() ? 'Существующая папка' : 'Личный workspace'}</strong><small>{path.trim() ? 'Claude Code будет работать прямо в ней' : 'Новая папка на вашем сервере'}</small></span><ShieldCheck size={14} /></div><div className="new-project-actions"><button type="button" className="button-secondary" onClick={onClose}>Отмена</button><button type="submit" className="button-primary" disabled={!name.trim()}>Создать проект <ChevronRight size={14} /></button></div>
  </form></div>
}

function FirstProject({ onCreate, busy, error }: { onCreate: () => void; busy: boolean; error: string }) {
  return <main className="first-project"><div className="first-project-card"><span className="brand-mark"><span /><span /><i /></span><span className="modal-kicker">POLAR WORKSPACE</span><h1>Начните с проекта.</h1><p>Создайте рабочую папку — затем откройте настоящий Claude Code CLI через официальный вход.</p>{error && <div className="auth-error" role="alert">{error}</div>}<button className="button-primary" onClick={onCreate} disabled={busy}><Plus size={15} />{busy ? 'Создаём…' : 'Создать первый проект'}</button><small>Пока проектов нет. Никакие demo-данные не подставляются.</small></div></main>
}

function LoadingScreen({ label }: { label: string }) {
  return <main className="auth-stage"><div className="auth-card auth-card--loading"><span className="brand-mark"><span /><span /><i /></span><p>{label}</p></div></main>
}

function MobileNavigation({ current, onChange, onProjects }: { current: View; onChange: (view: View) => void; onProjects: () => void }) {
  const entries = [
    { key: 'Chat' as const, label: 'Чаты', icon: MessageSquare },
    { key: 'Files' as const, label: 'Файлы', icon: FolderKanban },
    { key: 'Terminal' as const, label: 'Терминал', icon: TerminalSquare },
    { key: 'Source Control' as const, label: 'Git', icon: GitBranch },
  ]
  return <nav className="mobile-bottom-nav" aria-label="Основная навигация">
    {entries.map(({ key, label, icon: Icon }) => <button key={key} className={current === key ? 'is-active' : ''} onClick={() => onChange(key)} aria-current={current === key ? 'page' : undefined}><Icon size={19} strokeWidth={1.9} /><span>{label}</span></button>)}
    <button onClick={onProjects} aria-label="Проекты и история"><PanelLeft size={19} strokeWidth={1.9} /><span>Проекты</span></button>
  </nav>
}

function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [username, setUsername] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false)
  const [workspaceError, setWorkspaceError] = useState('')
  const [activeProjectId, setActiveProjectId] = useState('')
  const [activeSessionId, setActiveSessionId] = useState('')
  const [view, setView] = useState<View>('Chat')
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [attachmentQueues, setAttachmentQueues] = useState<Record<string, AttachmentInfo[]>>({})
  const [uploadBusy, setUploadBusy] = useState(false)
  const [selectedFile, setSelectedFile] = useState('')
  const [projectSearch, setProjectSearch] = useState('')
  const [messageSearchResults, setMessageSearchResults] = useState<MessageSearchResult[]>([])
  const [messageSearchBusy, setMessageSearchBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(() => window.innerWidth > 980)
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  const [activity, setActivity] = useState<ToolStep[]>([])
  const [permissionRequests, setPermissionRequests] = useState<PermissionRequest[]>([])
  const [permissionMode, setPermissionModeState] = useState<PermissionMode>(() => {
    try {
      const saved = window.localStorage.getItem('polar:permission-mode')
      return saved === 'acceptEdits' || saved === 'plan' ? saved : 'ask'
    } catch { return 'ask' }
  })
  const setPermissionMode = (mode: PermissionMode) => {
    setPermissionModeState(mode)
    try { window.localStorage.setItem('polar:permission-mode', mode) } catch { /* только удобство */ }
  }
  const [projectBusy, setProjectBusy] = useState(false)
  const [cliStatus, setCliStatus] = useState<CliStatus | null>(null)
  const [activeController, setActiveController] = useState<AbortController | null>(null)
  const [terminalIds, setTerminalIds] = useState<Record<string, string>>({})
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [hostPathsAllowed, setHostPathsAllowed] = useState(false)

  const activeProject = projects.find(project => project.id === activeProjectId) ?? null
  const activeSession = activeProject?.sessions.find(session => session.id === activeSessionId) ?? activeProject?.sessions[0] ?? null
  const sessionQueueKey = activeProject && activeSession ? `${activeProject.id}:${activeSession.id}` : ''
  const pendingAttachments = sessionQueueKey ? attachmentQueues[sessionQueueKey] ?? [] : []
  const changes = gitStatus?.changes ?? []
  const workspaceTitle = useMemo(() => view === 'Source Control' ? 'Source Control' : view, [view])
  const contextCount = files.filter(file => file.kind === 'file' && file.context).length
  const updateTerminalId = useCallback((id: string | null) => {
    if (!activeProject) return
    setTerminalIds(current => {
      const next = { ...current }
      if (id) next[activeProject.id] = id
      else delete next[activeProject.id]
      return next
    })
  }, [activeProject])

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(current => current === message ? '' : current), 3200)
  }, [])

  const refreshGit = useCallback(async (projectId: string) => {
    try { setGitStatus(await api.gitStatus(projectId)) }
    catch (cause) { setGitStatus(null); showToast(cause instanceof Error ? cause.message : 'Не удалось обновить Git.') }
  }, [showToast])

  const refreshFiles = useCallback(async () => {
    if (!activeProjectId) return
    try {
      setFiles(await api.listFiles(activeProjectId))
      await refreshGit(activeProjectId)
    } catch (cause) { showToast(cause instanceof Error ? cause.message : 'Не удалось обновить файлы.') }
  }, [activeProjectId, refreshGit, showToast])

  const loadWorkspace = useCallback(async () => {
    setWorkspaceLoaded(false)
    setWorkspaceError('')
    try {
      const result = await api.listProjects()
      setHostPathsAllowed(Boolean(result.hostPathsAllowed))
      const mapped = result.projects.map(toUiProject)
      setProjects(mapped)
      setActiveProjectId(current => mapped.some(project => project.id === current) ? current : mapped[0]?.id ?? '')
      const first = mapped[0]
      if (first) setActiveSessionId(current => first.sessions.some(session => session.id === current) ? current : first.sessions[0]?.id ?? '')
      setWorkspaceLoaded(true)
    } catch (cause) {
      setWorkspaceError(cause instanceof Error ? cause.message : 'Не удалось загрузить workspace.')
      setWorkspaceLoaded(true)
    }
  }, [])

  const refreshAuth = useCallback(async () => {
    try {
      const status = await api.authStatus()
      setAuth(status)
      if (status.authenticated && status.username) {
        setUsername(status.username)
        await loadWorkspace()
        void api.cliStatus().then(setCliStatus).catch(() => setCliStatus(null))
      }
    } catch {
      setWorkspaceError('Backend не отвечает. Проверьте, что сервер приложения запущен.')
      setAuth({ initialized: false, authenticated: false })
    }
  }, [loadWorkspace])

  useEffect(() => { void refreshAuth() }, [refreshAuth])
  useEffect(() => {
    const handleGlobalShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return
      if (!document.getElementById('project-search')) return
      event.preventDefault()
      if (window.matchMedia('(max-width: 760px)').matches) setSidebarOpen(true)
      window.setTimeout(() => document.getElementById('project-search')?.focus(), 0)
    }
    window.addEventListener('keydown', handleGlobalShortcut)
    return () => window.removeEventListener('keydown', handleGlobalShortcut)
  }, [])
  useEffect(() => {
    const query = projectSearch.trim()
    if (query.length < 2) { setMessageSearchResults([]); setMessageSearchBusy(false); return }
    let current = true
    const timer = window.setTimeout(() => {
      setMessageSearchBusy(true)
      void api.searchMessages(query).then(results => { if (current) setMessageSearchResults(results) }).catch(() => { if (current) setMessageSearchResults([]) }).finally(() => { if (current) setMessageSearchBusy(false) })
    }, 250)
    return () => { current = false; window.clearTimeout(timer) }
  }, [projectSearch])
  useEffect(() => {
    if (activeProjectId) void refreshGit(activeProjectId)
    else setGitStatus(null)
  }, [activeProjectId, refreshGit])
  useEffect(() => {
    const expired = () => { setAuth(current => current ? { ...current, authenticated: false, csrfToken: undefined } : current); setMessages([]) }
    window.addEventListener('polar:auth-expired', expired)
    return () => window.removeEventListener('polar:auth-expired', expired)
  }, [])

  useEffect(() => {
    if (!auth?.authenticated || !activeProjectId || !activeSessionId) { setFiles([]); setMessages([]); return }
    let current = true
    Promise.all([api.listFiles(activeProjectId), api.messages(activeProjectId, activeSessionId)])
      .then(([nextFiles, nextMessages]) => { if (current) { setFiles(nextFiles); setMessages(nextMessages); setSelectedFile(nextFiles.find(file => file.kind === 'file')?.path ?? '') } })
      .catch(cause => { if (current) showToast(cause instanceof Error ? cause.message : 'Не удалось загрузить проект.') })
    return () => { current = false }
  }, [auth?.authenticated, activeProjectId, activeSessionId, showToast])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const syncPanel = (event: MediaQueryListEvent) => setContextOpen(!event.matches)
    setContextOpen(!media.matches)
    media.addEventListener('change', syncPanel)
    return () => media.removeEventListener('change', syncPanel)
  }, [])

  const selectProject = (project: Project) => {
    setActiveProjectId(project.id)
    setActiveSessionId(project.sessions[0]?.id ?? '')
    setView('Chat')
    setSidebarOpen(false)
  }
  const selectSession = (session: Session) => { setActiveSessionId(session.id); setView('Chat'); setSidebarOpen(false) }
  const openSearchResult = (result: MessageSearchResult) => { setActiveProjectId(result.projectId); setActiveSessionId(result.sessionId); setView('Chat'); setSidebarOpen(false); setProjectSearch('') }

  const createSession = async () => {
    if (!activeProject) return
    try {
      const record = await api.createSession(activeProject.id)
      const newSession: Session = { id: record.id, title: record.title, status: 'idle', updated: 'сейчас' }
      setProjects(current => current.map(project => project.id === activeProject.id ? { ...project, sessions: [newSession, ...project.sessions] } : project))
      setActiveSessionId(record.id)
      setView('Chat')
      setSidebarOpen(false)
    } catch (cause) { showToast(cause instanceof Error ? cause.message : 'Не удалось создать сессию.') }
  }

  const renameSession = async (session: Session) => {
    if (!activeProject) return
    const title = window.prompt('Новое название чата', session.title)
    if (!title?.trim()) return
    try {
      await api.updateSession(activeProject.id, session.id, { title: title.trim() })
      setProjects(current => current.map(project => project.id === activeProject.id ? { ...project, sessions: project.sessions.map(item => item.id === session.id ? { ...item, title: title.trim() } : item) } : project))
    } catch (cause) { showToast(cause instanceof Error ? cause.message : 'Не удалось переименовать чат.') }
  }

  const createProject = async (name: string, path?: string) => {
    setProjectBusy(true)
    try {
      const created: ProjectRecord = await api.createProject(name, '', path)
      const project = toUiProject(created)
      setProjects(current => [project, ...current])
      setActiveProjectId(project.id)
      setActiveSessionId(project.sessions[0]?.id ?? '')
      setCreateProjectOpen(false)
      setView('Chat')
    } catch (cause) { showToast(cause instanceof Error ? cause.message : 'Не удалось создать проект.') }
    finally { setProjectBusy(false) }
  }

  const saveProjectInstructions = async (instructions: string) => {
    if (!activeProject) return
    try {
      const updated = await api.updateProject(activeProject.id, { instructions })
      setProjects(current => current.map(project => project.id === activeProject.id ? { ...project, instructions: updated.instructions } : project))
      showToast('Инструкции проекта сохранены')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Не удалось сохранить инструкции.'
      showToast(message)
      throw new Error(message)
    }
  }

  const uploadFiles = async (selected: File[]) => {
    if (!activeProject || !activeSession || busy || uploadBusy) return
    const key = `${activeProject.id}:${activeSession.id}`
    const existing = attachmentQueues[key] ?? []
    const candidates = selected.slice(0, Math.max(0, 8 - existing.length))
    if (candidates.length < selected.length) showToast('В одном сообщении можно прикрепить не более 8 файлов.')
    if (!candidates.length) return
    setUploadBusy(true)
    const completed: AttachmentInfo[] = []
    try {
      for (const file of candidates) {
        if (file.size > 20 * 1024 * 1024) { showToast(`${file.name}: файл больше лимита 20 МБ.`); continue }
        completed.push(await api.uploadAttachment(activeProject.id, activeSession.id, file))
      }
      if (completed.length) setAttachmentQueues(current => ({ ...current, [key]: [...(current[key] ?? []), ...completed] }))
    } catch (cause) {
      if (completed.length) setAttachmentQueues(current => ({ ...current, [key]: [...(current[key] ?? []), ...completed] }))
      showToast(cause instanceof Error ? cause.message : 'Не удалось загрузить вложение.')
    } finally { setUploadBusy(false) }
  }

  const removeQueuedAttachment = (attachmentId: string) => {
    if (!activeProject || !activeSession) return
    const key = `${activeProject.id}:${activeSession.id}`
    setAttachmentQueues(current => ({ ...current, [key]: (current[key] ?? []).filter(item => item.id !== attachmentId) }))
    void api.deleteAttachment(activeProject.id, activeSession.id, attachmentId).catch(cause => showToast(cause instanceof Error ? cause.message : 'Не удалось удалить вложение.'))
  }

  const sendMessage = useCallback((content: string, model: 'sonnet' | 'opus' | 'haiku' = 'sonnet', webSearch = false, replay?: { attachments: AttachmentInfo[] }) => {
    if (!activeProject || !activeSession || busy || uploadBusy) return
    const queueKey = `${activeProject.id}:${activeSession.id}`
    const queuedAttachments = replay?.attachments ?? attachmentQueues[queueKey] ?? []
    const userMessage: ChatMessage = { id: `local-${Date.now()}`, role: 'user', content, model, attachments: queuedAttachments, time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }
    const assistantId = `assistant-${Date.now()}`
    setActivity([])
    setPermissionRequests([])
    setBusy(true)
    setMessages(current => [...current, userMessage, { id: assistantId, role: 'assistant', content: '', model, time: 'сейчас' }])
    void api.streamMessage({ projectId: activeProject.id, sessionId: activeSession.id, content, model, webSearch, contextFiles: files.filter(file => file.kind === 'file' && file.context).map(file => file.path), attachmentIds: queuedAttachments.map(file => file.id), permissionMode }, event => {
      if (event.type === 'started' && !replay && queuedAttachments.length) setAttachmentQueues(current => ({ ...current, [queueKey]: [] }))
      if (event.type === 'delta') setMessages(current => current.map(message => message.id === assistantId ? { ...message, content: message.content + event.text } : message))
      if (event.type === 'activity') setActivity(current => [...current, { tool: event.tool, summary: event.summary ?? '' }])
      if (event.type === 'permission') setPermissionRequests(current => [...current.filter(item => item.id !== event.id), { id: event.id, tool: event.tool, summary: event.summary, detail: event.detail, createdAt: event.createdAt, state: 'pending' }])
      if (event.type === 'permission_resolved') setPermissionRequests(current => current.map(item => item.id === event.id ? { ...item, state: event.behavior === 'allow' ? 'allowed' : event.reason === 'denied' ? 'denied' : 'expired' } : item))
      if (event.type === 'done' || event.type === 'error') setPermissionRequests(current => current.map(item => item.state === 'pending' || item.state === 'sending' ? { ...item, state: 'expired' } : item))
      if (event.type === 'done') {
        setMessages(current => current.map(message => message.id === assistantId ? { ...message, inputTokens: event.inputTokens, outputTokens: event.outputTokens } : message))
        setBusy(false)
        setActiveController(null)
        void api.messages(activeProject.id, activeSession.id).then(setMessages).catch(() => undefined)
        void api.listProjects().then(result => setProjects(result.projects.map(toUiProject))).catch(() => undefined)
        void refreshGit(activeProject.id)
      }
      if (event.type === 'error') {
        setBusy(false)
        setActiveController(null)
        setMessages(current => current.filter(message => message.id !== assistantId))
        showToast(event.message)
      }
    }, error => { setBusy(false); setActiveController(null); setMessages(current => current.filter(message => message.id !== assistantId)); showToast(error.message) }).then(setActiveController)
  }, [activeProject, activeSession, attachmentQueues, busy, files, permissionMode, refreshGit, showToast, uploadBusy])

  const decidePermission = async (requestId: string, decision: 'allow' | 'deny') => {
    if (!activeSession) return
    setPermissionRequests(current => current.map(item => item.id === requestId ? { ...item, state: 'sending' } : item))
    try {
      await api.decidePermission(requestId, activeSession.id, decision)
      setPermissionRequests(current => current.map(item => item.id === requestId && item.state === 'sending' ? { ...item, state: decision === 'allow' ? 'allowed' : 'denied' } : item))
    } catch (cause) {
      setPermissionRequests(current => current.map(item => item.id === requestId ? { ...item, state: 'expired' } : item))
      showToast(cause instanceof Error ? cause.message : 'Не удалось отправить решение.')
    }
  }

  const retryMessage = useCallback((message: ChatMessage) => {
    const model = message.model === 'opus' || message.model === 'haiku' ? message.model : 'sonnet'
    sendMessage(message.content, model, false, { attachments: message.attachments ?? [] })
  }, [sendMessage])

  const stopMessage = () => {
    activeController?.abort()
    setActiveController(null)
    setBusy(false)
    showToast('Поток остановлен. История сохранена.')
  }

  const toggleContextFile = (path: string) => setFiles(current => current.map(file => file.path === path ? { ...file, context: !file.context } : file))
  const toggleStaged = async (path: string) => {
    if (!activeProject) return
    const change = changes.find(item => item.path === path)
    if (!change) return
    try {
      if (change.staged) await api.gitUnstage(activeProject.id, path)
      else await api.gitStage(activeProject.id, path)
      await refreshGit(activeProject.id)
    } catch (cause) { showToast(cause instanceof Error ? cause.message : 'Не удалось изменить индекс Git.') }
  }

  const commitChanges = async (message: string) => {
    if (!activeProject) return
    try {
      const result = await api.gitCommit(activeProject.id, message)
      showToast(`Локальный коммит ${result.hash} создан`)
      await refreshGit(activeProject.id)
    } catch (cause) { showToast(cause instanceof Error ? cause.message : 'Не удалось создать коммит.') }
  }

  const initializeGit = async () => {
    if (!activeProject) return
    try {
      await api.gitInit(activeProject.id)
      await refreshGit(activeProject.id)
      showToast('Локальный Git-репозиторий готов')
    } catch (cause) { showToast(cause instanceof Error ? cause.message : 'Не удалось инициализировать Git.') }
  }

  if (!auth) return <LoadingScreen label={workspaceError || 'Проверяем защищённое web-пространство…'} />
  if (!auth.authenticated) return <AuthGate initialized={auth.initialized} onSuccess={() => { void refreshAuth() }} />
  if (!workspaceLoaded) return <LoadingScreen label="Загружаем проекты и историю чатов…" />
  if (projects.length === 0) return <><FirstProject onCreate={() => setCreateProjectOpen(true)} busy={projectBusy} error={workspaceError} />{createProjectOpen && <NewProjectModal hostPathsAllowed={hostPathsAllowed} onClose={() => setCreateProjectOpen(false)} onCreate={(name, path) => { void createProject(name, path) }} />}</>
  if (!activeProject || !activeSession) return <LoadingScreen label="Открываем проект…" />

  return <div className={`app-shell${sidebarOpen ? ' sidebar-is-open' : ''}${!contextOpen ? ' context-is-closed' : ''}`}>
    <NavigationRail current={view} onChange={setView} onSettings={() => setSettingsOpen(true)} onToggleSidebar={() => setSidebarOpen(current => !current)} />
    <div className="sidebar-panel"><Sidebar projects={projects} activeProject={activeProject} activeSession={activeSession} search={projectSearch} onSearch={setProjectSearch} onSelectProject={selectProject} onSelectSession={selectSession} onCreateProject={() => setCreateProjectOpen(true)} onNewSession={() => { void createSession() }} onRenameSession={session => { void renameSession(session) }} searchResults={messageSearchResults} searching={messageSearchBusy} onOpenSearchResult={openSearchResult} onSettings={() => setSettingsOpen(true)} username={username} cliStatus={cliStatus} /></div>
    <main className="app-main">
      <header className="topbar">
        <div className="topbar-left"><button className="mobile-sidebar-toggle icon-button" onClick={() => setSidebarOpen(current => !current)} aria-label="Открыть список проектов"><PanelLeft size={17} /></button><div className="breadcrumbs"><span className="breadcrumb-workspace">polar</span><ChevronRight size={13} /><button className="breadcrumb-project" onClick={() => setSidebarOpen(true)}><span className="breadcrumb-project-mark" style={{ color: activeProject.color }}>{activeProject.mark}</span>{activeProject.name}<ChevronDown size={12} /></button><ChevronRight size={13} /><span className="breadcrumb-view">{workspaceTitle}</span></div><div className="topbar-branch"><GitBranch size={12} />{gitStatus?.initialized ? gitStatus.branch : 'без Git'}<ChevronDown size={11} /></div></div>
        <div className="topbar-right"><span className={`prototype-status${cliStatus?.enabled && cliStatus.loginFilePresent ? ' status-connected' : ''}`}><span className="prototype-status-dot" />{cliStatus?.enabled && cliStatus.loginFilePresent ? 'Claude Code подключён' : 'личный web workspace'}</span><span className="topbar-divider" /><button className="icon-button mobile-context-toggle" onClick={() => setContextOpen(current => !current)} aria-label="Контекст проекта" aria-expanded={contextOpen}><PanelRightClose size={16} /></button><button className="icon-button mobile-new-chat" onClick={() => { void createSession() }} aria-label="Новый чат"><Plus size={16} /></button><button className="top-avatar" onClick={() => setSettingsOpen(true)} aria-label="Профиль и безопасность">{username.slice(0, 1).toUpperCase()}</button><button className="icon-button top-settings" onClick={() => setSettingsOpen(true)} title="Настройки"><Settings2 size={16} /></button></div>
      </header>
      <div className="workspace-subbar"><div className="view-tabs">{viewEntries.map(({ key, icon: Icon }) => <button key={key} className={`view-tab${view === key ? ' is-active' : ''}`} onClick={() => setView(key)}><Icon size={14} strokeWidth={1.9} /><span>{key === 'Source Control' ? 'Source Control' : key === 'Chat' ? 'Чат' : key === 'Terminal' ? 'Shell' : 'Файлы'}</span>{key === 'Source Control' && <span className="tab-count">{changes.length}</span>}</button>)}</div><div className="subbar-actions"><span className="subbar-session"><span className={`session-indicator session-${activeSession.status}`} />{activeSession.title}</span><button className="context-toggle icon-button" onClick={() => setContextOpen(current => !current)} aria-label="Переключить контекст" aria-expanded={contextOpen} title="Контекст"><PanelRightClose size={15} /></button><button className="new-session-button" onClick={() => { void createSession() }}><Plus size={14} /><span>Новый чат</span></button></div></div>
      <div className="workspace-body"><section className={`work-area work-area--${view.toLowerCase().replace(' ', '-')}`}>
        {view === 'Chat' && <ChatView project={activeProject} session={activeSession} contextCount={contextCount} messages={messages} busy={busy} activity={activity} permissionRequests={permissionRequests} onDecidePermission={(id, decision) => { void decidePermission(id, decision) }} permissionMode={permissionMode} onPermissionModeChange={setPermissionMode} attachments={pendingAttachments} uploadBusy={uploadBusy} webSearchAvailable={Boolean(cliStatus?.webSearchAvailable)} onUploadFiles={files => { void uploadFiles(files) }} onRemoveAttachment={removeQueuedAttachment} onSend={sendMessage} onResend={value => sendMessage(value)} onRetryLastMessage={retryMessage} onStop={stopMessage} />}
        {view === 'Terminal' && <Suspense fallback={<div className="file-loading">Загружаем терминал…</div>}><TerminalView project={activeProject} terminalId={terminalIds[activeProject.id] ?? null} onTerminalIdChange={updateTerminalId} /></Suspense>}
        {view === 'Files' && <FilesView projectId={activeProject.id} files={files} selectedFile={selectedFile} projectName={activeProject.name} branch={gitStatus?.branch ?? ''} onSelectFile={setSelectedFile} onRefresh={() => { void refreshFiles() }} />}
        {view === 'Source Control' && <SourceControlView status={gitStatus} onRefresh={() => { void refreshGit(activeProject.id) }} onInitialize={() => { void initializeGit() }} onToggleStaged={path => { void toggleStaged(path) }} onCommit={message => { void commitChanges(message) }} onOpenFile={path => { setSelectedFile(path); setView('Files') }} project={activeProject} />}
      </section>
      {contextOpen && <ContextPanel files={files} instructions={activeProject.instructions} onToggleFile={toggleContextFile} onSaveInstructions={saveProjectInstructions} />}
      </div>
      <div className="global-statusbar"><div><span className="status-connection"><span /> {cliStatus?.enabled && cliStatus.loginFilePresent ? 'Claude Code CLI' : 'личная серверная история'}</span><span className="status-separator" /><span className="status-context"><ShieldCheck size={12} /> Не подключено к Claude.ai history</span></div><div><span>POLAR WORKSPACE</span><span className="status-separator" /><span>{cliStatus?.version ?? 'CLI не проверен'}</span><span className="status-indicator"><Circle size={8} /> {cliStatus?.enabled ? 'online' : 'server setup'}</span></div></div>
      <MobileNavigation current={view} onChange={setView} onProjects={() => setSidebarOpen(true)} />
    </main>
    {sidebarOpen && <button className="mobile-overlay" onClick={() => setSidebarOpen(false)} aria-label="Закрыть боковую панель" />}
    {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} username={username} cliStatus={cliStatus} onLogout={() => { setSettingsOpen(false); setAuth(current => current ? { ...current, authenticated: false, csrfToken: undefined } : current); setProjects([]); setActiveProjectId(''); setActiveSessionId(''); setMessages([]) }} />}
    {createProjectOpen && <NewProjectModal hostPathsAllowed={hostPathsAllowed} onClose={() => setCreateProjectOpen(false)} onCreate={(name, path) => { void createProject(name, path) }} />}
    {toast && <div className="toast"><span><Check size={13} /></span>{toast}</div>}
  </div>
}

export default App
