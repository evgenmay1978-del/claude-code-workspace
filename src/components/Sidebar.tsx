import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Activity, ChevronDown, ChevronRight, FolderKanban, GitBranch, MessageSquare, MoreHorizontal, Plus, Search, Settings2, ShieldCheck, TerminalSquare } from 'lucide-react'
import type { Project, Session } from '../types'

interface Props {
  projects: Project[]
  activeProject: Project
  activeSession: Session
  search: string
  onSearch: (value: string) => void
  onSelectProject: (project: Project) => void
  onSelectSession: (session: Session) => void
  onCreateProject: () => void
  onNewSession: () => void
  onRenameSession: (session: Session) => void
  onSettings: () => void
}

export function Sidebar({ projects, activeProject, activeSession, search, onSearch, onSelectProject, onSelectSession, onCreateProject, onNewSession, onRenameSession, onSettings }: Props) {
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [sessionsOpen, setSessionsOpen] = useState(true)
  const filteredProjects = projects.filter(project => project.name.toLowerCase().includes(search.toLowerCase()))
  return <div className="sidebar-content">
    <div className="workspace-switcher">
      <div className="workspace-avatar"><span className="brand-mark"><span /><span /><i /></span></div>
      <div className="workspace-title"><strong>polar / workspace</strong><span>Личное пространство</span></div>
      <button className="icon-button tiny" aria-label="Выбрать workspace"><ChevronDown size={15} /></button>
    </div>

    <div className="sidebar-search"><Search size={14} /><input id="project-search" value={search} onChange={event => onSearch(event.target.value)} placeholder="Найти проект" /><kbd>⌘ K</kbd></div>

    <div className="sidebar-section-head"><button className="section-toggle" onClick={() => setProjectsOpen(!projectsOpen)}>{projectsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span>Проекты</span><span className="section-count">{projects.length}</span></button><button className="icon-button tiny" aria-label="Создать проект" onClick={onCreateProject}><Plus size={15} /></button></div>
    {projectsOpen && <div className="project-list">{filteredProjects.map(project => <button key={project.id} className={`project-row${project.id === activeProject.id ? ' is-active' : ''}`} onClick={() => onSelectProject(project)}>
      <span className="project-avatar" style={{ '--project-color': project.color } as CSSProperties}>{project.mark}</span>
      <span className="project-name">{project.name}</span><span className={`project-state state-${project.status}`} title={project.status} />
      {project.id === activeProject.id && <span className="project-branch-mini"><GitBranch size={11} />{project.branch}</span>}
    </button>)}{filteredProjects.length === 0 && <div className="empty-filter">Нет проектов по запросу</div>}</div>}

    <div className="sidebar-section-head sidebar-section-head--sessions"><button className="section-toggle" onClick={() => setSessionsOpen(!sessionsOpen)}>{sessionsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span>Сессии</span><span className="section-count">{activeProject.sessions.length}</span></button><button className="icon-button tiny" aria-label="Новая сессия" onClick={onNewSession}><Plus size={15} /></button></div>
    {sessionsOpen && <div className="session-list">{activeProject.sessions.map(session => <div key={session.id} className={`session-row-wrap${session.id === activeSession.id ? ' is-active' : ''}`}>
      <button className="session-row" onClick={() => onSelectSession(session)}><span className={`session-indicator session-${session.status}`} /> <span className="session-title">{session.title}</span></button>
      <span className="session-time">{session.updated}</span>
      <button className="session-more icon-button tiny" aria-label={`Переименовать ${session.title}`} onClick={() => onRenameSession(session)}><MoreHorizontal size={14} /></button>
    </div>)}</div>}

    <div className="sidebar-divider" />
    <div className="sidebar-quick-links">
      <button onClick={onSettings}><Settings2 size={15} /><span>Настройки</span></button>
      <button onClick={onSettings}><ShieldCheck size={15} /><span>Безопасность</span><span className="mini-check"><ShieldCheck size={11} /></span></button>
    </div>

    <div className="sidebar-bottom">
      <div className="connection-card"><span className="connection-icon"><Activity size={14} /></span><span><strong>Связь с агентом</strong><small><i className="status-dot" /> Прототип · offline</small></span><button className="icon-button tiny" aria-label="Статус"><MoreHorizontal size={14} /></button></div>
      <button className="user-card" onClick={onSettings}><span className="user-avatar">М</span><span className="user-meta"><strong>Мой workspace</strong><small>Личный сервер</small></span><ChevronDown size={14} /></button>
    </div>
  </div>
}

export function NavigationRail({ current, onChange, onSettings, onToggleSidebar }: { current: string; onChange: (view: 'Chat' | 'Terminal' | 'Files' | 'Source Control') => void; onSettings: () => void; onToggleSidebar: () => void }) {
  const entries = [
    { key: 'Chat', icon: MessageSquare, label: 'Сессии' },
    { key: 'Terminal', icon: TerminalSquare, label: 'Терминал' },
    { key: 'Files', icon: FolderKanban, label: 'Файлы' },
    { key: 'Source Control', icon: GitBranch, label: 'Git' },
  ] as const
  return <nav className="nav-rail" aria-label="Основная навигация">
    <button className="rail-brand" aria-label="Главная" onClick={onToggleSidebar}><span className="brand-mark"><span /><span /><i /></span></button>
    <div className="rail-separator" />
    {entries.map(({ key, icon: Icon, label }) => <button key={key} className={`rail-button${current === key ? ' is-active' : ''}`} onClick={() => onChange(key)} aria-label={label} title={label}><Icon size={18} strokeWidth={1.8} /><span className="rail-tooltip">{label}</span></button>)}
    <div className="rail-spacer" />
    <button className="rail-button" onClick={onSettings} aria-label="Настройки" title="Настройки"><Settings2 size={18} strokeWidth={1.8} /><span className="rail-tooltip">Настройки</span></button>
    <div className="rail-bottom-mark"><span className="rail-version">BETA</span><span className="rail-dot" /></div>
  </nav>
}
