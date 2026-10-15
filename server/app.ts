import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAuthRouter, loadSession, requireAuth } from './auth/router.js'
import type { AppDatabase } from './db.js'
import { PermissionBroker } from './claude/permissions.js'
import { createAttachmentsRouter } from './routes/attachments.js'
import { createClaudeRouter } from './routes/claude.js'
import { createGitRouter } from './routes/git.js'
import { createProjectsRouter } from './routes/projects.js'
import { createTerminalRouter } from './routes/terminal.js'
import { TerminalManager } from './terminal/manager.js'

export function createApp(database: AppDatabase, terminalManager = new TerminalManager(database), permissions = new PermissionBroker()): Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    next()
  })
  app.use(express.json({ limit: '8mb' }))
  app.use(loadSession(database))

  // Внутренний маршрут для MCP-сервера подтверждений (запускается самим CLI внутри контейнера).
  // Принимает только loopback и только действующий одноразовый токен запуска; держит ответ до решения владельца.
  app.post('/_internal/claude/permission', (req, res) => {
    const remote = req.socket.remoteAddress ?? ''
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return res.status(403).json({ error: 'forbidden' })
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!permissions.isValidRun(token)) return res.status(403).json({ error: 'forbidden' })
    const body = (req.body ?? {}) as { tool_name?: unknown; input?: unknown }
    const tool = typeof body.tool_name === 'string' ? body.tool_name.slice(0, 200) : 'unknown'
    const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input as Record<string, unknown> : {}
    void permissions.request(token, tool, input).then(decision => { if (!res.writableEnded) res.json(decision) })
  })

  app.get('/_app/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'polar-workspace' }))
  app.use('/api/auth', createAuthRouter(database))
  app.use('/api/projects', requireAuth, createProjectsRouter(database))
  app.use('/api/projects', requireAuth, createAttachmentsRouter(database))
  app.use('/api/projects', requireAuth, createGitRouter(database))
  app.use('/api/claude', requireAuth, createClaudeRouter(database, permissions))
  app.use('/api/terminal', requireAuth, createTerminalRouter(database, terminalManager))
  app.use('/api', requireAuth, (_req, res) => res.status(404).json({ error: 'not_found' }))

  if (process.env.NODE_ENV !== 'development') {
    const webRoot = resolve(process.env.WEB_ROOT ?? 'dist')
    if (existsSync(resolve(webRoot, 'index.html'))) {
      app.use(express.static(webRoot, { index: false, fallthrough: true, maxAge: '1h' }))
      app.get(/.*/, (_req: Request, res: Response) => res.sendFile(resolve(webRoot, 'index.html')))
    }
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return
    if (error && typeof error === 'object' && 'status' in error && error.status === 413) return res.status(413).json({ error: 'attachment_too_large', message: 'Размер вложения превышает лимит 20 МБ.' })
    res.status(500).json({ error: 'internal_error', message: 'Внутренняя ошибка. Сессия и ключи сохранены.' })
  })
  return app
}
