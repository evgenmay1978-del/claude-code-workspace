import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import request from 'supertest'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'
import type { AppDatabase } from '../server/db.js'

let database: AppDatabase
let app: ReturnType<typeof createApp>

beforeEach(() => {
  database = openDatabase(':memory:')
  app = createApp(database)
})

afterEach(() => {
  const workspaces = database.prepare('SELECT workspace_path FROM projects').all() as { workspace_path: string }[]
  for (const workspace of workspaces) rmSync(workspace.workspace_path, { recursive: true, force: true })
  database.close()
})

async function createOwnerProject() {
  const setup = await request(app).post('/api/auth/setup').send({ username: 'owner', password: 'a-long-passphrase-42' }).expect(201)
  const cookie = setup.headers['set-cookie'][0].split(';')[0]
  const csrf = setup.body.csrfToken as string
  const result = await request(app).post('/api/projects').set('Cookie', cookie).set('x-csrf-token', csrf).send({ name: 'Attachments' }).expect(201)
  return { cookie, csrf, project: result.body.project as { id: string; sessions: { id: string }[] } }
}

describe('private chat attachments', () => {
  it('stores permitted files inside the chat, hides them from project browsing, and protects downloads', async () => {
    const { cookie, csrf, project } = await createOwnerProject()
    const sessionId = project.sessions[0].id
    const data = Buffer.from('# Local context\nThis file is attached to one private session.\n')
    const uploaded = await request(app)
      .post(`/api/projects/${project.id}/sessions/${sessionId}/attachments`)
      .set('Cookie', cookie).set('x-csrf-token', csrf)
      .set('Content-Type', 'application/octet-stream')
      .set('x-file-name', encodeURIComponent('context.md')).set('x-file-type', 'text/markdown')
      .send(data).expect(201)
    expect(uploaded.body.attachment).toMatchObject({ name: 'context.md', mimeType: 'text/markdown', byteSize: data.length })

    const listed = await request(app).get(`/api/projects/${project.id}/files`).set('Cookie', cookie).expect(200)
    expect(listed.body.files.some((file: { path: string }) => file.path.startsWith('.polar'))).toBe(false)
    await request(app).get(`/api/projects/${project.id}/file`).query({ path: '.polar/attachments/private.md' }).set('Cookie', cookie).expect(400)

    const attachmentId = uploaded.body.attachment.id as string
    await request(app).get(`/api/projects/${project.id}/attachments/${attachmentId}/download`).expect(401)
    const downloaded = await request(app).get(`/api/projects/${project.id}/attachments/${attachmentId}/download`).set('Cookie', cookie).expect(200)
    expect(downloaded.headers['content-disposition']).toContain('attachment')
    expect(downloaded.text).toContain('This file is attached')

    const removed = await request(app).delete(`/api/projects/${project.id}/sessions/${sessionId}/attachments/${attachmentId}`).set('Cookie', cookie).set('x-csrf-token', csrf).expect(204)
    expect(removed.text).toBe('')
  })

  it('rejects mismatched file signatures and mutation without CSRF', async () => {
    const { cookie, csrf, project } = await createOwnerProject()
    const sessionId = project.sessions[0].id
    await request(app).post(`/api/projects/${project.id}/sessions/${sessionId}/attachments`).set('Cookie', cookie).set('Content-Type', 'application/octet-stream').set('x-file-name', 'bad.png').set('x-file-type', 'image/png').send(Buffer.from('not a png')).expect(403)
    const mismatch = await request(app).post(`/api/projects/${project.id}/sessions/${sessionId}/attachments`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Content-Type', 'application/octet-stream').set('x-file-name', 'bad.png').set('x-file-type', 'image/png').send(Buffer.from('not a png')).expect(415)
    expect(mismatch.body.error).toBe('attachment_signature_mismatch')
  })
})
