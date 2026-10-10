import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'

let temporaryDirectory: string
let database: ReturnType<typeof openDatabase>
let app: ReturnType<typeof createApp>
const savedEnvironment = new Map<string, string | undefined>()

function rememberEnvironment(key: string, value: string) {
  if (!savedEnvironment.has(key)) savedEnvironment.set(key, process.env[key])
  process.env[key] = value
}

function restoreEnvironment() {
  for (const [key, value] of savedEnvironment) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  savedEnvironment.clear()
}

function parseText(response: unknown, callback: (error: Error | null, body?: string) => void) {
  let body = ''
  const stream = response as { setEncoding: (encoding: string) => void; on: (event: string, listener: (chunk?: string) => void) => void }
  stream.setEncoding('utf8')
  stream.on('data', chunk => { body += chunk ?? '' })
  stream.on('end', () => callback(null, body))
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'polar-cli-stream-test-'))
  const configDirectory = join(temporaryDirectory, 'cli-config')
  mkdirSync(configDirectory, { recursive: true, mode: 0o700 })
  writeFileSync(join(configDirectory, '.credentials.json'), '{}', { mode: 0o600 })
  const fakeCli = join(temporaryDirectory, 'fake-claude.cjs')
  writeFileSync(fakeCli, `#!/usr/bin/env node
if (process.argv.includes('--version')) { process.stdout.write('2.1.test\\n'); process.exit(0) }
const option = process.argv.includes('--session-id') ? '--session-id' : '--resume'
const session = process.argv[process.argv.indexOf(option) + 1]
let prompt = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { prompt += chunk })
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({type:'stream_event',event:{delta:{type:'text_delta',text:'Fake CLI response'}}}) + '\\n')
  process.stdout.write(JSON.stringify({type:'result',session_id:session,usage:{input_tokens:7,output_tokens:4},result:'Fake CLI response',is_error:false}) + '\\n')
})
`)
  chmodSync(fakeCli, 0o700)
  rememberEnvironment('CLAUDE_ENABLED', '1')
  rememberEnvironment('CLAUDE_BIN', fakeCli)
  rememberEnvironment('CLAUDE_CONFIG_DIR', configDirectory)
  database = openDatabase(':memory:')
  app = createApp(database)
})

afterEach(() => {
  const projects = database.prepare('SELECT workspace_path FROM projects').all() as { workspace_path: string }[]
  for (const project of projects) rmSync(project.workspace_path, { recursive: true, force: true })
  database.close()
  rmSync(temporaryDirectory, { recursive: true, force: true })
  restoreEnvironment()
})

describe('official CLI chat stream adapter', () => {
  it('frames real-time events as SSE and stores the user and assistant turns', async () => {
    const setup = await request(app).post('/api/auth/setup').send({ username: 'owner', password: 'a-long-passphrase-42' }).expect(201)
    const cookie = setup.headers['set-cookie'][0].split(';')[0]
    const csrf = setup.body.csrfToken as string
    const created = await request(app).post('/api/projects').set('Cookie', cookie).set('x-csrf-token', csrf).send({ name: 'Stream test' }).expect(201)
    const project = created.body.project as { id: string; sessions: { id: string }[] }

    const response = await request(app)
      .post('/api/claude/stream')
      .set('Cookie', cookie)
      .set('x-csrf-token', csrf)
      .send({ projectId: project.id, sessionId: project.sessions[0].id, content: 'Say hello', model: 'sonnet', webSearch: false })
      .buffer(true)
      .parse(parseText)
      .expect(200)

    expect(String(response.body)).toContain('event: started\ndata: ')
    expect(String(response.body)).toContain('event: delta\ndata: {"text":"Fake CLI response"}\n\n')
    expect(String(response.body)).toContain('event: done\ndata: ')
    const messages = await request(app).get(`/api/projects/${project.id}/sessions/${project.sessions[0].id}/messages`).set('Cookie', cookie).expect(200)
    expect(messages.body.messages.map((message: { role: string }) => message.role)).toEqual(['user', 'assistant'])
    expect(messages.body.messages[1].content).toEqual([{ type: 'text', text: 'Fake CLI response' }])
  })
})
