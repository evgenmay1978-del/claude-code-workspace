import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'

export function AuthGate({ initialized, onSuccess }: { initialized: boolean; onSuccess: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const name = username.trim()
    if (name.length < 3) { setError('Логин не короче 3 символов.'); return }
    if (password.length < 8) { setError('Пароль не короче 8 символов.'); return }
    if (!initialized && password !== confirm) { setError('Пароли не совпадают.'); return }
    setBusy(true)
    setError('')
    try {
      if (initialized) await api.login(name, password)
      else await api.setup(name, password)
      onSuccess()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось войти.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-stage">
    <form className="auth-card" onSubmit={submit}>
      <span className="brand-mark"><span /><span /><i /></span>
      <span className="modal-kicker">POLAR WORKSPACE</span>
      <h1>{initialized ? 'Вход владельца.' : 'Первичная настройка.'}</h1>
      <p>{initialized
        ? 'Один владелец и одна защищённая сессия. Чаты, файлы и Claude Code CLI живут на вашем сервере.'
        : 'Создайте единственного владельца рабочего пространства. Пароль сохраняется только как scrypt-хэш, в открытом виде — нигде.'}</p>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <label htmlFor="auth-username">Логин</label>
      <input id="auth-username" autoFocus autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} placeholder="owner" maxLength={64} />
      <label htmlFor="auth-password">Пароль</label>
      <input id="auth-password" type="password" autoComplete={initialized ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="Минимум 8 символов" />
      {!initialized && <>
        <label htmlFor="auth-confirm">Повторите пароль</label>
        <input id="auth-confirm" type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} placeholder="Ещё раз" />
      </>}
      <button className="button-primary" type="submit" disabled={busy}>
        {busy ? <Loader2 size={15} className="spin" /> : <ArrowRight size={15} />}
        {initialized ? 'Войти' : 'Создать владельца'}
      </button>
      <small className="auth-note"><ShieldCheck size={12} /> Данные не покидают ваш сервер: приложение работает только с локальным Claude Code CLI.</small>
    </form>
  </main>
}
