import { useEffect, useState } from 'react'
import { ArrowUpRight, Check, ChevronDown, FileCode2, FileDiff, GitBranch, GitCommitHorizontal, GitPullRequest, MoreHorizontal, Plus, RefreshCw } from 'lucide-react'
import type { Project } from '../types'
import { api, type GitStatus } from '../lib/api'

const labelOf = (file: string) => file.split('/').slice(-2).join('/')

export function SourceControlView({ status, onRefresh, onInitialize, onToggleStaged, onCommit, onOpenFile, project }: {
  status: GitStatus | null
  onRefresh: () => void
  onInitialize: () => void
  onToggleStaged: (path: string) => void
  onCommit: (message: string) => void
  onOpenFile: (path: string) => void
  project: Project
}) {
  const changes = status && status.initialized ? status.changes : []
  const [selected, setSelected] = useState('')
  const [diff, setDiff] = useState({ staged: '', unstaged: '' })
  const [commitMessage, setCommitMessage] = useState('')

  useEffect(() => {
    if (!changes.length) { setSelected(''); return }
    if (!changes.some(change => change.path === selected)) setSelected(changes[0].path)
  }, [changes, selected])

  useEffect(() => {
    if (!selected) { setDiff({ staged: '', unstaged: '' }); return }
    let current = true
    api.gitDiff(project.id, selected)
      .then(result => { if (current) setDiff(result) })
      .catch(() => { if (current) setDiff({ staged: '', unstaged: '' }) })
    return () => { current = false }
  }, [project.id, selected, status])

  const stagedCount = changes.filter(change => change.staged).length
  const current = changes.find(change => change.path === selected)
  const added = (diff.unstaged || diff.staged || '').split('\n').filter(line => line.trim().length > 0)
  const removed = diff.staged ? diff.staged.split('\n').filter(line => line.trim().length > 0) : []

  if (!status || !status.initialized) return <div className="git-view git-view--empty">
    <div className="git-empty-state">
      <span className="git-empty-icon"><GitBranch size={20} /></span>
      <h2>Локальный Git ещё не создан</h2>
      <p>Инициализируйте репозиторий в папке проекта «{project.name}». Коммиты локальные, push не выполняется автоматически.</p>
      <button className="button-primary" onClick={onInitialize}>Инициализировать Git</button>
    </div>
  </div>

  const commit = () => {
    const message = commitMessage.trim()
    if (!message || !stagedCount) return
    onCommit(message)
    setCommitMessage('')
  }

  return <div className="git-view">
    <div className="git-sidebar">
      <div className="git-head"><span>SOURCE CONTROL</span><button className="icon-button tiny" title="Обновить" onClick={onRefresh}><RefreshCw size={13} /></button></div>
      <div className="git-branch-card"><span className="git-branch-icon"><GitBranch size={15} /></span><span><strong>{status.branch}</strong><small>локальная ветка проекта</small></span><ChevronDown size={13} /></div>
      <div className="changes-head"><button><ChevronDown size={13} /><span>Изменения</span><span className="git-count">{changes.length}</span></button><button className="icon-button tiny" title="Stage all" onClick={() => changes.filter(change => !change.staged).forEach(change => onToggleStaged(change.path))}><Plus size={13} /></button></div>
      <div className="change-list">{changes.map(change => <div className={'change-file' + (selected === change.path ? ' is-selected' : '')} key={change.path}>
        <button className={'stage-box' + (change.staged ? ' is-checked' : '')} onClick={() => onToggleStaged(change.path)} aria-label={change.staged ? 'Убрать из stage' : 'Добавить в stage'}>{change.staged && <Check size={11} />}</button>
        <button className="change-file-name" onClick={() => setSelected(change.path)}><FileCode2 size={14} /><span>{labelOf(change.path)}</span></button>
        <span className={'change-kind change-kind--' + change.kind.toLowerCase()}>{change.kind}</span>
        <button className="icon-button tiny change-more" aria-label="Открыть файл" onClick={() => onOpenFile(change.path)}><MoreHorizontal size={13} /></button>
      </div>)}</div>
      {!changes.length && <p className="git-no-changes">Нет изменений в рабочей папке.</p>}
      <div className="staged-head"><button><ChevronDown size={13} /><span>В индексе</span><span className="git-count">{stagedCount}</span></button></div>
      <div className="git-spacer" />
      <div className="git-commit-box">
        <label htmlFor="commit-message">Сообщение коммита</label>
        <textarea id="commit-message" rows={2} value={commitMessage} onChange={event => setCommitMessage(event.target.value)} placeholder="Например: подключить Claude Code CLI" />
        <button disabled={!stagedCount || !commitMessage.trim()} onClick={commit}><GitCommitHorizontal size={15} />Зафиксировать изменения<span>\u21B5</span></button>
        <small>{stagedCount ? stagedCount + ' файл(ов) в индексе' : 'Выберите файлы для коммита'}</small>
      </div>
    </div>
    <div className="diff-panel">
      <div className="diff-toolbar">
        <div className="diff-file-title"><FileDiff size={15} /><strong>{selected ? labelOf(selected) : 'Нет файла'}</strong>{current && <span className={'change-kind change-kind--' + current.kind.toLowerCase()}>{current.kind}</span>}</div>
        <div className="diff-actions">
          <button className="diff-option" onClick={onRefresh}><span>Обновить статус</span><ChevronDown size={12} /></button>
          <button className="icon-button" title="Открыть в редакторе" onClick={() => selected && onOpenFile(selected)}><ArrowUpRight size={15} /></button>
        </div>
      </div>
      <div className="diff-subheader"><span>{selected || 'изменения не выбраны'}</span><span><span className="diff-add">+{added.length}</span> <span className="diff-remove">-{removed.length}</span></span></div>
      <div className="diff-code">
        <div className="diff-hunk">@@ {selected || 'git diff'} @@</div>
        {added.map((line, index) => <div className="diff-line diff-line--added" key={'line-' + index}><span className="diff-line-number">{index + 1}</span><span className="diff-sign">+</span><code>{line}</code></div>)}
        {!added.length && <div className="diff-line diff-line--unchanged"><span className="diff-line-number">1</span><span className="diff-sign"> </span><code>Нет изменений для показа. Измените файл или выберите другой.</code></div>}
      </div>
      <div className="diff-footer">
        <span><GitPullRequest size={13} /> Просмотр только локальных изменений</span>
        <button onClick={() => selected && onToggleStaged(selected)}><Check size={13} />{current && current.staged ? 'В индексе' : 'Добавить в индекс'}</button>
      </div>
    </div>
  </div>
}
