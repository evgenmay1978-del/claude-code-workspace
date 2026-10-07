import { useEffect } from 'react'
import { ArrowUpRight, Check, KeyRound, LockKeyhole, Server, ShieldCheck, X } from 'lucide-react'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal-topline"><span className="modal-icon"><ShieldCheck size={17} /></span><button className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={17} /></button></div>
      <span className="modal-kicker">ПРОФИЛЬ / БЕЗОПАСНОСТЬ</span><h2 id="settings-title">Ваш код.<br /><span>Ваше окружение.</span></h2>
      <p className="modal-lead">Claude Code работает в вашем пользовательском окружении. Панель управляет рабочим пространством, а не забирает ваши учётные данные себе.</p>
      <div className="security-list">
        <div className="security-row"><span className="security-row-icon"><Server size={15} /></span><span><strong>Личный сервер</strong><small>Исходный код и процессы находятся в вашем workspace.</small></span><Check size={15} className="security-check" /></div>
        <div className="security-row"><span className="security-row-icon"><KeyRound size={15} /></span><span><strong>Официальный вход</strong><small>Авторизация Claude Code выполняется через предусмотренный Anthropic CLI-процесс.</small></span><Check size={15} className="security-check" /></div>
        <div className="security-row"><span className="security-row-icon"><LockKeyhole size={15} /></span><span><strong>Без стороннего прокси</strong><small>Нет обхода региональных ограничений или пересылки credentials посреднику.</small></span><Check size={15} className="security-check" /></div>
      </div>
      <div className="prototype-callout"><span className="prototype-indicator"><span /></span><p><strong>Сейчас открыт интерактивный прототип.</strong><br />Подключение к серверу и Claude Code появится отдельным, явно настраиваемым этапом.</p></div>
      <div className="modal-actions"><button className="button-secondary" onClick={onClose}>Понятно</button><button className="button-quiet-link" onClick={() => window.open('https://docs.anthropic.com/en/docs/claude-code/overview', '_blank', 'noopener,noreferrer')}>Документация Claude Code <ArrowUpRight size={14} /></button></div>
      <div className="modal-privacy"><LockKeyhole size={11} />Никакие секреты не запрашиваются в этом прототипе</div>
    </section>
  </div>
}
