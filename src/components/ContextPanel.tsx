import { useMemo, useState } from 'react'
import { BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, FileCode2, FileText, Plus, Search, ShieldCheck, Sparkles, X } from 'lucide-react'
import type { ProjectFile } from '../types'

interface Props { files: ProjectFile[]; onToggleFile: (path: string) => void }

function fileIcon(path: string) {
  if (path === 'CLAUDE.md') return <BookOpen size={14} className="file-icon file-icon--gold" />
  if (path.endsWith('.md')) return <FileText size={14} className="file-icon file-icon--purple" />
  return <FileCode2 size={14} className="file-icon file-icon--blue" />
}

export function ContextPanel({ files, onToggleFile }: Props) {
  const [open, setOpen] = useState(true)
  const [instructionsOpen, setInstructionsOpen] = useState(true)
  const [query, setQuery] = useState('')
  const selected = useMemo(() => files.filter(file => file.kind === 'file' && file.context), [files])
  const available = useMemo(() => files.filter(file => file.kind === 'file' && file.path.toLowerCase().includes(query.toLowerCase())), [files, query])
  const [pickerOpen, setPickerOpen] = useState(false)
  const usage = Math.min(94, 25 + selected.length * 0.8)
  return <aside className="context-panel">
    <div className="context-header"><div><span className="context-eyebrow">РАБОЧАЯ СЕССИЯ</span><h2>Контекст</h2></div><button className="icon-button tiny" title="Справка о контексте"><CircleHelp size={15} /></button></div>
    <div className="context-meter-card">
      <div className="meter-top"><span>Окно контекста</span><span className="meter-value">~{usage}%</span></div>
      <div className="meter-track"><span style={{ width: `${usage}%` }} /></div>
      <div className="meter-bottom"><span>~32k токенов</span><span>из 128k</span></div>
    </div>
    <div className="context-section-head"><button className="section-toggle" onClick={() => setOpen(!open)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span>Файлы в контексте</span><span className="section-count">{selected.length}</span></button><button className="icon-button tiny" onClick={() => setPickerOpen(!pickerOpen)} title="Добавить файл"><Plus size={15} /></button></div>
    {open && <div className="context-file-list">{selected.map(file => <div className="context-file" key={file.path}>{fileIcon(file.path)}<span className="context-file-name" title={file.path}>{file.path.split('/').pop()}</span><button className="icon-button tiny remove-context" onClick={() => onToggleFile(file.path)} aria-label={`Убрать ${file.path}`}><X size={12} /></button></div>)}{selected.length === 0 && <div className="context-empty">Пока нет выбранных файлов</div>}</div>}
    {pickerOpen && <div className="file-picker"><div className="file-picker-search"><Search size={13} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Добавить файл…" autoFocus /></div><div className="file-picker-list">{available.map(file => <button key={file.path} onClick={() => onToggleFile(file.path)} className="file-picker-option">{fileIcon(file.path)}<span>{file.path.split('/').pop()}</span>{file.context && <Check size={13} />}</button>)}</div></div>}
    <div className="context-add-row"><button onClick={() => setPickerOpen(!pickerOpen)}><Plus size={14} />Добавить файл или папку</button></div>

    <div className="context-section-head context-section-head--instructions"><button className="section-toggle" onClick={() => setInstructionsOpen(!instructionsOpen)}>{instructionsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span>Инструкции</span><span className="instruction-tag">CLAUDE.md</span></button></div>
    {instructionsOpen && <div className="instruction-card"><div className="instruction-card__top"><span className="instruction-file-icon"><BookOpen size={13} /></span><span>CLAUDE.md</span><span className="instruction-status"><Check size={11} />Активна</span></div><p>Небольшие точечные изменения. Беречь спокойный тон и доступность.</p><button>Открыть инструкцию <ChevronRight size={12} /></button></div>}

    <div className="context-divider" />
    <div className="context-note"><span className="context-note__icon"><ShieldCheck size={14} /></span><span><strong>Под вашим контролем</strong><small>В контекст попадают только выбранные файлы</small></span></div>
    <div className="context-footer"><Sparkles size={13} /><span>Контекст собран для этой сессии</span></div>
  </aside>
}
