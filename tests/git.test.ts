import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import request from 'supertest'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'

let database: ReturnType<typeof openDatabase>
let app: ReturnType<typeof createApp>
let cookie: string
let csrf: string
let projectId: string

beforeEach(async () => {
  database = openDatabase(':memory:')
  app = createApp(database)
  const setup = await request(app).post('/api/auth/setup').send({ username: 'owner', password: 'a-long-passphrase-42' }).expect(201)
  cookie = setup.headers['set-cookie'][0].split(';')[0]
  csrf = setup.body.csrfToken as string
  const created = await request(app).post('/api/projects').set('Cookie', cookie).set('x-csrf-token', csrf).send({ name: 'Git integration' }).expect(201)
  projectId = created.body.project.id as string
})

afterEach(() => {
  const projects = database.prepare('SELECT workspace_path FROM projects').all() as { workspace_path: string }[]
  for (const project of projects) rmSync(project.workspace_path, { recursive: true, force: true })
  database.close()
})

describe('local Git workspace', () => {
  it('shows a real diff, stages the file, and commits only staged changes', async () => {
    await request(app).get(`/api/projects/${projectId}/git/status`).set('Cookie', cookie).expect(200).expect(({ body }) => {
      expect(body).toMatchObject({ initialized: false, branch: '', changes: [] })
    })

    await request(app).post(`/api/projects/${projectId}/git/init`).set('Cookie', cookie).set('x-csrf-token', csrf).send({}).expect(200).expect(({ body }) => {
      expect(body).toMatchObject({ initialized: true, branch: 'main' })
    })

    await request(app).put(`/api/projects/${projectId}/file`).set('Cookie', cookie).set('x-csrf-token', csrf).send({ path: 'README.md', content: '# Local source control\n\nStored in the project workspace.\n' }).expect(200)
    const status = await request(app).get(`/api/projects/${projectId}/git/status`).set('Cookie', cookie).expect(200)
    expect(status.body.changes).toEqual([{ path: 'README.md', kind: 'A', staged: false, unstaged: true }])

    const diff = await request(app).get(`/api/projects/${projectId}/git/diff`).query({ path: 'README.md' }).set('Cookie', cookie).expect(200)
    expect(diff.body.unstaged).toContain('+# Local source control')

    await request(app).post(`/api/projects/${projectId}/git/stage`).set('Cookie', cookie).set('x-csrf-token', csrf).send({ path: 'README.md' }).expect(200)
    const staged = await request(app).get(`/api/projects/${projectId}/git/status`).set('Cookie', cookie).expect(200)
    expect(staged.body.changes[0]).toMatchObject({ path: 'README.md', staged: true, unstaged: false })

    const commit = await request(app).post(`/api/projects/${projectId}/git/commit`).set('Cookie', cookie).set('x-csrf-token', csrf).send({ message: 'Add project README' }).expect(200)
    expect(commit.body).toMatchObject({ message: 'Add project README' })
    expect(commit.body.hash).toMatch(/^[0-9a-f]{7,}$/)
    const clean = await request(app).get(`/api/projects/${projectId}/git/status`).set('Cookie', cookie).expect(200)
    expect(clean.body.changes).toEqual([])
  })

  it('rejects mutations without CSRF and never stages protected secret paths', async () => {
    await request(app).post(`/api/projects/${projectId}/git/init`).set('Cookie', cookie).send({}).expect(403)
    await request(app).post(`/api/projects/${projectId}/git/stage`).set('Cookie', cookie).set('x-csrf-token', csrf).send({ path: '.env' }).expect(400)
  })
})
