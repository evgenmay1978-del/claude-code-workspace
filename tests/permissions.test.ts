import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'
import { PermissionBroker, describeToolInput, summarizeToolInput } from '../server/claude/permissions.js'
import { handleMessage } from '../server/claude/permission-mcp.js'
import { buildClaudeArgs, PERMISSION_TOOL } from '../server/claude/runner.js'

describe('permission broker', () => {
  it('holds a request until the owner allows it and returns the original input', async () => {
    const broker = new PermissionBroker()
    const seen: string[] = []
    const token = broker.openRun({ sessionId: 's1', onRequest: request => seen.push(request.id), onResolved: () => undefined })
    const pending = broker.request(token, 'Bash', { command: 'ls -la' })
    expect(seen).toHaveLength(1)
    expect(broker.pendingForSession('s1')[0].summary).toBe('ls -la')
    expect(broker.decide(seen[0], 'other-session', 'allow')).toBe(false)
    expect(broker.decide(seen[0], 's1', 'allow')).toBe(true)
    await expect(pending).resolves.toEqual({ behavior: 'allow', updatedInput: { command: 'ls -la' } })
    expect(broker.decide(seen[0], 's1', 'allow')).toBe(false)
  })

  it('denies with the owner message, rejects unknown tokens and denies everything when the run closes', async () => {
    const broker = new PermissionBroker()
    const ids: string[] = []
    const token = broker.openRun({ sessionId: 's1', onRequest: request => ids.push(request.id), onResolved: () => undefined })
    const denied = broker.request(token, 'Write', { file_path: 'a.txt', content: 'x' })
    broker.decide(ids[0], 's1', 'deny', 'не сейчас')
    await expect(denied).resolves.toEqual({ behavior: 'deny', message: 'не сейчас' })
    await expect(broker.request('forged', 'Bash', { command: 'rm -rf /' })).resolves.toMatchObject({ behavior: 'deny' })
    const orphan = broker.request(token, 'Bash', { command: 'sleep 1' })
    broker.closeRun(token)
    await expect(orphan).resolves.toMatchObject({ behavior: 'deny' })
    expect(broker.isValidRun(token)).toBe(false)
  })

  it('times out to a denial', async () => {
    const broker = new PermissionBroker(30)
    const token = broker.openRun({ sessionId: 's1', onRequest: () => undefined, onResolved: () => undefined })
    await expect(broker.request(token, 'Bash', { command: 'true' })).resolves.toMatchObject({ behavior: 'deny' })
  })

  it('describes edits as a diff and commands with their text', () => {
    expect(describeToolInput('Edit', { file_path: 'a.ts', old_string: 'one', new_string: 'two' })).toBe('a.ts\n- one\n+ two')
    expect(describeToolInput('Bash', { command: 'git status', description: 'Show status' })).toBe('# Show status\n$ git status')
    expect(summarizeToolInput('Grep', { pattern: 'TODO', path: 'src' })).toBe('TODO в src')
  })
})

describe('permission MCP server', () => {
  it('speaks JSON-RPC: initialize, tools/list and tools/call', async () => {
    const out: unknown[] = []
    const original = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string) => { out.push(JSON.parse(chunk)); return true }) as typeof process.stdout.write
    try {
      await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
      await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })
      await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Bash', input: { command: 'ls' } } } }, async (tool, input) => ({ behavior: 'allow', updatedInput: { ...input, seen: tool } }))
      await handleMessage({ jsonrpc: '2.0', id: 4, method: 'unknown/method' })
    } finally {
      process.stdout.write = original
    }
    expect(out[0]).toMatchObject({ id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } })
    expect(out[1]).toMatchObject({ id: 2, result: { tools: [{ name: 'approve' }] } })
    expect(out[2]).toEqual({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: JSON.stringify({ behavior: 'allow', updatedInput: { command: 'ls', seen: 'Bash' } }) }] } })
    expect(out[3]).toMatchObject({ id: 4, error: { code: -32601 } })
  })
})

describe('CLI arguments', () => {
  const base = { prompt: 'x', cwd: '/tmp', model: 'sonnet' as const, sessionId: '00000000-0000-4000-8000-000000000000', resume: false, webSearch: false }

  it('asks through the permission tool in ask mode', () => {
    const args = buildClaudeArgs({ ...base, permissionMode: 'ask' }, '/tmp/mcp.json')
    expect(args).toContain('--permission-prompt-tool')
    expect(args[args.indexOf('--permission-prompt-tool') + 1]).toBe(PERMISSION_TOOL)
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('default')
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('WebSearch,WebFetch')
  })

  it('accepts edits automatically only in acceptEdits mode', () => {
    const args = buildClaudeArgs({ ...base, permissionMode: 'acceptEdits', webSearch: true }, '/tmp/mcp.json')
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits')
    expect(args).not.toContain('--disallowedTools')
  })

  it('stays read-only in plan mode or without a bridge', () => {
    for (const args of [buildClaudeArgs({ ...base, permissionMode: 'plan' }, '/tmp/mcp.json'), buildClaudeArgs({ ...base, permissionMode: 'ask' })]) {
      expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan')
      expect(args).not.toContain('--permission-prompt-tool')
    }
  })
})

describe('chat stream with owner approval', () => {
  let directory: string
  let server: Server
  let base: string
  let database: ReturnType<typeof openDatabase>
  const saved = new Map<string, string | undefined>()
  const setEnv = (key: string, value: string) => { if (!saved.has(key)) saved.set(key, process.env[key]); process.env[key] = value }

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'polar-permission-test-'))
    const config = join(directory, 'cli-config')
    mkdirSync(config, { recursive: true, mode: 0o700 })
    writeFileSync(join(config, '.credentials.json'), '{}', { mode: 0o600 })
    // Фальшивый CLI ведёт себя как Claude Code с --permission-prompt-tool:
    // читает mcp-config и сам спрашивает разрешение у внутреннего маршрута.
    const fake = join(directory, 'fake-claude.cjs')
    writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs'); const http = require('node:http')
if (process.argv.includes('--version')) { process.stdout.write('2.1.test\\n'); process.exit(0) }
const session = process.argv[process.argv.indexOf('--session-id') + 1]
const cfg = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--mcp-config') + 1], 'utf8')).mcpServers.polar.env
process.stdin.resume(); process.stdin.on('end', () => {
  const emit = item => process.stdout.write(JSON.stringify(item) + '\\n')
  emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'touch created.txt' } }] } })
  const url = new URL(cfg.POLAR_PERMISSION_URL)
  const body = JSON.stringify({ tool_name: 'Bash', input: { command: 'touch created.txt' } })
  const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.POLAR_RUN_TOKEN } }, res => {
    let raw = ''; res.on('data', c => raw += c); res.on('end', () => {
      const decision = JSON.parse(raw).behavior
      emit({ type: 'stream_event', event: { delta: { type: 'text_delta', text: 'decision=' + decision } } })
      emit({ type: 'result', session_id: session, usage: { input_tokens: 1, output_tokens: 1 }, result: 'ok', is_error: false })
    })
  })
  req.end(body)
})
`)
    chmodSync(fake, 0o700)
    setEnv('CLAUDE_ENABLED', '1')
    setEnv('CLAUDE_BIN', fake)
    setEnv('CLAUDE_CONFIG_DIR', config)
    setEnv('SESSION_COOKIE_SECURE', '0')
    database = openDatabase(':memory:')
    server = createServer(createApp(database))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    const projects = database.prepare('SELECT workspace_path FROM projects').all() as { workspace_path: string }[]
    for (const project of projects) rmSync(project.workspace_path, { recursive: true, force: true })
    database.close()
    rmSync(directory, { recursive: true, force: true })
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    saved.clear()
  })

  for (const decision of ['allow', 'deny'] as const) {
    it(`relays the owner's ${decision} to the CLI and records the step`, async () => {
      const setup = await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: 'a-long-passphrase-42' }) })
      const cookie = (setup.headers.get('set-cookie') ?? '').split(';')[0]
      const { csrfToken } = await setup.json() as { csrfToken: string }
      const headers = { 'content-type': 'application/json', cookie, 'x-csrf-token': csrfToken }
      const created = await (await fetch(`${base}/api/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'Approvals' }) })).json() as { project: { id: string; sessions: { id: string }[] } }
      const projectId = created.project.id
      const sessionId = created.project.sessions[0].id

      // Внутренний маршрут без токена закрыт.
      expect((await fetch(`${base}/_internal/claude/permission`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(403)

      const stream = await fetch(`${base}/api/claude/stream`, { method: 'POST', headers, body: JSON.stringify({ projectId, sessionId, content: 'создай файл', permissionMode: 'ask' }) })
      expect(stream.status).toBe(200)
      const reader = stream.body!.getReader()
      const decoder = new TextDecoder()
      let text = ''
      let decided = false
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        const match = /event: permission\ndata: (.+)\n/.exec(text)
        if (match && !decided) {
          decided = true
          const request = JSON.parse(match[1]) as { id: string; tool: string; summary: string }
          expect(request).toMatchObject({ tool: 'Bash', summary: 'touch created.txt' })
          const answer = await fetch(`${base}/api/claude/permissions/${request.id}`, { method: 'POST', headers, body: JSON.stringify({ sessionId, decision }) })
          expect(answer.status).toBe(200)
        }
      }
      expect(text).toContain(`decision=${decision}`)
      expect(text).toContain('event: permission_resolved')
      expect(text).toContain('event: done')
      const history = await (await fetch(`${base}/api/projects/${projectId}/sessions/${sessionId}/messages`, { headers })).json() as { messages: { role: string; content: unknown }[] }
      const assistant = history.messages.find(message => message.role === 'assistant')
      expect(assistant?.content).toEqual([{ type: 'tool_use', name: 'Bash', summary: 'touch created.txt' }, { type: 'text', text: `decision=${decision}` }])
    }, 20_000)
  }
})
