import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { relative, resolve, sep, extname, join } from 'node:path'
import express, { Router } from 'express'
import type { AppDatabase } from '../db.js'
import { requireCsrf } from '../auth/router.js'

const MAX_BYTES = 20 * 1024 * 1024
const supported: Record<string, { mime: string; aliases: string[] }> = {
  '.txt': { mime: 'text/plain', aliases: ['text/plain', 'application/octet-stream'] },
  '.md': { mime: 'text/markdown', aliases: ['text/markdown', 'text/plain', 'application/octet-stream'] },
  '.mdx': { mime: 'text/markdown', aliases: ['text/markdown', 'text/plain', 'application/octet-stream'] },
  '.csv': { mime: 'text/csv', aliases: ['text/csv', 'text/plain', 'application/octet-stream'] },
  '.json': { mime: 'application/json', aliases: ['application/json', 'text/plain', 'application/octet-stream'] },
  '.pdf': { mime: 'application/pdf', aliases: ['application/pdf', 'application/octet-stream'] },
  '.png': { mime: 'image/png', aliases: ['image/png'] },
  '.jpg': { mime: 'image/jpeg', aliases: ['image/jpeg'] },
  '.jpeg': { mime: 'image/jpeg', aliases: ['image/jpeg'] },
  '.webp': { mime: 'image/webp', aliases: ['image/webp'] },
}

type ProjectRow = { id: string; workspace_path: string }
type SessionRow = { id: string }
type AttachmentRow = { id: string; original_name: string; mime_type: string; byte_size: number; storage_path: string; created_at: number }

function publicAttachment(row: AttachmentRow) {
  return { id: row.id, name: row.original_name, mimeType: row.mime_type, byteSize: row.byte_size, createdAt: row.created_at }
}

function validSignature(ext: string, data: Buffer): boolean {
  if (ext === '.pdf') return data.subarray(0, 5).toString('ascii') === '%PDF-'
  if (ext === '.png') return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (ext === '.jpg' || ext === '.jpeg') return data.length > 2 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  if (ext === '.webp') return data.length > 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP'
  return !data.includes(0)
}

function cleanOriginalName(header: string): string {
  if (!header || header.length > 900) throw new Error('invalid_name')
  let decoded: string
  try { decoded = decodeURIComponent(header) } catch { throw new Error('invalid_name') }
  const name = decoded.replace(/\\/g, '/').split('/').pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim() ?? ''
  if (!name || name.length > 180) throw new Error('invalid_name')
  return name
}

function confinedAttachmentPath(projectRoot: string, storagePath: string): boolean {
  const root = resolve(projectRoot, '.polar', 'attachments')
  const target = resolve(storagePath)
  const rel = relative(root, target)
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep)
}

export function createAttachmentsRouter(db: AppDatabase): Router {
  const router = Router()
  router.use((req, res, next) => req.method === 'GET' || req.method === 'HEAD' ? next() : requireCsrf(req, res, next))

  router.get('/:projectId/sessions/:sessionId/attachments', (req, res) => {
    const project = db.prepare('SELECT id,workspace_path FROM projects WHERE id=?').get(req.params.projectId) as { id: string; workspace_path: string } | undefined
    if (!project) return res.status(404).json({ error: 'project_not_found' })
    const session = db.prepare('SELECT id FROM conversations WHERE id=? AND project_id=?').get(req.params.sessionId, req.params.projectId) as SessionRow | undefined
    if (!session) return res.status(404).json({ error: 'session_not_found' })
    const rows = db.prepare('SELECT id,original_name,mime_type,byte_size,storage_path,created_at FROM attachments WHERE project_id=? AND conversation_id=? ORDER BY created_at').all(req.params.projectId, session.id) as AttachmentRow[]
    return res.json({ attachments: rows.filter(row => confinedAttachmentPath(project.workspace_path, row.storage_path) && existsSync(row.storage_path) && !lstatSync(row.storage_path).isSymbolicLink()).map(publicAttachment) })
  })

  router.post('/:projectId/sessions/:sessionId/attachments', express.raw({ type: 'application/octet-stream', limit: MAX_BYTES }), (req, res) => {
    const project = db.prepare('SELECT id,workspace_path FROM projects WHERE id=?').get(req.params.projectId) as ProjectRow | undefined
    if (!project) return res.status(404).json({ error: 'project_not_found' })
    const session = db.prepare('SELECT id FROM conversations WHERE id=? AND project_id=? AND archived_at IS NULL').get(req.params.sessionId, project.id) as SessionRow | undefined
    if (!session) return res.status(404).json({ error: 'session_not_found' })
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (!data.length || data.length > MAX_BYTES) return res.status(413).json({ error: 'invalid_attachment_size', message: 'Файл пуст или превышает лимит 20 МБ.' })
    let originalName: string
    try { originalName = cleanOriginalName(req.header('x-file-name') ?? '') }
    catch { return res.status(400).json({ error: 'invalid_attachment_name' }) }
    const extension = extname(originalName).toLowerCase()
    const definition = supported[extension]
    if (!definition) return res.status(415).json({ error: 'unsupported_attachment_type', message: 'Поддерживаются TXT, Markdown, CSV, JSON, PDF, PNG, JPEG и WebP.' })
    const declaredType = (req.header('x-file-type') ?? '').split(';')[0].trim().toLowerCase()
    if (declaredType && !definition.aliases.includes(declaredType)) return res.status(415).json({ error: 'attachment_type_mismatch' })
    if (!validSignature(extension, data)) return res.status(415).json({ error: 'attachment_signature_mismatch', message: 'Содержимое файла не соответствует расширению.' })

    const id = randomUUID()
    const directory = join(project.workspace_path, '.polar', 'attachments')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const storagePath = join(directory, `${session.id}-${id}${extension}`)
    try { writeFileSync(storagePath, data, { flag: 'wx', mode: 0o600 }) }
    catch { return res.status(500).json({ error: 'attachment_store_failed' }) }
    const now = Date.now()
    db.prepare('INSERT INTO attachments(id,project_id,conversation_id,original_name,mime_type,byte_size,storage_path,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, project.id, session.id, originalName, definition.mime, data.length, storagePath, now)
    const attachment = { id, name: originalName, mimeType: definition.mime, byteSize: data.length, createdAt: now }
    return res.status(201).json({ attachment })
  })

  router.get('/:projectId/attachments/:attachmentId/download', (req, res) => {
    const row = db.prepare('SELECT id,original_name,mime_type,byte_size,storage_path,created_at FROM attachments WHERE id=? AND project_id=?').get(req.params.attachmentId, req.params.projectId) as AttachmentRow | undefined
    const project = db.prepare('SELECT workspace_path FROM projects WHERE id=?').get(req.params.projectId) as { workspace_path: string } | undefined
    if (!row || !project || !confinedAttachmentPath(project.workspace_path, row.storage_path) || !existsSync(row.storage_path) || lstatSync(row.storage_path).isSymbolicLink() || !lstatSync(row.storage_path).isFile()) return res.status(404).json({ error: 'attachment_not_found' })
    res.setHeader('Cache-Control', 'private, no-store')
    return res.download(row.storage_path, row.original_name, { dotfiles: 'allow' })
  })

  router.delete('/:projectId/sessions/:sessionId/attachments/:attachmentId', (req, res) => {
    const row = db.prepare('SELECT id,original_name,mime_type,byte_size,storage_path,created_at FROM attachments WHERE id=? AND project_id=? AND conversation_id=?').get(req.params.attachmentId, req.params.projectId, req.params.sessionId) as AttachmentRow | undefined
    const project = db.prepare('SELECT workspace_path FROM projects WHERE id=?').get(req.params.projectId) as { workspace_path: string } | undefined
    if (!row || !project) return res.status(404).json({ error: 'attachment_not_found' })
    const referenced = db.prepare('SELECT 1 FROM messages WHERE conversation_id=? AND instr(content_json,?)>0 LIMIT 1').get(req.params.sessionId, row.id)
    if (referenced) return res.status(409).json({ error: 'attachment_already_sent', message: 'Это вложение уже входит в историю сообщения.' })
    if (!confinedAttachmentPath(project.workspace_path, row.storage_path)) return res.status(400).json({ error: 'invalid_attachment_path' })
    if (existsSync(row.storage_path)) unlinkSync(row.storage_path)
    db.prepare('DELETE FROM attachments WHERE id=?').run(row.id)
    return res.status(204).end()
  })

  return router
}
