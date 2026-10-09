import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, KeyRound, Loader2, LockKeyhole, LogOut, Server, ShieldCheck, TerminalSquare, X } from 'lucide-react'
import { api, type CliStatus } from '../lib/api'

export function SettingsModal({ onClose, username, cliStatus, onLogout }: {
  onClose: () => void
  username: string
  cliStatus: CliStatus | null
  onLogout: () => void
}) {
  const [loginOutput, setLoginOutput] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [code, setCode] = useState('')
  const readerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => () => readerRef.current?.abort(), [])

  const startLogin = async () => {
    if (loginBusy) return
    setLoginBusy(true)
    setLoginOutput('')
    const controller = new AbortController()
    readerRef.current = controller
    try {
      const status = await api.authStatus()
      const response = await fetch('/api/claude/login', { method: 'POST', headers: { 'x-csrf-token': status.csrfToken ?? '' }, credentials: 'include', signal: controller.signal })
      if (!response.ok || !response.body) throw new Error('Не удалось запустить claude setup-token.')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const payload = JSON.parse(line) as { kind: string; text?: string; code?: number; message?: string }
            if (payload.text) setLoginOutput(current => current + payload.text)
            if (payload.message) setLoginOutput(current => current + payload.message + '\n')
            if (payload.kind === 'exit') setLoginOutput(current => current + '\n[процесс входа завершён: ' + (payload.code ?? '?') + ']\n')
          } catch { /* ignore */ }
        }
        if (done) break
      }
    } catch (cause) {
      setLoginOutput(current => current + '\n' + (cause instanceof Error ? cause.message : 'Ошибка входа.'))
    } finally {
      setLoginBusy(false)
      readerRef.current = null
      void api.cliStatus().catch(() => null)
    }
  }

  const sendCode = async () => {
    const text = code.trim()
    if (!text) return
    try {
      const status = await api.authStatus()
      const response = await fetch('/api/claude/login/input', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': status.csrfToken ?? '' }, credentials: 'include', body: JSON.stringify({ text }) })
      setLoginOutput(current => current + (response.ok ? '\n[код отправлен в CLI]\n' : '\n[не удалось отправить код]\n'))
      setCode('')
    } catch (cause) {
      setLoginOutput(current => current + '\n' + (cause instanceof Error ? cause.message : 'Ошибка отправки кода.'))
    }
  }

  const rows: { icon: typeof Server; title: string; note: string; ok: boolean }[] = [
    { icon: Server, title: 'Личный сервер', note: 'Исходники, чаты и процессы остаются в вашем workspace.', ok: true },
    { icon: TerminalSquare, title: 'Claude Code CLI', note: cliStatus ? (cliStatus.installed ? 'найден ' + (cliStatus.version || '') : 'не найден в PATH сервера') : 'статус неизвестен', ok: Boolean(cliStatus?.installed) },
    { icon: KeyRound, title: 'Официальный вход', note: cliStatus?.loginFilePresent ? 'подписочный вход выполнен' : 'вход не выполнен — запустите claude setup-token', ok: Boolean(cliStatus?.loginFilePresent) },
    { icon: LockKeyhole, title: 'Без стороннего прокси', note: 'Запросы идут прямо в официальный CLI, ключи не пересылаются посреднику.', ok: true },
  ]

  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal-topline"><span className="modal-icon"><ShieldCheck size={17} /></span><button className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={17} /></button></div>
      <span className="modal-kicker">ПРОФИЛЬ / БЕЗОПАСНОСТЬ</span>
      <h2 id="settings-title">Ваш код.<br /><span>Ваше окружение.</span></h2>
      <p className="modal-lead">Владелец: <strong>{username}</strong>. Панель управляет локальным workspace, а не забирает учётные данные Claude себе.</p>
      <div className="security-list">
        {rows.map(row => <div className="security-row" key={row.title}>
          <span className="security-row-icon"><row.icon size={15} /></span>
          <span><strong>{row.title}</strong><small>{row.note}</small></span>
          {row.ok ? <Check size={15} className="security-check" /> : <span className="security-missing">!</span>}
        </div>)}
      </div>
      <div className="claude-login">
        <div className="claude-login-head">
          <span><strong>Вход в Claude Code</strong><small>Официальный <code>claude setup-token</code>: ссылку открывает Anthropic, токен остаётся на сервере.</small></span>
          <button className="button-secondary" onClick={startLogin} disabled={loginBusy}>{loginBusy ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />}Начать вход</button>
        </div>
        {loginOutput && <pre className="claude-login-output">{loginOutput}</pre>}
        {loginOutput && <div className="claude-login-code">
          <input value={code} onChange={event => setCode(event.target.value)} placeholder="Код или токен из Claude, если CLI его запросил" />
          <button className="button-secondary" onClick={sendCode} disabled={!code.trim()}>Отправить</button>
        </div>}
      </div>
      <div className="modal-actions">
        <button className="button-secondary" onClick={onLogout}><LogOut size={14} />Выйти из аккаунта</button>
        <button className="button-quiet-link" onClick={() => window.open('https://docs.anthropic.com/en/docs/claude-code/overview', '_blank', 'noopener,noreferrer')}>Документация Claude Code <ArrowUpRight size={14} /></button>
      </div>
      <div className="modal-privacy"><LockKeyhole size={11} />Секреты Claude не запрашиваются в браузере: токен вводится только в официальном CLI на сервере</div>
    </section>
  </div>
}
