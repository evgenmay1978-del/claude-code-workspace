import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import type { AppDatabase } from '../db.js'
import { workspacesDirectory } from '../db.js'
import { requireCsrf } from '../auth/router.js'
import { listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile } from '../workspaces/files.js'
import { UnsafeWorkspacePathError } from '../workspaces/paths.js'
import { excludePolarFromGit, HostPathError, hostPathsAllowed, resolveHostProjectPath } from '../workspaces/host-paths.js'

const newProjectSchema = z.object({ name: z.string().trim().min(1).max(64), description: z.string().trim().max(500).optional(), path: z.string().trim().min(1).max(1024).optional() }).strict()
const updateProjectSchema = z.object({ name: z.string().trim().min(1).max(64).optional(), description: z.string().trim().max(500).optional(), instructions: z.string().max(20_000).optional(), defaultModel: z.string().max(128).optional() }).strict().refine(value => Object.keys(value).length > 0)
const newSessionSchema = z.object({ title: z.string().trim().min(1).max(120).optional(), model: z.string().max(128).optional() }).strict()
const updateSessionSchema = z.object({ title: z.string().trim().min(1).max(120).optional(), archived: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 0)
const fileContentSchema = z.object({ path: z.string().min(1).max(1024), content: z.string().max(2 * 1024 * 1024) }).strict()

type ProjectRow = { id: string; name: string; description: string; instructions: string; workspace_path: string; default_model: string; created_at: number; updated_at: number }
type SessionRow = { id: string; project_id: string; title: string; model: string; agent_session_id: string | null; status: 'idle' | 'working' | 'done' | 'error'; archived_at: number | null; created_at: number; updated_at: number }

function sessionsFor(db: AppDatabase, projectId: string) {
  return db.prepare('SELECT id,project_id,title,model,agent_session_id,status,archived_at,created_at,updated_at FROM conversations WHERE project_id=? ORDER BY archived_at IS NOT NULL, updated_at DESC').all(projectId) as SessionRow[]
}

function projectFor(db: AppDatabase, projectId: string): ProjectRow | undefined {
  return db.prepare('SELECT id,name,description,instructions,workspace_path,default_model,created_at,updated_at FROM projects WHERE id=?').get(projectId) as ProjectRow | undefined
}

function projectResponse(db: AppDatabase, project: ProjectRow) {
  return { id: project.id, name: project.name, description: project.description, instructions: project.instructions, defaultModel: project.default_model, createdAt: project.created_at, updatedAt: project.updated_at, sessions: sessionsFor(db, project.id).map(session => ({ id: session.id, title: session.title, model: session.model, status: session.status, archived: Boolean(session.archived_at), createdAt: session.created_at, updatedAt: session.updated_at })) }
}

function workspaceFor(db: AppDatabase, projectId: string): { project: ProjectRow; path: string } | undefined {
  const project = projectFor(db, projectId)
  if (!project) return undefined
  return { project, path: project.workspace_path }
}

export function createProjectsRouter(db: AppDatabase): Router {
  const router = Router()
  router.use((req, res, next) => req.method === 'GET' || req.method === 'HEAD' ? next() : requireCsrf(req, res, next))

  router.get('/', (_req, res) => {
    const projects = db.prepare('SELECT id,name,description,instructions,workspace_path,default_model,created_at,updated_at FROM projects ORDER BY updated_at DESC').all() as ProjectRow[]
    res.json({ projects: projects.map(project => projectResponse(db, project)), hostPathsAllowed: hostPathsAllowed() })
  })

  router.post('/', (req, res) => {
    const parsed = newProjectSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_project', message: 'Название проекта обязательно и не должно превышать 64 символа.' })
    const id = randomUUID()
    const now = Date.now()
    let workspace = join(workspacesDirectory, id)
    if (parsed.data.path) {
      try { workspace = resolveHostProjectPath(parsed.data.path) }
      catch (error) { return res.status(400).json({ error: 'invalid_project_path', message: error instanceof HostPathError ? error.message : 'Каталог недоступен.' }) }
      if (db.prepare('SELECT 1 FROM projects WHERE workspace_path=?').get(workspace)) return res.status(409).json({ error: 'project_path_taken', message: 'Для этого каталога уже есть проект.' })
      excludePolarFromGit(workspace)
    } else {
      mkdirSync(workspace, { recursive: true, mode: 0o700 })
    }
    const sessionId = randomUUID()
    const name = parsed.data.name
    db.transaction(() => {
      db.prepare('INSERT INTO projects(id,name,description,workspace_path,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, name, parsed.data.description ?? '', workspace, now, now)
      db.prepare('INSERT INTO conversations(id,project_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run(sessionId, id, 'Первая сессия', now, now)
    }).immediate()
    const created = projectFor(db, id)
    if (!created) return res.status(500).json({ error: 'project_create_failed' })
    res.status(201).json({ project: projectResponse(db, created) })
  })

  router.get('/:projectId', (req, res) => {
    const project = projectFor(db, req.params.projectId)
    if (!project) return res.status(404).json({ error: 'project_not_found' })
    res.json({ project: projectResponse(db, project) })
  })

  router.patch('/:projectId', (req, res) => {
    const project = projectFor(db, req.params.projectId)
    if (!project) return res.status(404).json({ error: 'project_not_found' })
    const parsed = updateProjectSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_project_update' })
    const update = parsed.data
    db.prepare('UPDATE projects SET name=COALESCE(?,name), description=COALESCE(?,description), instructions=COALESCE(?,instructions), default_model=COALESCE(?,default_model), updated_at=? WHERE id=?').run(update.name ?? null, update.description ?? null, update.instructions ?? null, update.defaultModel ?? null, Date.now(), project.id)
    const updated = projectFor(db, project.id)
    if (!updated) return res.status(404).json({ error: 'project_not_found' })
    res.json({ project: projectResponse(db, updated) })
  })

  router.post('/:projectId/sessions', (req, res) => {
    const project = projectFor(db, req.params.projectId)
    if (!project) return res.status(404).json({ error: 'project_not_found' })
    const parsed = newSessionSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_session' })
    const id = randomUUID()
    const now = Date.now()
    const title = parsed.data.title ?? 'Новая сессия'
    const model = parsed.data.model ?? project.default_model
    db.prepare('INSERT INTO conversations(id,project_id,title,model,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, project.id, title, model, now, now)
    res.status(201).json({ session: { id, title, model, status: 'idle', archived: false, createdAt: now, updatedAt: now } })
  })

  router.patch('/:projectId/sessions/:sessionId', (req, res) => {
    const project = projectFor(db, req.params.projectId)
    if (!project) return res.status(404).json({ error: 'project_not_found' })
    const session = db.prepare('SELECT id,title,model,archived_at,status,created_at,updated_at FROM conversations WHERE id=? AND project_id=?').get(req.params.sessionId, project.id) as Omit<SessionRow, 'project_id' | 'agent_session_id'> | undefined
    if (!session) return res.status(404).json({ error: 'session_not_found' })
    const parsed = updateSessionSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_session_update' })
    db.prepare('UPDATE conversations SET title=COALESCE(?,title), archived_at=CASE WHEN ? IS NULL THEN archived_at WHEN ?=1 THEN COALESCE(archived_at,?) ELSE NULL END, updated_at=? WHERE id=? AND project_id=?').run(parsed.data.title ?? null, parsed.data.archived === undefined ? null : 1, parsed.data.archived ? 1 : 0, Date.now(), Date.now(), session.id, project.id)
    const updated = db.prepare('SELECT id,title,model,archived_at,status,created_at,updated_at FROM conversations WHERE id=?').get(session.id) as Omit<SessionRow, 'project_id' | 'agent_session_id'>
    res.json({ session: { ...updated, archived: Boolean(updated.archived_at) } })
  })

  router.get('/:projectId/files', (req, res) => {
    const workspace = workspaceFor(db, req.params.projectId)
    if (!workspace) return res.status(404).json({ error: 'project_not_found' })
    try { return res.json({ files: listWorkspaceFiles(workspace.path) }) }
    catch { return res.status(400).json({ error: 'workspace_unavailable' }) }
  })

  router.get('/:projectId/file', (req, res) => {
    const workspace = workspaceFor(db, req.params.projectId)
    if (!workspace) return res.status(404).json({ error: 'project_not_found' })
    if (typeof req.query.path !== 'string') return res.status(400).json({ error: 'invalid_path' })
    try { return res.json(readWorkspaceFile(workspace.path, req.query.path)) }
    catch (error) { return res.status(error instanceof RangeError ? 413 : 400).json({ error: error instanceof RangeError ? 'file_too_large' : 'file_unavailable' }) }
  })

  router.put('/:projectId/file', (req, res) => {
    const workspace = workspaceFor(db, req.params.projectId)
    if (!workspace) return res.status(404).json({ error: 'project_not_found' })
    const parsed = fileContentSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_file' })
    try {
      writeWorkspaceFile(workspace.path, parsed.data.path, parsed.data.content)
      db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(Date.now(), workspace.project.id)
      return res.json({ saved: true })
    } catch (error) {
      return res.status(error instanceof RangeError ? 413 : error instanceof UnsafeWorkspacePathError ? 400 : 400).json({ error: error instanceof RangeError ? 'file_too_large' : 'file_unavailable' })
    }
  })

  router.get('/:projectId/sessions/:sessionId/messages', (req, res) => {
    const session = db.prepare('SELECT id FROM conversations WHERE id=? AND project_id=?').get(req.params.sessionId, req.params.projectId)
    if (!session) return res.status(404).json({ error: 'session_not_found' })
    const rows = db.prepare('SELECT id,role,content_json,model,input_tokens,output_tokens,created_at FROM messages WHERE conversation_id=? ORDER BY created_at,id').all(req.params.sessionId) as { id: string; role: 'user' | 'assistant' | 'system'; content_json: string; model: string; input_tokens: number; output_tokens: number; created_at: number }[]
    res.json({ messages: rows.map(row => ({ id: row.id, role: row.role, content: JSON.parse(row.content_json) as unknown, model: row.model, inputTokens: row.input_tokens, outputTokens: row.output_tokens, createdAt: row.created_at })) })
  })

  return router
}
