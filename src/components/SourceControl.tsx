import { useEffect, useState } from 'react'
import { Check, ChevronDown, GitBranch, GitCommitHorizontal, GitPullRequest, RefreshCw, RotateCcw, TerminalSquare } from 'lucide-react'
import type { Project } from '../types'
import type { GitStatus } from '../lib/api'
import { api } from '../lib/api'

interface Props {
  project: Project
  status: GitStatus | null
  onRefresh: () => void
  onInitialize: () => void
  onToggleStaged: (path: string) => void
  onCommit: (message: string) => void
  onOpenFile: (path: string) => void
}

export function SourceControlView({ project, status, onRefresh, onInitialize, onToggleStaged, onCommit, onOpenFile }: Props) {
  const changes = status?.changes ?? []
  const [selected, setSelected] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [diff, setDiff] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [error, setError] = useState('')
  const stagedCount = changes.filter(file => file.staged).length

  useEffect(() => {
    if (!changes.some(file => file.path === selected)) setSelected(changes[0]?.path ?? '')
  }, [changes, selected])

  useEffect(() => {
    let current = true
    if (!selected || !status?.initialized) { setDiff(''); return }
    setDiffLoading(true); setError('')
    api.gitDiff(project.id, selected)
      .then(result => { if (current) setDiff([result.staged, result.unstaged].filter(Boolean).join('\n')) })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить diff.') })
      .finally(() => { if (current) setDiffLoading(false) })
    return () => { current = false }
  }, [project.id, selected, status?.initialized, changes])

  const commit = () => {
    const message = commitMessage.trim()
    if (!message || !stagedCount) return
    if (!window.confirm(`Создать локальный коммит «${message}» с ${stagedCount} файлом(ами)? Это действие не отправляет изменения на GitHub.`)) return
    onCommit(message)
    setCommitMessage('')
  }

  if (!status) return <div className="git-view"><div className="git-empty-state"><RefreshCw className="spin" size={20} /><strong>Загружаем Git…</strong></div></div>
  if (!status.initialized) return <div className="git-view"><div className="git-empty-state"><span className="git-empty-icon"><GitBranch size={22} /></span><strong>В проекте пока нет Git-репозитория</strong><span>Создайте локальный репозиторий, чтобы просматривать diff и фиксировать изменения.</span><button className="button-primary" onClick={onInitialize}><GitBranch size={14} /> Инициализировать Git</button><small>Работает только внутри папки этого проекта. На удалённый сервер ничего не отправляется.</small></div></div>

  const diffLines = diff.replace(/\n$/, '').split('\n')
  return <div className="git-view">
    <div className="git-sidebar">
      <div className="git-head"><span>SOURCE CONTROL</span><button className="icon-button tiny" title="Обновить состояние" onClick={onRefresh}><RefreshCw size={13} /></button></div>
      <div className="git-branch-card"><span className="git-branch-icon"><GitBranch size={15} /></span><span><strong>{status.branch || 'main'}</strong><small>локальная ветка</small></span></div>
      <div className="changes-head"><div><ChevronDown size={13} /><span>Изменения</span><span className="git-count">{changes.length}</span></div></div>
      <div className="change-list">{changes.map(file => <div className={`change-file${selected === file.path ? ' is-selected' : ''}`} key={file.path}>
        <button className={`stage-box${file.staged ? ' is-checked' : ''}`} onClick={() => onToggleStaged(file.path)} aria-label={file.staged ? 'Убрать из stage' : 'Добавить в stage'}>{file.staged && <Check size={11} />}</button>
        <button className="change-file-name" onClick={() => setSelected(file.path)}><TerminalSquare size={14} /><span>{file.path}</span></button>
        <span className={`change-kind change-kind--${file.kind.toLowerCase()}`}>{file.kind}</span>
      </div>)}{changes.length === 0 && <div className="git-no-changes"><Check size={14} /> Рабочая папка чистая</div>}</div>
      <div className="staged-head"><div><ChevronDown size={13} /><span>В индексе</span><span className="git-count">{stagedCount}</span></div></div>
      <div className="git-spacer" />
      <div className="git-commit-box"><label htmlFor="commit-message">Сообщение коммита</label><textarea id="commit-message" rows={2} maxLength={256} value={commitMessage} onChange={event => setCommitMessage(event.target.value)} placeholder="Что изменилось?"/><button disabled={!stagedCount || !commitMessage.trim()} onClick={commit}><GitCommitHorizontal size={15} />Создать локальный коммит<span>↵</span></button><small>{stagedCount ? `${stagedCount} staged` : 'Сначала добавьте файлы в индекс'}</small></div>
    </div>
    <div className="diff-panel">
      <div className="diff-toolbar"><div className="diff-file-title"><GitPullRequest size={15} /><strong>{selected || 'Diff'}</strong>{selected && <span className={`change-kind change-kind--${(changes.find(file => file.path === selected)?.kind ?? 'M').toLowerCase()}`}>{changes.find(file => file.path === selected)?.kind ?? 'M'}</span>}</div><div className="diff-actions"><button className="icon-button" title="Открыть файл" disabled={!selected} onClick={() => selected && onOpenFile(selected)}><RotateCcw size={14} /></button></div></div>
      <div className="diff-subheader"><span>{selected || 'Изменения появятся здесь'}</span><span>{diffLoading ? 'Загружаем…' : status.initialized ? status.branch : ''}</span></div>
      {error && <div className="file-error" role="alert">{error}</div>}
      <div className="diff-code">{diffLoading ? <div className="git-no-changes">Загружаем diff…</div> : diffLines.filter((line, index) => line || index < diffLines.length - 1).map((line, index) => {
        const added = line.startsWith('+') && !line.startsWith('+++')
        const removed = line.startsWith('-') && !line.startsWith('---')
        const hunk = line.startsWith('@@')
        return <div className={`diff-line${added ? ' diff-line--added' : removed ? ' diff-line--removed' : hunk ? ' diff-line--hunk' : ''}`} key={`${index}-${line}`}><span className="diff-line-number">{index + 1}</span><span className="diff-sign">{added ? '+' : removed ? '−' : ' '}</span><code>{line}</code></div>
      })}{!diffLoading && !diff && <div className="git-no-changes">{changes.length ? 'Для этого файла нет текстового diff.' : 'Нет локальных изменений.'}</div>}</div>
      <div className="diff-footer"><span><GitPullRequest size={13} /> Локальный репозиторий · без push</span>{selected && <button onClick={() => onToggleStaged(selected)}><Check size={13} />{changes.find(file => file.path === selected)?.staged ? 'Убрать из индекса' : 'Добавить в индекс'}</button>}</div>
    </div>
  </div>
}
