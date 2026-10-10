import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
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

describe('private conversation search', () => {
  it('searches local messages across sessions and omits archived chats', async () => {
    const setup = await request(app).post('/api/auth/setup').send({ username: 'owner', password: 'a-long-passphrase-42' }).expect(201)
    const cookie = setup.headers['set-cookie'][0].split(';')[0]
    const csrf = setup.body.csrfToken as string
    const created = await request(app).post('/api/projects').set('Cookie', cookie).set('x-csrf-token', csrf).send({ name: 'Northstar' }).expect(201)
    const projectId = created.body.project.id as string
    const sessionId = created.body.project.sessions[0].id as string
    const now = Date.now()
    database.prepare('INSERT INTO messages(id,conversation_id,role,content_json,created_at) VALUES(?,?,?,?,?)').run('local-message', sessionId, 'user', JSON.stringify('Please inspect the token streaming parser.'), now)

    const result = await request(app).get('/api/claude/search').query({ q: 'streaming parser' }).set('Cookie', cookie).expect(200)
    expect(result.body.results).toHaveLength(1)
    expect(result.body.results[0]).toMatchObject({ projectId, sessionId, projectName: 'Northstar', role: 'user' })
    expect(result.body.results[0].snippet).toContain('streaming parser')

    database.prepare('UPDATE conversations SET archived_at=? WHERE id=?').run(now, sessionId)
    const archived = await request(app).get('/api/claude/search').query({ q: 'streaming parser' }).set('Cookie', cookie).expect(200)
    expect(archived.body.results).toHaveLength(0)
  })

  it('requires owner authentication and ignores underspecified search queries', async () => {
    await request(app).get('/api/claude/search').query({ q: 'chat' }).expect(401)
    const setup = await request(app).post('/api/auth/setup').send({ username: 'owner', password: 'a-long-passphrase-42' }).expect(201)
    const cookie = setup.headers['set-cookie'][0].split(';')[0]
    await request(app).get('/api/claude/search').query({ q: 'x' }).set('Cookie', cookie).expect(200).expect(({ body }) => expect(body.results).toEqual([]))
  })
})
