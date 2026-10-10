import { useEffect, useState } from 'react'
import { ArrowUpRight, Check, KeyRound, LockKeyhole, LogOut, Server, ShieldCheck, TerminalSquare, X } from 'lucide-react'
import type { CliStatus } from '../lib/api'
import { api } from '../lib/api'

export function SettingsModal({ onClose, onLogout, username, cliStatus }: { onClose: () => void; onLogout: () => void; username: string; cliStatus: CliStatus | null }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const logout = async () => {
    setBusy(true); setError('')
    try { await api.logout(); onLogout() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось завершить сеанс.') }
    finally { setBusy(false) }
  }
  const connection = !cliStatus?.installed ? 'CLI не установлен' : cliStatus.enabled ? cliStatus.loginFilePresent ? 'Официальный CLI вошёл' : 'Нужен вход в CLI' : 'CLI включается после установки'
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal-topline"><span className="modal-icon"><ShieldCheck size={17} /></span><button className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={17} /></button></div>
      <span className="modal-kicker">ПРОФИЛЬ / ПОДКЛЮЧЕНИЕ</span><h2 id="settings-title">Рабочее место<br /><span>под вашим контролем.</span></h2>
      <p className="modal-lead">Владелец <strong>{username}</strong>. Polar — self-hosted веб-интерфейс и запускает официальный Claude Code CLI на вашем сервере.</p>
      <div className="security-list">
        <div className="security-row"><span className="security-row-icon"><Server size={15} /></span><span><strong>Личный сервер</strong><small>История чатов и файлы проектов хранятся в каталоге данных сервера.</small></span><Check size={15} className="security-check" /></div>
        <div className="security-row"><span className="security-row-icon"><KeyRound size={15} /></span><span><strong>Вход в Claude Code</strong><small>Выполняется владельцем на сервере через предусмотренный Anthropic CLI-процесс.</small></span><span className={`connection-pill${cliStatus?.loginFilePresent ? ' is-online' : ''}`}>{connection}</span></div>
        <div className="security-row"><span className="security-row-icon"><LockKeyhole size={15} /></span><span><strong>Без API-ключей и прокси</strong><small>Сервис не запрашивает Anthropic API key, не копирует OAuth-токены и не обещает обход ограничений.</small></span><Check size={15} className="security-check" /></div>
      </div>
      <div className="prototype-callout"><span className="prototype-indicator"><TerminalSquare size={13} /></span><p><strong>План Claude зависит от аккаунта Anthropic.</strong><br />После установки откройте Shell и завершите официальный вход в Claude Code. Не делитесь доступом к личной подписке.</p></div>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <div className="modal-actions"><button className="button-secondary" onClick={onClose}>Закрыть</button><button className="button-quiet-link" onClick={() => window.open('https://docs.anthropic.com/en/docs/claude-code/authentication', '_blank', 'noopener,noreferrer')}>Вход и документация <ArrowUpRight size={14} /></button></div>
      <button className="settings-logout" onClick={() => { void logout() }} disabled={busy}><LogOut size={14} />{busy ? 'Выходим…' : 'Выйти из Polar'}</button>
      <div className="modal-privacy"><LockKeyhole size={11} />Polar не имеет доступа к веб-cookie Claude.ai</div>
    </section>
  </div>
}
