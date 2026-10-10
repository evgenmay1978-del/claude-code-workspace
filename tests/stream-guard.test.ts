import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'

const NEWLINE = String.fromCharCode(10)

let directory: string
let database: ReturnType<typeof openDatabase>
let app: ReturnType<typeof createApp>
let cookie: string
let csrf: string
let projectId: string
let sessionId: string
const saved = new Map<string, string | undefined>()

function remember(key: string, value: string) { if (!saved.has(key)) saved.set(key, process.env[key]); process.env[key] = value }

// Фейковый CLI: печатает событие, держит поток открытым holdSeconds секунд и завершается результатом.
function writeFakeCli(holdSeconds: number): string {
  const file = join(directory, 'fake-claude-' + holdSeconds + '.sh')
  const script = [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "2.1.test"; exit 0; fi',
    'cat > /dev/null',
    'echo \'{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"guard"}}}\'',
    'sleep ' + holdSeconds,
    'echo \'{"type":"result","session_id":"guard-session","usage":{"input_tokens":1,"output_tokens":1},"result":"guard","is_error":false}\'',
    '',
  ].join(NEWLINE)
  writeFileSync(file, script)
  chmodSync(file, 0o700)
  return file
}

function parseText(response: unknown, callback: (error: Error | null, body?: string) => void) {
  let body = ''
  const stream = response as { setEncoding: (encoding: string) => void; on: (event: string, listener: (chunk?: string) => void) => void }
  stream.setEncoding('utf8')
  stream.on('data', chunk => { body += chunk ?? '' })
  stream.on('end', () => callback(null, body))
}

function startStream(targetSession: string) {
  return request(app).post('/api/claude/stream').set('Cookie', cookie).set('x-csrf-token', csrf)
    .send({ projectId, sessionId: targetSession, content: 'guard check', model: 'sonnet', webSearch: false })
    .buffer(true).parse(parseText)
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'polar-stream-guard-'))
  const configDirectory = join(directory, 'cli-config')
  mkdirSync(configDirectory, { recursive: true, mode: 0o700 })
  writeFileSync(join(configDirectory, '.credentials.json'), '{}', { mode: 0o600 })
  remember('CLAUDE_ENABLED', '1')
  remember('CLAUDE_BIN', writeFakeCli(6))
  remember('CLAUDE_CONFIG_DIR', configDirectory)
  delete process.env.MAX_CONCURRENT_STREAMS
  delete process.env.CLAUDE_STREAM_TIMEOUT_MS
  delete process.env.CLAUDE_STREAM_HEARTBEAT_MS
  database = openDatabase(':memory:')
  app = createApp(database)
  const setup = await request(app).post('/api/auth/setup').send({ username: 'owner', password: 'a-long-passphrase-42' }).expect(201)
  cookie = setup.headers['set-cookie'][0].split(';')[0]
  csrf = setup.body.csrfToken as string
  const created = await request(app).post('/api/projects').set('Cookie', cookie).set('x-csrf-token', csrf).send({ name: 'Guard' }).expect(201)
  projectId = created.body.project.id as string
  sessionId = created.body.project.sessions[0].id as string
})

afterEach(() => {
  const projects = database.prepare('SELECT workspace_path FROM projects').all() as { workspace_path: string }[]
  for (const project of projects) rmSync(project.workspace_path, { recursive: true, force: true })
  database.close()
  rmSync(directory, { recursive: true, force: true })
  for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  saved.clear()
})

describe('stream guards', () => {
  it('rejects a second parallel stream for the same session', async () => {
    const first = startStream(sessionId).then(response => response).catch(error => error as Error)
    await new Promise(resolve => setTimeout(resolve, 600))
    const second = await request(app).post('/api/claude/stream').set('Cookie', cookie).set('x-csrf-token', csrf)
      .send({ projectId, sessionId, content: 'second', model: 'sonnet', webSearch: false }).expect(409)
    expect(second.body.error).toBe('stream_in_progress')
    const finished = await first
    expect((finished as { status: number }).status).toBe(200)
  }, 20000)

  it('caps concurrent streams across sessions', async () => {
    remember('MAX_CONCURRENT_STREAMS', '1')
    const extra = await request(app).post('/api/projects/' + projectId + '/sessions').set('Cookie', cookie).set('x-csrf-token', csrf).send({ title: 'second' }).expect(201)
    const otherSession = extra.body.session.id as string
    const first = startStream(sessionId).then(response => response).catch(error => error as Error)
    await new Promise(resolve => setTimeout(resolve, 600))
    const second = await request(app).post('/api/claude/stream').set('Cookie', cookie).set('x-csrf-token', csrf)
      .send({ projectId, sessionId: otherSession, content: 'parallel', model: 'sonnet', webSearch: false }).expect(429)
    expect(second.body.error).toBe('too_many_streams')
    await first
  }, 20000)

  it('keeps the SSE connection alive with heartbeats', async () => {
    remember('CLAUDE_STREAM_HEARTBEAT_MS', '300')
    const response = await startStream(sessionId).expect(200)
    expect(String(response.body)).toContain(': keepalive')
    expect(String(response.body)).toContain('event: done')
  }, 20000)

  it('stops a hung CLI by timeout', async () => {
    remember('CLAUDE_BIN', writeFakeCli(30))
    remember('CLAUDE_STREAM_TIMEOUT_MS', '1200')
    const started = Date.now()
    const response = await startStream(sessionId).expect(200)
    const elapsed = Date.now() - started
    expect(String(response.body)).toContain('cli_timeout')
    expect(elapsed).toBeLessThan(15000)
  }, 30000)
})
