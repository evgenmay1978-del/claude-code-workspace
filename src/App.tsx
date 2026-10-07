import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, Check, ChevronDown, ChevronRight, Circle, FileCode2, GitBranch, Layers2, MessageSquare, MoreHorizontal, PanelLeft, PanelRightClose, Plus, Settings2, ShieldCheck, TerminalSquare, X } from 'lucide-react'
import { initialChanges, initialFiles, initialMessages, initialProjects } from './data/mock'
import type { ChatMessage, ChangeFile, Project, ProjectFile, Session, View } from './types'
import { Sidebar, NavigationRail } from './components/Sidebar'
import { ContextPanel } from './components/ContextPanel'
import { SettingsModal } from './components/SettingsModal'
import { ChatView, FilesView, SourceControlView, TerminalView, type TerminalLine } from './components/Workspaces'

const viewEntries: { key: View; icon: typeof MessageSquare }[] = [
  { key: 'Chat', icon: MessageSquare }, { key: 'Terminal', icon: TerminalSquare }, { key: 'Files', icon: FileCode2 }, { key: 'Source Control', icon: GitBranch },
]

function NewProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('')
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler) }, [onClose])
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><form className="new-project-modal" onSubmit={event => { event.preventDefault(); if (name.trim()) onCreate(name.trim()) }}>
    <div className="new-project-icon"><Plus size={17} /></div><button type="button" className="icon-button new-project-close" onClick={onClose} aria-label="Закрыть"><X size={16} /></button><span className="modal-kicker">НОВОЕ ПРОСТРАНСТВО</span><h2>Добавить проект</h2><p>Каждый проект получает отдельные сессии, файлы и контекст.</p><label htmlFor="project-name">Название проекта</label><input id="project-name" autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="Например, northstar" maxLength={32} /><div className="project-folder-preview"><span className="folder-preview-icon"><Layers2 size={15} /></span><span><strong>Локальный workspace</strong><small>Подключение сервера настроите отдельно</small></span><ShieldCheck size={14} /></div><div className="new-project-actions"><button type="button" className="button-secondary" onClick={onClose}>Отмена</button><button type="submit" className="button-primary" disabled={!name.trim()}>Создать проект <ChevronRight size={14} /></button></div>
  </form></div>
}

function App() {
  const [projects, setProjects] = useState<Project[]>(initialProjects)
  const [activeProjectId, setActiveProjectId] = useState('northstar')
  const [activeSessionId, setActiveSessionId] = useState('session-1')
  const [view, setView] = useState<View>('Chat')
  const [files, setFiles] = useState<ProjectFile[]>(initialFiles)
  const [changes, setChanges] = useState<ChangeFile[]>(initialChanges)
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessage[]>>({ 'session-1': initialMessages })
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([
    { kind: 'output', text: 'Claude Code workspace · сессия northstar' },
    { kind: 'output', text: 'Симуляция команд включена. Выберите быстрый пример ниже.' },
    { kind: 'input', text: 'pnpm test' },
    { kind: 'success', text: '✓ 18 тестов пройдены · 0 ошибок (демо)' },
  ])
  const [selectedFile, setSelectedFile] = useState('src/components/Hero.tsx')
  const [projectSearch, setProjectSearch] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(() => window.innerWidth > 980)
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)

  const activeProject = projects.find(project => project.id === activeProjectId) ?? projects[0]
  const activeSession = activeProject.sessions.find(session => session.id === activeSessionId) ?? activeProject.sessions[0]
  const messages = messagesBySession[activeSession.id] ?? (activeSession.id === 'session-1' ? initialMessages : [])
  const workspaceTitle = useMemo(() => view === 'Source Control' ? 'Source Control' : view, [view])
  const contextCount = files.filter(file => file.kind === 'file' && file.context).length

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(current => current === message ? '' : current), 2600)
  }, [])

  const sendMessage = useCallback((content: string) => {
    const newMessage: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content, time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }
    setMessagesBySession(current => ({ ...current, [activeSession.id]: [...(current[activeSession.id] ?? []), newMessage] }))
    setBusy(true)
    window.setTimeout(() => {
      const responseText = 'Я бы начал с самого малого шага: оставить один ясный CTA, не меняя остальную структуру. В реальном окружении Claude Code сейчас проверил бы компоненты и тесты; здесь ответ демонстрационный — сервер ещё не подключён.'
      const chunks = responseText.match(/\S+\s*/g) ?? [responseText]
      const responseId = `a-${Date.now()}`
      const response: ChatMessage = { id: responseId, role: 'assistant', content: chunks[0], time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }
      setMessagesBySession(current => ({ ...current, [activeSession.id]: [...(current[activeSession.id] ?? []), response] }))
      let cursor = 1
      const stream = window.setInterval(() => {
        const next = chunks[cursor++]
        if (next) setMessagesBySession(current => ({ ...current, [activeSession.id]: (current[activeSession.id] ?? []).map(message => message.id === responseId ? { ...message, content: message.content + next } : message) }))
        if (cursor >= chunks.length) { window.clearInterval(stream); setBusy(false) }
      }, 34)
    }, 400)
  }, [activeSession.id])

  const selectProject = (project: Project) => {
    setActiveProjectId(project.id)
    const session = project.sessions[0]
    if (session) setActiveSessionId(session.id)
    setSidebarOpen(false)
  }
  const selectSession = (session: Session) => { setActiveSessionId(session.id); setSidebarOpen(false) }
  const createSession = () => {
    const session: Session = { id: `session-${Date.now()}`, title: 'Новая сессия', status: 'active', updated: 'сейчас' }
    setProjects(current => current.map(project => project.id === activeProject.id ? { ...project, sessions: [session, ...project.sessions] } : project))
    setActiveSessionId(session.id)
    setMessagesBySession(current => ({ ...current, [session.id]: [] }))
    setView('Chat')
    setSidebarOpen(false)
    showToast('Новая сессия создана')
  }
  const renameSession = (session: Session) => {
    const value = window.prompt('Новое название сессии', session.title)
    if (!value?.trim()) return
    setProjects(current => current.map(project => project.id === activeProject.id ? { ...project, sessions: project.sessions.map(item => item.id === session.id ? { ...item, title: value.trim() } : item) } : project))
  }
  const createProject = (name: string) => {
    const id = `${name.toLowerCase().replace(/[^a-z0-9а-яё-]+/gi, '-').replace(/^-|-$/g, '') || 'project'}-${Date.now().toString().slice(-4)}`
    const firstSession: Session = { id: `session-${Date.now()}`, title: 'Первая сессия', status: 'idle', updated: 'сейчас' }
    const project: Project = { id, name, repo: `workspace/${name}`, branch: 'main', color: '#ff9c83', mark: name.slice(0, 1).toUpperCase(), status: 'ready', updated: 'сейчас', sessions: [firstSession] }
    setProjects(current => [project, ...current])
    setActiveProjectId(id)
    setActiveSessionId(firstSession.id)
    setMessagesBySession(current => ({ ...current, [firstSession.id]: [] }))
    setCreateProjectOpen(false)
    setView('Chat')
    showToast(`Проект «${name}» добавлен`)
  }
  const toggleContextFile = (path: string) => {
    setFiles(current => current.map(file => file.path === path ? { ...file, context: !file.context } : file))
  }
  const runCommand = (command: string) => {
    const value = command.trim()
    if (!value) return
    let kind: TerminalLine['kind'] = 'output'
    let output: string[] = []
    const normalized = value.toLowerCase()
    if (normalized === 'pnpm test' || normalized === 'npm test') { kind = 'success'; output = ['✓ 18 тестов пройдены · 0 ошибок (демо)'] }
    else if (normalized === 'git status') { output = ['На ветке ' + activeProject.branch, 'Изменения не подготовлены к коммиту (демо):', '  modified: src/components/Hero.tsx', '  modified: src/styles/tokens.css'] }
    else if (normalized === 'pwd') { output = ['/workspace/' + activeProject.name] }
    else if (normalized === 'ls' || normalized === 'ls -la') { output = ['src/   public/   package.json   README.md   CLAUDE.md'] }
    else { kind = 'warning'; output = ['Демо-режим: команда не запускалась. Подключение к вашему серверу — отдельный следующий шаг.'] }
    setTerminalLines(current => [...current, { kind: 'input', text: value }, ...output.map(text => ({ kind, text } as TerminalLine))])
  }
  const toggleStaged = (path: string) => setChanges(current => current.map(file => file.path === path ? { ...file, staged: !file.staged } : file))
  const commitChanges = (message: string) => {
    const count = changes.filter(file => file.staged).length
    if (!count) return
    setChanges(current => current.filter(file => !file.staged))
    showToast(`Коммит «${message}» создан в демо (${count} файл${count > 1 ? 'а' : ''})`)
  }

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.getElementById('project-search')?.focus() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); createSession() }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [activeProject.id])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 980px)')
    const syncPanel = (event: MediaQueryListEvent) => setContextOpen(!event.matches)
    media.addEventListener('change', syncPanel)
    return () => media.removeEventListener('change', syncPanel)
  }, [])

  return <div className={`app-shell${sidebarOpen ? ' sidebar-is-open' : ''}${!contextOpen ? ' context-is-closed' : ''}`}>
    <NavigationRail current={view} onChange={setView} onSettings={() => setSettingsOpen(true)} onToggleSidebar={() => setSidebarOpen(current => !current)} />
    <div className="sidebar-panel"><Sidebar projects={projects} activeProject={activeProject} activeSession={activeSession} search={projectSearch} onSearch={setProjectSearch} onSelectProject={selectProject} onSelectSession={selectSession} onCreateProject={() => setCreateProjectOpen(true)} onNewSession={createSession} onRenameSession={renameSession} onSettings={() => setSettingsOpen(true)} /></div>
    <main className="app-main">
      <header className="topbar">
        <div className="topbar-left"><button className="mobile-sidebar-toggle icon-button" onClick={() => setSidebarOpen(current => !current)} aria-label="Открыть список проектов"><PanelLeft size={17} /></button><div className="breadcrumbs"><span className="breadcrumb-workspace">polar</span><ChevronRight size={13} /><button className="breadcrumb-project" onClick={() => setSidebarOpen(true)}><span className="breadcrumb-project-mark" style={{ color: activeProject.color }}>{activeProject.mark}</span>{activeProject.name}<ChevronDown size={12} /></button><ChevronRight size={13} /><span className="breadcrumb-view">{workspaceTitle}</span></div><div className="topbar-branch"><GitBranch size={12} />{activeProject.branch}<ChevronDown size={11} /></div></div>
        <div className="topbar-right"><span className="prototype-status"><span className="prototype-status-dot" /> прототип</span><span className="topbar-divider" /><button className="icon-button notification-button" aria-label="Уведомления" onClick={() => showToast('Уведомлений пока нет')}><Bell size={16} /><i /></button><button className="top-avatar" onClick={() => setSettingsOpen(true)} aria-label="Профиль и безопасность">М</button><button className="icon-button top-settings" onClick={() => setSettingsOpen(true)} title="Настройки"><Settings2 size={16} /></button></div>
      </header>
      <div className="workspace-subbar"><div className="view-tabs">{viewEntries.map(({ key, icon: Icon }) => <button key={key} className={`view-tab${view === key ? ' is-active' : ''}`} onClick={() => setView(key)}><Icon size={14} strokeWidth={1.9} /><span>{key === 'Source Control' ? 'Source Control' : key === 'Chat' ? 'Чат' : key === 'Terminal' ? 'Терминал' : 'Файлы'}</span>{key === 'Source Control' && <span className="tab-count">{changes.length}</span>}</button>)}</div><div className="subbar-actions"><span className="subbar-session"><span className={`session-indicator session-${activeSession.status}`} />{activeSession.title}</span><button className="context-toggle icon-button" onClick={() => setContextOpen(current => !current)} aria-label="Переключить контекст" aria-expanded={contextOpen} title="Контекст"><PanelRightClose size={15} /></button><button className="icon-button subbar-more" aria-label="Свернуть"><MoreHorizontal size={16} /></button><button className="new-session-button" onClick={createSession}><Plus size={14} /><span>Новая сессия</span></button></div></div>
      <div className="workspace-body"><section className={`work-area work-area--${view.toLowerCase().replace(' ', '-')}`}>
        {view === 'Chat' && <ChatView project={activeProject} session={activeSession} contextCount={contextCount} messages={messages} busy={busy} onSend={sendMessage} onResend={sendMessage} />}
        {view === 'Terminal' && <TerminalView lines={terminalLines} onRun={runCommand} project={activeProject} />}
        {view === 'Files' && <FilesView files={files} selectedFile={selectedFile} projectName={activeProject.name} branch={activeProject.branch} onSelectFile={setSelectedFile} />}
        {view === 'Source Control' && <SourceControlView changes={changes} onToggleStaged={toggleStaged} onCommit={commitChanges} project={activeProject} />}
      </section>
      {contextOpen && <ContextPanel files={files} onToggleFile={toggleContextFile} />}
      </div>
      <div className="global-statusbar"><div><span className="status-connection"><span /> Локальная сессия</span><span className="status-separator" /><span className="status-context"><ShieldCheck size={12} /> Контекст под контролем</span></div><div><span>Claude Code Workspace</span><span className="status-separator" /><span>v0.1 prototype</span><span className="status-indicator"><Circle size={8} /> offline</span></div></div>
    </main>
    {sidebarOpen && <button className="mobile-overlay" onClick={() => setSidebarOpen(false)} aria-label="Закрыть боковую панель" />}
    {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    {createProjectOpen && <NewProjectModal onClose={() => setCreateProjectOpen(false)} onCreate={createProject} />}
    {toast && <div className="toast"><span><Check size={13} /></span>{toast}</div>}
  </div>
}

export default App
