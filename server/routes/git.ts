import { Router } from 'express'
import { z } from 'zod'
import type { AppDatabase } from '../db.js'
import { requireCsrf } from '../auth/router.js'
import { commitStaged, getGitDiff, getGitStatus, initializeRepository, stagePath, unstagePath } from '../git/operations.js'

const pathSchema = z.object({ path: z.string().min(1).max(1024) }).strict()
const commitSchema = z.object({ message: z.string().trim().min(1).max(256) }).strict()

type ProjectRow = { workspace_path: string }
function projectRoot(db: AppDatabase, id: string): string | undefined {
  return (db.prepare('SELECT workspace_path FROM projects WHERE id=?').get(id) as ProjectRow | undefined)?.workspace_path
}

export function createGitRouter(db: AppDatabase): Router {
  const router = Router({ mergeParams: true })
  router.use((req, res, next) => req.method === 'GET' || req.method === 'HEAD' ? next() : requireCsrf(req, res, next))

  router.get('/:projectId/git/status', async (req, res) => {
    const root = projectRoot(db, req.params.projectId)
    if (!root) return res.status(404).json({ error: 'project_not_found' })
    try { return res.json(await getGitStatus(root)) }
    catch { return res.status(400).json({ error: 'git_status_failed', message: 'Не удалось прочитать состояние Git в этом проекте.' }) }
  })

  router.post('/:projectId/git/init', async (req, res) => {
    const root = projectRoot(db, req.params.projectId)
    if (!root) return res.status(404).json({ error: 'project_not_found' })
    try { return res.json(await initializeRepository(root)) }
    catch { return res.status(400).json({ error: 'git_init_failed', message: 'Не удалось инициализировать локальный Git-репозиторий.' }) }
  })

  router.get('/:projectId/git/diff', async (req, res) => {
    const root = projectRoot(db, req.params.projectId)
    if (!root) return res.status(404).json({ error: 'project_not_found' })
    const parsed = pathSchema.safeParse({ path: req.query.path })
    if (!parsed.success) return res.status(400).json({ error: 'invalid_path' })
    try { return res.json(await getGitDiff(root, parsed.data.path)) }
    catch { return res.status(400).json({ error: 'git_diff_failed', message: 'Не удалось построить diff для выбранного файла.' }) }
  })

  router.post('/:projectId/git/stage', async (req, res) => {
    const root = projectRoot(db, req.params.projectId)
    if (!root) return res.status(404).json({ error: 'project_not_found' })
    const parsed = pathSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_path' })
    try { await stagePath(root, parsed.data.path); return res.json({ staged: true }) }
    catch { return res.status(400).json({ error: 'git_stage_failed', message: 'Не удалось добавить файл в индекс.' }) }
  })

  router.post('/:projectId/git/unstage', async (req, res) => {
    const root = projectRoot(db, req.params.projectId)
    if (!root) return res.status(404).json({ error: 'project_not_found' })
    const parsed = pathSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_path' })
    try { await unstagePath(root, parsed.data.path); return res.json({ staged: false }) }
    catch { return res.status(400).json({ error: 'git_unstage_failed', message: 'Не удалось убрать файл из индекса.' }) }
  })

  router.post('/:projectId/git/commit', async (req, res) => {
    const root = projectRoot(db, req.params.projectId)
    if (!root) return res.status(404).json({ error: 'project_not_found' })
    const parsed = commitSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_commit', message: 'Введите сообщение коммита длиной до 256 символов.' })
    try { return res.json(await commitStaged(root, parsed.data.message)) }
    catch (error) { return res.status(400).json({ error: 'git_commit_failed', message: error instanceof Error ? error.message.slice(0, 300) : 'Не удалось создать коммит.' }) }
  })

  return router
}
