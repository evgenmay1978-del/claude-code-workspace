import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn as spawnPty, type IPty } from 'node-pty'
import type { RawData, WebSocket } from 'ws'
import type { AppDatabase } from '../db.js'
import { workspacesDirectory } from '../db.js'
import { cliConfigDirectory } from '../claude/runner.js'
import { isAllowedProjectRoot } from '../workspaces/host-paths.js'

type ProjectRow = { id: string; workspace_path: string }
type TerminalRecord = { id: string; ownerId: string; projectId: string; process: IPty; clients: Set<WebSocket>; history: string; createdAt: number; lastActivity: number; dispose: () => void }
type ClientMessage = { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number } | { type: 'close' }

const MAX_INPUT_CHARS = 8192
const MAX_HISTORY_CHARS = 100_000
const SESSION_IDLE_MS = 30 * 60 * 1000

function safeEnvironment(): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/app/node_modules/.bin:/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.CLAUDE_HOME ?? process.env.HOME ?? '/home/polar',
    LANG: process.env.LANG ?? 'C.UTF-8',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    CLAUDE_CONFIG_DIR: cliConfigDirectory(),
  }
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR
  if (process.env.LC_ALL) env.LC_ALL = process.env.LC_ALL
  return env
}

function rawText(raw: RawData): string {
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  return Buffer.isBuffer(raw) ? raw.toString('utf8') : Buffer.from(raw).toString('utf8')
}

export class TerminalManager {
  private readonly sessions = new Map<string, TerminalRecord>()
  constructor(private readonly db: AppDatabase) {}

  create(projectId: string, ownerId: string): TerminalRecord {
    this.expireIdle()
    const project = this.db.prepare('SELECT id,workspace_path FROM projects WHERE id=?').get(projectId) as ProjectRow | undefined
    if (!project) throw new Error('project_not_found')
    const cwd = resolve(project.workspace_path || workspacesDirectory)
    if (!isAllowedProjectRoot(cwd)) throw new Error('invalid_workspace_path')
    if (!statSync(cwd).isDirectory()) throw new Error('invalid_workspace_path')

    const id = randomUUID()
    const shell = process.env.WORKSPACE_SHELL ?? '/bin/bash'
    const ptyProcess = spawnPty(shell, ['-l'], {
      name: 'xterm-256color', cols: 100, rows: 30, cwd,
      env: safeEnvironment(), encoding: 'utf8',
      handleFlowControl: true, useConpty: false,
    })
    const record: TerminalRecord = { id, ownerId, projectId, process: ptyProcess, clients: new Set(), history: '', createdAt: Date.now(), lastActivity: Date.now(), dispose: () => {} }
    const output = ptyProcess.onData(data => {
      record.lastActivity = Date.now()
      record.history = `${record.history}${data}`.slice(-MAX_HISTORY_CHARS)
      for (const client of record.clients) if (client.readyState === 1 && client.bufferedAmount < 1_000_000) client.send(JSON.stringify({ type: 'output', data }))
    })
    ptyProcess.onExit(({ exitCode }) => {
      for (const client of record.clients) if (client.readyState === 1) client.send(JSON.stringify({ type: 'exit', code: exitCode }))
      this.sessions.delete(id)
    })
    record.dispose = () => output.dispose()
    this.sessions.set(id, record)
    return record
  }

  list(ownerId: string, projectId: string): { id: string; projectId: string; createdAt: number }[] {
    this.expireIdle()
    return [...this.sessions.values()].filter(session => session.ownerId === ownerId && session.projectId === projectId).map(({ id, projectId: currentProjectId, createdAt }) => ({ id, projectId: currentProjectId, createdAt }))
  }

  owns(id: string, ownerId: string): boolean { return this.sessions.get(id)?.ownerId === ownerId }

  attach(id: string, ownerId: string, socket: WebSocket): boolean {
    const record = this.sessions.get(id)
    if (!record || record.ownerId !== ownerId) return false
    record.lastActivity = Date.now()
    record.clients.add(socket)
    if (record.history && socket.readyState === 1) socket.send(JSON.stringify({ type: 'output', data: record.history }))
    if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'connected', id: record.id, projectId: record.projectId }))
    socket.on('message', raw => {
      const text = rawText(raw)
      if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_CHARS) return
      let message: ClientMessage
      try { message = JSON.parse(text) as ClientMessage } catch { return }
      record.lastActivity = Date.now()
      if (message.type === 'input' && typeof message.data === 'string' && message.data.length <= MAX_INPUT_CHARS) record.process.write(message.data)
      if (message.type === 'resize' && Number.isInteger(message.cols) && Number.isInteger(message.rows)) {
        const cols = Math.max(20, Math.min(240, message.cols))
        const rows = Math.max(5, Math.min(100, message.rows))
        record.process.resize(cols, rows)
      }
      if (message.type === 'close') this.close(id, ownerId)
    })
    socket.on('close', () => record.clients.delete(socket))
    socket.on('error', () => record.clients.delete(socket))
    return true
  }

  close(id: string, ownerId: string): boolean {
    const record = this.sessions.get(id)
    if (!record || record.ownerId !== ownerId) return false
    record.dispose()
    for (const client of record.clients) if (client.readyState === 1) { client.send(JSON.stringify({ type: 'closed' })); client.close(1000, 'terminal closed') }
    record.process.kill()
    this.sessions.delete(id)
    return true
  }

  shutdown(): void {
    for (const record of this.sessions.values()) {
      record.dispose()
      for (const client of record.clients) if (client.readyState === 1) client.close(1001, 'server shutdown')
      try { record.process.kill() } catch { /* already exited */ }
    }
    this.sessions.clear()
  }

  private expireIdle(): void {
    const cutoff = Date.now() - SESSION_IDLE_MS
    for (const record of this.sessions.values()) if (record.clients.size === 0 && record.lastActivity < cutoff) this.close(record.id, record.ownerId)
  }
}
