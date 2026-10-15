import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'

let directory: string
let database: ReturnType<typeof openDatabase>
let app: ReturnType<typeof createApp>
const previous = process.env.POLAR_ALLOW_HOST_PATHS

async function owner() {
  const setup = await request(app).post('/api/auth/setup').send({ username: 'owner', password: 'a-long-passphrase-42' }).expect(201)
  return { cookie: setup.headers['set-cookie'][0].split(';')[0] as string, csrf: setup.body.csrfToken as string }
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'polar-host-path-'))
  mkdirSync(join(directory, 'repo', '.git', 'info'), { recursive: true })
  database = openDatabase(':memory:')
  app = createApp(database)
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
  if (previous === undefined) delete process.env.POLAR_ALLOW_HOST_PATHS
  else process.env.POLAR_ALLOW_HOST_PATHS = previous
})

describe('projects in existing server directories', () => {
  it('are refused unless POLAR_ALLOW_HOST_PATHS=1', async () => {
    delete process.env.POLAR_ALLOW_HOST_PATHS
    const { cookie, csrf } = await owner()
    const list = await request(app).get('/api/projects').set('Cookie', cookie).expect(200)
    expect(list.body.hostPathsAllowed).toBe(false)
    await request(app).post('/api/projects').set('Cookie', cookie).set('x-csrf-token', csrf).send({ name: 'Repo', path: join(directory, 'repo') }).expect(400)
  })

  it('open an existing folder in place, hide .polar from git and reject duplicates or bad paths', async () => {
    process.env.POLAR_ALLOW_HOST_PATHS = '1'
    const { cookie, csrf } = await owner()
    const repo = join(directory, 'repo')
    await request(app).post('/api/projects').set('Cookie', cookie).set('x-csrf-token', csrf).send({ name: 'Repo', path: repo }).expect(201)
    const row = database.prepare('SELECT workspace_path FROM projects WHERE name=?').get('Repo') as { workspace_path: string }
    expect(row.workspace_path).toBe(realpathSync(repo))
    expect(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')).toContain('.polar/')
    await request(app).post('/api/projects').set('Cookie', cookie).set('x-csrf-token', csrf).send({ name: 'Again', path: repo }).expect(409)
    await request(app).post('/api/projects').set('Cookie', cookie).set('x-csrf-token', csrf).send({ name: 'Relative', path: 'repo' }).expect(400)
    await request(app).post('/api/projects').set('Cookie', cookie).set('x-csrf-token', csrf).send({ name: 'Missing', path: join(directory, 'nope') }).expect(400)
    await request(app).post('/api/projects').set('Cookie', cookie).set('x-csrf-token', csrf).send({ name: 'Root', path: '/' }).expect(400)
  })
})
