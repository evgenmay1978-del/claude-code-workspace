import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import request from 'supertest'
import { createApp } from '../server/app.js'
import { openDatabase, workspacesDirectory } from '../server/db.js'
import type { AppDatabase } from '../server/db.js'

let database: AppDatabase
let app: ReturnType<typeof createApp>

beforeEach(() => {
  delete process.env.SESSION_COOKIE_SECURE
  database = openDatabase(':memory:')
  app = createApp(database)
})

afterEach(() => {
  const workspaces = database.prepare('SELECT workspace_path FROM projects').all() as { workspace_path: string }[]
  for (const workspace of workspaces) rmSync(workspace.workspace_path, { recursive: true, force: true })
  database.close()
})

describe('owner authentication', () => {
  it('starts uninitialized and allows a single owner to be created', async () => {
    const initial = await request(app).get('/api/auth/status').expect(200)
    expect(initial.body).toMatchObject({ initialized: false, authenticated: false })

    const setup = await request(app).post('/api/auth/setup').send({ username: 'owner', password: 'a-long-passphrase-42' }).expect(201)
    expect(setup.body).toMatchObject({ authenticated: true, username: 'owner' })
    expect(setup.body.csrfToken).toBeTruthy()
    expect(setup.headers['set-cookie'][0]).toContain('SameSite=None')
    expect(setup.headers['set-cookie'][0]).toContain('Secure')

    const cookie = setup.headers['set-cookie'][0].split(';')[0]
    await request(app).get('/api/auth/status').set('Cookie', cookie).expect(200).expect(({ body }) => {
      expect(body).toMatchObject({ initialized: true, authenticated: true, username: 'owner' })
    })
    await request(app).post('/api/auth/setup').send({ username: 'other', password: 'another-long-passphrase' }).expect(409)
  })

  it('rejects weak passwords, invalid login, missing authentication and invalid CSRF', async () => {
    await request(app).post('/api/auth/setup').send({ username: 'owner', password: 'short' }).expect(400)
    await request(app).get('/api/private').expect(401)

    const setup = await request(app).post('/api/auth/setup').send({ username: 'owner', password: 'a-long-passphrase-42' }).expect(201)
    await request(app).post('/api/auth/login').send({ username: 'owner', password: 'wrong password' }).expect(401)
    const cookie = setup.headers['set-cookie'][0].split(';')[0]
    await request(app).post('/api/auth/logout').set('Cookie', cookie).set('x-csrf-token', 'wrong').expect(403)
  })

  it('requires the session CSRF token to log out and revokes the session', async () => {
    const setup = await request(app).post('/api/auth/setup').send({ username: 'owner', password: 'a-long-passphrase-42' }).expect(201)
    const cookie = setup.headers['set-cookie'][0].split(';')[0]
    await request(app).post('/api/auth/logout').set('Cookie', cookie).set('x-csrf-token', setup.body.csrfToken).expect(204)
    await request(app).get('/api/auth/status').set('Cookie', cookie).expect(200).expect(({ body }) => {
      expect(body.authenticated).toBe(false)
    })
  })
})

describe('workspace projects and files', () => {
  it('persists project/session metadata and confines file operations to the workspace', async () => {
    const setup = await request(app).post('/api/auth/setup').send({ username: 'owner', password: 'a-long-passphrase-42' }).expect(201)
    const cookie = setup.headers['set-cookie'][0].split(';')[0]
    const csrf = setup.body.csrfToken as string

    await request(app).post('/api/projects').set('Cookie', cookie).send({ name: 'unsafe write' }).expect(403)
    const created = await request(app).post('/api/projects').set('Cookie', cookie).set('x-csrf-token', csrf).send({ name: 'Atlas API', description: 'Service core' }).expect(201)
    const projectId = created.body.project.id as string
    expect(created.body.project).toMatchObject({ name: 'Atlas API', description: 'Service core' })
    expect(created.body.project.sessions).toHaveLength(1)

    const nextSession = await request(app).post(`/api/projects/${projectId}/sessions`).set('Cookie', cookie).set('x-csrf-token', csrf).send({ title: 'Fix the stream' }).expect(201)
    const sessionId = nextSession.body.session.id as string
    await request(app).patch(`/api/projects/${projectId}/sessions/${sessionId}`).set('Cookie', cookie).set('x-csrf-token', csrf).send({ title: 'Stream fixes' }).expect(200)
    const listed = await request(app).get('/api/projects').set('Cookie', cookie).expect(200)
    expect(listed.body.projects[0].sessions.some((session: { title: string }) => session.title === 'Stream fixes')).toBe(true)

    const fileText = '# Persisted README\n\nReal file data.'
    const saved = await request(app).put(`/api/projects/${projectId}/file`).set('Cookie', cookie).set('x-csrf-token', csrf).send({ path: 'README.md', content: fileText })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    const read = await request(app).get(`/api/projects/${projectId}/file`).query({ path: 'README.md' }).set('Cookie', cookie).expect(200)
    expect(read.body).toMatchObject({ content: fileText, language: 'Markdown' })

    await request(app).get(`/api/projects/${projectId}/file`).query({ path: '../../etc/passwd' }).set('Cookie', cookie).expect(400)
    await request(app).get(`/api/projects/${projectId}/file`).query({ path: '.env' }).set('Cookie', cookie).expect(400)
    expect(workspacesDirectory).toBeTruthy()
  })
})
