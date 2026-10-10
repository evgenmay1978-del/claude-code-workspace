import { useEffect, useRef, useState } from 'react'
import { Circle, GitBranch, Play, Plus, SquareTerminal, ChevronDown } from 'lucide-react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { Project } from '../types'
import { api } from '../lib/api'

export function TerminalView({ project, terminalId, onTerminalIdChange }: { project: Project; terminalId: string | null; onTerminalIdChange: (id: string | null) => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const currentId = useRef<string | null>(terminalId)
  const [status, setStatus] = useState('Подключаем shell…')
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let disposed = false
    currentId.current = terminalId
    let terminal: Terminal | null = null
    let fit: FitAddon | null = null
    let observer: ResizeObserver | null = null
    let socket: WebSocket | null = null
    let inputDisposable: { dispose: () => void } | undefined

    const connect = async () => {
      try {
        let id = currentId.current
        if (!id) {
          const sessions = await api.listTerminals(project.id)
          id = sessions[0]?.id ?? (await api.createTerminal(project.id)).id
          currentId.current = id
          onTerminalIdChange(id)
        }
        if (disposed || !hostRef.current) return

        terminal = new Terminal({
          cursorBlink: true,
          scrollback: 3000,
          fontSize: 13,
          fontFamily: 'IBM Plex Mono, SFMono-Regular, Consolas, monospace',
          theme: { background: '#071522', foreground: '#d9e6ef', cursor: '#ff8066', selectionBackground: '#294a63', black: '#0a1b2a', red: '#ff8e84', green: '#7bd8ad', yellow: '#e9c37e', blue: '#8faeff', magenta: '#eab2ff', cyan: '#77d4dd', white: '#e6edf4' },
        })
        fit = new FitAddon()
        terminal.loadAddon(fit)
        terminal.open(hostRef.current)
        terminalRef.current = terminal
        fit.fit()
        terminal.write('\x1b[38;2;255;128;102mPolar Workspace · server shell\x1b[0m\r\nRun `claude` to complete official subscription login, then use the CLI here.\r\n\r\n')

        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        socket = new WebSocket(`${wsProtocol}//${window.location.host}/ws/terminal/${id}`)
        socketRef.current = socket
        socket.onopen = () => { if (!disposed) { setStatus('Shell подключён'); fit?.fit() } }
        socket.onmessage = event => {
          if (!terminal) return
          try {
            const message = JSON.parse(String(event.data)) as { type: string; data?: string; code?: number }
            if (message.type === 'output' && typeof message.data === 'string') terminal.write(message.data)
            if (message.type === 'exit') { setStatus('Shell завершён'); terminal.write(`\r\n\r\n[Shell exited: ${message.code ?? 'unknown'}]\r\n`) }
          } catch { /* Ignore malformed server frames. */ }
        }
        socket.onerror = () => { if (!disposed) setStatus('Не удалось подключить WebSocket') }
        socket.onclose = () => { if (!disposed) setStatus('Shell отключён') }
        inputDisposable = terminal.onData(data => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data })) })
        observer = new ResizeObserver(() => {
          if (!fit || !terminal || !socket || socket.readyState !== WebSocket.OPEN) return
          fit.fit()
          socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
        })
        observer.observe(hostRef.current)
      } catch (cause) {
        if (!disposed) {
          setStatus(cause instanceof Error ? cause.message : 'Не удалось запустить shell')
          if (hostRef.current) hostRef.current.innerHTML = '<p class="terminal-error">Не удалось создать терминал. Проверьте сервер и права доступа к проекту.</p>'
        }
      }
    }
    void connect()
    return () => {
      disposed = true
      observer?.disconnect()
      inputDisposable?.dispose()
      socket?.close()
      terminal?.dispose()
      if (socketRef.current === socket) socketRef.current = null
      if (terminalRef.current === terminal) terminalRef.current = null
    }
  }, [project.id, terminalId, generation, onTerminalIdChange])

  const newTerminal = async () => {
    const old = currentId.current
    currentId.current = null
    onTerminalIdChange(null)
    if (old) await api.closeTerminal(old).catch(() => undefined)
    setGeneration(value => value + 1)
  }

  const sendCommand = (command: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: 'input', data: `${command}\r` }))
  }

  return <div className="terminal-view terminal-view--live">
    <div className="panel-toolbar"><div className="terminal-tabs"><button className="terminal-tab is-active"><span className="terminal-status-dot" />bash · {project.name}</button><button className="add-terminal" onClick={() => { void newTerminal() }} aria-label="Новый терминал"><Plus size={14} /></button></div><div className="toolbar-actions"><span className="execution-label"><span className="execution-dot" />{status}</span><button className="icon-button" title="Новый терминал" onClick={() => { void newTerminal() }}><Plus size={15} /></button></div></div>
    <div className="terminal-main terminal-main--live"><div className="terminal-info"><div className="terminal-info-icon"><SquareTerminal size={17} /></div><div><strong>Shell проекта</strong><span>Настоящий терминал в изолированной папке проекта на вашем сервере</span></div><span className="terminal-branch"><GitBranch size={12} />{project.branch}</span></div><div className="terminal-screen terminal-screen--live"><div className="terminal-topline"><span className="terminal-signal signal-red" /><span className="terminal-signal signal-yellow" /><span className="terminal-signal signal-green" /><span className="terminal-screen-path">~/workspace/{project.name}</span><span className="terminal-live-status">{status}</span></div><div className="terminal-xterm" ref={hostRef} /></div><div className="terminal-quick"><span>Быстрые команды</span><button onClick={() => sendCommand('claude')}><Play size={11} />claude</button><button onClick={() => sendCommand('git status')}><Play size={11} />git status</button></div></div>
    <div className="terminal-bottom"><span><Circle size={8} /> {status}</span><span>bash <ChevronDown size={12} /></span><span>UTF-8</span></div>
  </div>
}
