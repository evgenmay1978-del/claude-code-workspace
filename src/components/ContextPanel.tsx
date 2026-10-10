import { useMemo, useState } from 'react'
import { BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, FileCode2, FileText, Pencil, Plus, Search, ShieldCheck, Sparkles, X } from 'lucide-react'
import type { ProjectFile } from '../types'

interface Props {
  files: ProjectFile[]
  instructions: string
  onToggleFile: (path: string) => void
  onSaveInstructions: (value: string) => Promise<void>
}

function fileIcon(path: string) {
  if (path === 'CLAUDE.md') return <BookOpen size={14} className="file-icon file-icon--gold" />
  if (path.endsWith('.md')) return <FileText size={14} className="file-icon file-icon--purple" />
  return <FileCode2 size={14} className="file-icon file-icon--blue" />
}

export function ContextPanel({ files, instructions, onToggleFile, onSaveInstructions }: Props) {
  const [open, setOpen] = useState(true)
  const [instructionsOpen, setInstructionsOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editingInstructions, setEditingInstructions] = useState(false)
  const [instructionDraft, setInstructionDraft] = useState(instructions)
  const [savingInstructions, setSavingInstructions] = useState(false)
  const [instructionError, setInstructionError] = useState('')
  const selected = useMemo(() => files.filter(file => file.kind === 'file' && file.context), [files])
  const available = useMemo(() => files.filter(file => file.kind === 'file' && file.path.toLowerCase().includes(query.toLowerCase())), [files, query])

  const saveInstructions = async () => {
    setSavingInstructions(true)
    setInstructionError('')
    try {
      await onSaveInstructions(instructionDraft)
      setEditingInstructions(false)
    } catch (cause) {
      setInstructionError(cause instanceof Error ? cause.message : 'Не удалось сохранить инструкции.')
    } finally { setSavingInstructions(false) }
  }

  return <aside className="context-panel">
    <div className="context-header"><div><span className="context-eyebrow">РАБОЧАЯ СЕССИЯ</span><h2>Контекст</h2></div><button className="icon-button tiny" title="Справка о контексте"><CircleHelp size={15} /></button></div>
    <div className="context-meter-card"><div className="meter-top"><span>Файлы, выбранные вручную</span><span className="meter-value">{selected.length}</span></div><p className="context-accuracy-note">Выбранные файлы добавляются к следующему запросу. Рабочая папка проекта также доступна CLI.</p></div>
    <div className="context-section-head"><button className="section-toggle" onClick={() => setOpen(!open)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span>Файлы в контексте</span><span className="section-count">{selected.length}</span></button><button className="icon-button tiny" onClick={() => setPickerOpen(!pickerOpen)} title="Добавить файл"><Plus size={15} /></button></div>
    {open && <div className="context-file-list">{selected.map(file => <div className="context-file" key={file.path}>{fileIcon(file.path)}<span className="context-file-name" title={file.path}>{file.path.split('/').pop()}</span><button className="icon-button tiny remove-context" onClick={() => onToggleFile(file.path)} aria-label={`Убрать ${file.path}`}><X size={12} /></button></div>)}{selected.length === 0 && <div className="context-empty">Пока нет выбранных файлов</div>}</div>}
    {pickerOpen && <div className="file-picker"><div className="file-picker-search"><Search size={13} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Добавить файл…" autoFocus /></div><div className="file-picker-list">{available.map(file => <button key={file.path} onClick={() => onToggleFile(file.path)} className="file-picker-option">{fileIcon(file.path)}<span>{file.path.split('/').pop()}</span>{file.context && <Check size={13} />}</button>)}</div></div>}
    <div className="context-add-row"><button onClick={() => setPickerOpen(!pickerOpen)}><Plus size={14} />Добавить файл или папку</button></div>

    <div className="context-section-head context-section-head--instructions"><button className="section-toggle" onClick={() => setInstructionsOpen(!instructionsOpen)}>{instructionsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span>Инструкции проекта</span><span className="instruction-tag">CLAUDE.md</span></button></div>
    {instructionsOpen && <div className="instruction-card"><div className="instruction-card__top"><span className="instruction-file-icon"><BookOpen size={13} /></span><span>Инструкции проекта</span><span className="instruction-status">{instructions.trim() ? <><Check size={11} />Сохранена</> : 'Не заданы'}</span></div>{editingInstructions ? <><textarea className="instruction-editor" value={instructionDraft} onChange={event => setInstructionDraft(event.target.value)} maxLength={20_000} placeholder="Например: стиль кода, команды сборки, правила тестирования…"/><div className="instruction-editor-actions"><button className="editor-save-button" disabled={savingInstructions} onClick={() => { void saveInstructions() }}>{savingInstructions ? 'Сохраняем…' : 'Сохранить'}</button><button className="editor-cancel-button" onClick={() => { setInstructionDraft(instructions); setEditingInstructions(false); setInstructionError('') }}>Отмена</button></div>{instructionError && <p className="instruction-error" role="alert">{instructionError}</p>}</> : <><p>{instructions.trim() || 'Добавьте правила и сведения о проекте. Они будут передаваться официальному CLI как инструкции.'}</p><button onClick={() => { setInstructionDraft(instructions); setEditingInstructions(true) }}><Pencil size={11} />{instructions.trim() ? 'Изменить инструкции' : 'Добавить инструкции'}</button></>}</div>}

    <div className="context-divider" />
    <div className="context-note"><span className="context-note__icon"><ShieldCheck size={14} /></span><span><strong>Под вашим контролем</strong><small>К CLI прикрепляются только выбранные файлы; история хранится на вашем сервере.</small></span></div>
    <div className="context-footer"><Sparkles size={13} /><span>Контекст выбран для этой сессии</span></div>
  </aside>
}
