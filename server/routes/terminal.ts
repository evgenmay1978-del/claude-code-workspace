import { Router } from 'express'
import { z } from 'zod'
import type { AppDatabase } from '../db.js'
import { requireCsrf } from '../auth/router.js'
import { TerminalManager } from '../terminal/manager.js'

const createSchema = z.object({ projectId: z.string().uuid() }).strict()

export function createTerminalRouter(db: AppDatabase, manager: TerminalManager): Router {
  const router = Router()
  router.get('/sessions', (req, res) => {
    const projectId = z.string().uuid().safeParse(req.query.projectId)
    if (!projectId.success) return res.status(400).json({ error: 'invalid_project_id' })
    const project = db.prepare('SELECT id FROM projects WHERE id=?').get(projectId.data)
    if (!project) return res.status(404).json({ error: 'project_not_found' })
    res.json({ sessions: manager.list(req.auth!.userId, projectId.data) })
  })
  router.post('/sessions', requireCsrf, (req, res) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_terminal_request' })
    try {
      const session = manager.create(parsed.data.projectId, req.auth!.userId)
      res.status(201).json({ session: { id: session.id, projectId: session.projectId, createdAt: session.createdAt } })
    } catch (error) {
      const code = error instanceof Error ? error.message : 'terminal_start_failed'
      return res.status(code === 'project_not_found' ? 404 : 400).json({ error: code })
    }
  })
  router.delete('/sessions/:id', requireCsrf, (req, res) => {
    const parsedId = z.string().uuid().safeParse(req.params.id)
    if (!parsedId.success) return res.status(400).json({ error: 'invalid_terminal_id' })
    if (!manager.close(parsedId.data, req.auth!.userId)) return res.status(404).json({ error: 'terminal_not_found' })
    res.status(204).end()
  })
  return router
}
