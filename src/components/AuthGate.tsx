import { useState } from 'react'
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck, TerminalSquare, X } from 'lucide-react'
import { api } from '../lib/api'

export function AuthGate({ initialized, onSuccess }: { initialized: boolean; onSuccess: (username: string) => void }) {
  const [username, setUsername] = useState('owner')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (!initialized && password !== confirmPassword) { setError('Пароли не совпадают.'); return }
    setBusy(true)
    try {
      const result = initialized ? await api.login(username, password) : await api.setup(username, password)
      onSuccess(result.username)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось войти. Повторите попытку.')
    } finally { setBusy(false) }
  }

  return <main className="auth-stage">
    <div className="auth-atmosphere" aria-hidden="true"><i /><i /><i /></div>
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-brand"><span className="auth-brand-mark"><span className="brand-mark"><span /><span /><i /></span></span><span><strong>POLAR WORKSPACE</strong><small>WEB · CLAUDE CODE CLI</small></span><span className="auth-version">PRIVATE</span></div>
      <div className="auth-emblem"><div className="auth-emblem-ring" /><span className="brand-mark"><span /><span /><i /></span></div>
      <span className="auth-eyebrow">{initialized ? 'ЗАЩИЩЁННОЕ ПРОСТРАНСТВО' : 'ПЕРВЫЙ ЗАПУСК'}</span>
      <h1 id="auth-title">{initialized ? <>Продолжим<br /><em>с вашего проекта.</em></> : <>Ваш код.<br /><em>Ваше окружение.</em></>}</h1>
      <p className="auth-lead">{initialized ? 'Войдите в личное рабочее пространство Polar.' : 'Создайте единственный аккаунт владельца. Регистрация других пользователей закрыта.'}</p>
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="owner-name">Имя владельца</label>
        <input id="owner-name" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" maxLength={32} required />
        <label htmlFor="owner-password">Пароль</label>
        <div className="auth-password-wrap"><input id="owner-password" type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete={initialized ? 'current-password' : 'new-password'} minLength={initialized ? 1 : 12} maxLength={256} required /><button type="button" aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div>
        {!initialized && <><label htmlFor="owner-confirm">Повторите пароль</label><div className="auth-password-wrap"><input id="owner-confirm" type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={256} required /><LockKeyhole size={14} /></div><small className="auth-field-note">Не короче 12 символов. Запишите пароль: восстановление здесь не включено.</small></>}
        {error && <div className="auth-error" role="alert"><X size={14} />{error}</div>}
        <button type="submit" className="auth-submit" disabled={busy || (!initialized && password.length < 12)}>{busy ? 'Подготавливаем workspace…' : initialized ? 'Войти в workspace' : 'Создать workspace'}<ArrowRight size={16} /></button>
      </form>
      <div className="auth-divider" />
      <div className="auth-security"><span><ShieldCheck size={15} /></span><p><strong>Ваш вход обрабатывает Claude Code CLI</strong><small>Подписку подключите через официальный CLI на своём сервере. Polar не принимает OAuth-токены и API-ключи.</small></p></div>
      <div className="auth-footer"><span><TerminalSquare size={12} /> Локальный владелец · закрытая регистрация</span><a href="https://docs.anthropic.com/en/docs/claude-code/authentication" target="_blank" rel="noreferrer">Как войти в Claude Code</a></div>
    </section>
    <div className="auth-footer-note">POLAR WORKSPACE <span>·</span> ПРИВАТНАЯ WEB-СРЕДА</div>
  </main>
}
