import { randomUUID } from 'node:crypto'
import { Router, type Response } from 'express'
import { z } from 'zod'
import type { AppDatabase } from '../db.js'
import { workspacesDirectory } from '../db.js'
import { requireCsrf } from '../auth/router.js'
import { getCliStatus, spawnClaude } from '../claude/runner.js'
import { listWorkspaceFiles } from '../workspaces/files.js'

const chatRequest = z.object({
  projectId: z.string().uuid(),
  sessionId: z.string().uuid(),
  content: z.string().trim().min(1).max(60_000),
  model: z.enum(['sonnet', 'opus', 'haiku']).default('sonnet'),
  webSearch: z.boolean().default(false),
  contextFiles: z.array(z.string().min(1).max(1024)).max(32).default([]),
}).strict()

type ProjectRow = { id: string; name: string; instructions: string; workspace_path: string }
type SessionRow = { id: string; project_id: string; title: string; model: string; agent_session_id: string | null; status: string }

function sendEvent(res: Response, event: string, data: unknown) {
  if (res.writableEnded) return
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function titleFromPrompt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, ' ').trim()
  return cleaned.length > 48 ? `${cleaned.slice(0, 47)}…` : cleaned
}

export function createClaudeRouter(db: AppDatabase): Router {
  const router = Router()

  router.get('/status', (_req, res) => {
    const status = getCliStatus()
    res.json({ ...status, webSearchAvailable: status.installed })
  })

  router.get('/search', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : ''
    if (query.length < 2) return res.json({ results: [] })
    type SearchRow = { id: string; role: 'user' | 'assistant'; content_json: string; created_at: number; session_id: string; session_title: string; project_id: string; project_name: string }
    const rows = db.prepare(`SELECT m.id,m.role,m.content_json,m.created_at,c.id AS session_id,c.title AS session_title,p.id AS project_id,p.name AS project_name
      FROM messages m JOIN conversations c ON c.id=m.conversation_id JOIN projects p ON p.id=c.project_id
      WHERE c.archived_at IS NULL AND instr(lower(m.content_json),lower(?))>0
      ORDER BY m.created_at DESC LIMIT 50`).all(query) as SearchRow[]
    const results = rows.map(row => {
      let text = ''
      try {
        const value = JSON.parse(row.content_json) as unknown
        if (typeof value === 'string') text = value
        else if (Array.isArray(value)) text = value.map(block => block && typeof block === 'object' && 'text' in block && typeof block.text === 'string' ? block.text : '').filter(Boolean).join('\n')
      } catch { text = row.content_json }
      const position = text.toLowerCase().indexOf(query.toLowerCase())
      const start = Math.max(0, position - 55)
      const end = Math.min(text.length, start + 170)
      const snippet = `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
      return { id: row.id, role: row.role, snippet, createdAt: row.created_at, projectId: row.project_id, projectName: row.project_name, sessionId: row.session_id, sessionTitle: row.session_title }
    })
    res.json({ results })
  })

  router.post('/stream', requireCsrf, (req, res) => {
    const parsed = chatRequest.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_chat_request', message: 'Проверьте проект, сессию и текст сообщения.' })

    const status = getCliStatus()
    if (!status.enabled) return res.status(503).json({ error: 'cli_disabled', message: 'Веб-Preview не запускает Claude Code. Подключение доступно после установки на вашем сервере.' })
    if (!status.installed) return res.status(503).json({ error: 'cli_missing', message: 'Официальный Claude Code CLI не установлен на сервере.' })
    if (!status.loginFilePresent) return res.status(409).json({ error: 'cli_login_required', message: 'Сначала выполните официальный вход в Claude Code в терминале сервера.' })

    const input = parsed.data
    const project = db.prepare('SELECT id,name,instructions,workspace_path FROM projects WHERE id=?').get(input.projectId) as ProjectRow | undefined
    if (!project) return res.status(404).json({ error: 'project_not_found', message: 'Проект не найден.' })
    const session = db.prepare('SELECT id,project_id,title,model,agent_session_id,status FROM conversations WHERE id=? AND project_id=? AND archived_at IS NULL').get(input.sessionId, project.id) as SessionRow | undefined
    if (!session) return res.status(404).json({ error: 'session_not_found', message: 'Чат не найден или архивирован.' })
    const availableFiles = new Set(listWorkspaceFiles(project.workspace_path).filter(file => file.kind === 'file').map(file => file.path))
    if (input.contextFiles.some(path => !availableFiles.has(path))) return res.status(400).json({ error: 'invalid_context_file', message: 'Один из выбранных файлов больше не доступен в папке проекта.' })
    const prompt = input.contextFiles.length
      ? `${input.content}\n\nThe owner explicitly selected these workspace files as relevant context. Read them before answering:\n${input.contextFiles.map(path => `@${path}`).join('\n')}`
      : input.content

    const now = Date.now()
    const userMessageId = randomUUID()
    const cliSessionId = session.agent_session_id ?? randomUUID()
    const firstUserMessage = (db.prepare('SELECT COUNT(*) AS count FROM messages WHERE conversation_id=?').get(session.id) as { count: number }).count === 0
    db.prepare('INSERT INTO messages(id,conversation_id,role,content_json,model,created_at) VALUES(?,?,?,?,?,?)').run(userMessageId, session.id, 'user', JSON.stringify(input.content), input.model, now)
    db.prepare('UPDATE conversations SET model=?, agent_session_id=?, status=?, title=CASE WHEN ?=1 AND title IN (\'Новая сессия\',\'Первая сессия\') THEN ? ELSE title END, updated_at=? WHERE id=?').run(input.model, cliSessionId, 'working', firstUserMessage ? 1 : 0, titleFromPrompt(input.content), now, session.id)

    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()
    sendEvent(res, 'started', { userMessageId, sessionId: session.id, cliSessionId, model: input.model })

    let child: ReturnType<typeof spawnClaude>
    try {
      child = spawnClaude({ prompt, cwd: project.workspace_path || workspacesDirectory, model: input.model, sessionId: cliSessionId, resume: Boolean(session.agent_session_id), webSearch: input.webSearch, instructions: project.instructions })
    } catch {
      db.prepare('UPDATE conversations SET status=?, updated_at=? WHERE id=?').run('error', Date.now(), session.id)
      sendEvent(res, 'error', { code: 'cli_start_failed', message: 'Не удалось запустить Claude Code CLI.' })
      return res.end()
    }

    let buffer = ''
    let assistantText = ''
    let stderr = ''
    let actualSessionId = cliSessionId
    let inputTokens = 0
    let outputTokens = 0
    let finished = false
    let disconnected = false

    const saveAssistant = (exitCode: number | null) => {
      if (finished) return
      finished = true
      const endedAt = Date.now()
      if (assistantText.trim()) {
        db.prepare('INSERT INTO messages(id,conversation_id,role,content_json,model,input_tokens,output_tokens,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), session.id, 'assistant', JSON.stringify([{ type: 'text', text: assistantText }]), input.model, inputTokens, outputTokens, endedAt)
      }
      if (inputTokens > 0 || outputTokens > 0) db.prepare('INSERT INTO usage_events(id,conversation_id,model,input_tokens,output_tokens,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(), session.id, input.model, inputTokens, outputTokens, endedAt)
      const succeeded = exitCode === 0 && !disconnected
      db.prepare('UPDATE conversations SET status=?, agent_session_id=?, updated_at=? WHERE id=?').run(succeeded ? 'done' : disconnected ? 'idle' : 'error', actualSessionId, endedAt, session.id)
      if (disconnected) return
      if (succeeded) sendEvent(res, 'done', { sessionId: session.id, cliSessionId: actualSessionId, inputTokens, outputTokens })
      else sendEvent(res, 'error', { code: 'cli_run_failed', message: stderr.trim().slice(-1200) || 'Claude Code завершил запрос с ошибкой.' })
      res.end()
    }

    const processLine = (line: string) => {
      if (!line.trim()) return
      let item: Record<string, unknown>
      try { item = JSON.parse(line) as Record<string, unknown> } catch { return }
      if (typeof item.session_id === 'string') actualSessionId = item.session_id
      if (item.type === 'stream_event') {
        const event = item.event as { delta?: { type?: string; text?: string } } | undefined
        if (event?.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
          assistantText += event.delta.text
          sendEvent(res, 'delta', { text: event.delta.text })
        }
      }
      if (item.type === 'assistant') {
        const message = item.message as { content?: unknown } | undefined
        for (const block of Array.isArray(message?.content) ? message.content : []) {
          const type = (block as { type?: string }).type
          if (type === 'tool_use') {
            const name = (block as { name?: string }).name
            if (typeof name === 'string') sendEvent(res, 'activity', { tool: name })
          }
        }
      }
      if (item.type === 'result') {
        if (typeof item.session_id === 'string') actualSessionId = item.session_id
        const usage = item.usage as { input_tokens?: number; output_tokens?: number } | undefined
        if (typeof usage?.input_tokens === 'number') inputTokens = usage.input_tokens
        if (typeof usage?.output_tokens === 'number') outputTokens = usage.output_tokens
        const resultText = typeof item.result === 'string' ? item.result : ''
        const isError = item.is_error === true
        if (isError && resultText) sendEvent(res, 'error', { code: 'cli_result_error', message: resultText.slice(0, 1200) })
      }
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) processLine(line)
    })
    child.stderr.on('data', (chunk: string) => { if (stderr.length < 8000) stderr += chunk.slice(0, 8000 - stderr.length) })
    child.on('error', () => {
      db.prepare('UPDATE conversations SET status=?, updated_at=? WHERE id=?').run('error', Date.now(), session.id)
      if (!res.writableEnded) { sendEvent(res, 'error', { code: 'cli_spawn_error', message: 'Не удалось запустить локальный Claude Code CLI.' }); res.end() }
      finished = true
    })
    child.on('close', (code: number | null) => {
      if (buffer.trim()) processLine(buffer)
      saveAssistant(code)
    })
    res.on('close', () => {
      if (!finished) {
        disconnected = true
        child.kill('SIGTERM')
        const timeout = setTimeout(() => child.kill('SIGKILL'), 2500)
        timeout.unref()
      }
    })
  })

  router.get('/sessions/:sessionId/messages', (req, res) => {
    const session = db.prepare('SELECT id FROM conversations WHERE id=? AND archived_at IS NULL').get(req.params.sessionId)
    if (!session) return res.status(404).json({ error: 'session_not_found' })
    const rows = db.prepare('SELECT id,role,content_json,model,input_tokens,output_tokens,created_at FROM messages WHERE conversation_id=? ORDER BY created_at,id').all(req.params.sessionId) as { id: string; role: 'user' | 'assistant' | 'system'; content_json: string; model: string; input_tokens: number; output_tokens: number; created_at: number }[]
    res.json({ messages: rows.map(row => ({ id: row.id, role: row.role, content: JSON.parse(row.content_json) as unknown, model: row.model, inputTokens: row.input_tokens, outputTokens: row.output_tokens, createdAt: row.created_at })) })
  })

  return router
}
