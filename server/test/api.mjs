// Проверка Polar Workspace: API + SSE + WebSocket + статика.
import http from 'node:http'
import crypto from 'node:crypto'

const BASE = process.env.BASE || 'http://127.0.0.1:8799'
const results = []
const ok = (name, extra = '') => results.push('PASS ' + name + (extra ? ' — ' + extra : ''))
const bad = (name, extra = '') => results.push('FAIL ' + name + (extra ? ' — ' + extra : ''))

let cookie = ''
let csrf = ''
async function call(path, options = {}) {
  const headers = { ...(options.headers || {}) }
  if (cookie) headers.cookie = cookie
  if (options.method && options.method !== 'GET' && csrf) headers['x-csrf-token'] = csrf
  if (options.body) headers['content-type'] = 'application/json'
  const response = await fetch(BASE + path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined })
  const setCookie = response.headers.getSetCookie?.() || []
  if (setCookie.length) cookie = setCookie[0].split(';')[0]
  const text = await response.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* не JSON */ }
  return { status: response.status, json, text }
}

// 1. health + auth
const health = await call('/api/health')
health.json?.ok ? ok('health', 'claude.installed=' + health.json.claude.installed) : bad('health', health.text.slice(0, 120))
const anon = await call('/api/projects')
anon.status === 401 ? ok('анонимный доступ закрыт') : bad('анонимный доступ', String(anon.status))
const setup = await call('/api/auth/setup', { method: 'POST', body: { username: 'owner', password: 'polar-test-123' } })
csrf = setup.json?.csrfToken || ''
setup.status === 200 && csrf ? ok('создание владельца', 'csrf получен') : bad('создание владельца', setup.text.slice(0, 160))
const csrfFail = await fetch(BASE + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': 'wrong' }, body: JSON.stringify({ name: 'x' }) })
csrfFail.status === 403 ? ok('CSRF отбивает чужой токен') : bad('CSRF', String(csrfFail.status))

// 2. проекты
const created = await call('/api/projects', { method: 'POST', body: { name: 'demo-project', description: 'проверка' } })
const project = created.json?.project
project?.id ? ok('создан проект', project.name + ', сессий: ' + project.sessions.length) : bad('создание проекта', created.text.slice(0, 160))
const sessionId = project?.sessions?.[0]?.id
const projects = await call('/api/projects')
projects.json?.projects?.length === 1 ? ok('список проектов') : bad('список проектов', JSON.stringify(projects.json).slice(0, 120))

// 3. файлы
await call('/api/projects/' + project.id + '/file', { method: 'PUT', body: { path: 'src/hello.ts', content: 'export const hello = 1' + String.fromCharCode(10) } })
const files = await call('/api/projects/' + project.id + '/files')
const listed = (files.json?.files || []).map(f => f.path)
listed.includes('src/hello.ts') ? ok('файл записан и виден', listed.join(', ')) : bad('файлы', JSON.stringify(listed))
const read = await call('/api/projects/' + project.id + '/file?path=src/hello.ts')
read.json?.content?.includes('hello') ? ok('файл прочитан', 'language=' + read.json.language) : bad('чтение файла', read.text.slice(0, 120))
const escape = await call('/api/projects/' + project.id + '/file?path=../../etc/passwd')
escape.status === 400 ? ok('path traversal закрыт') : bad('path traversal', String(escape.status))

// 4. git
const gitBefore = await call('/api/projects/' + project.id + '/git/status')
gitBefore.json?.initialized === false ? ok('git до init — честно не инициализирован') : bad('git before', JSON.stringify(gitBefore.json))
const gitInit = await call('/api/projects/' + project.id + '/git/init', { method: 'POST', body: {} })
gitInit.json?.initialized ? ok('git init', 'branch=' + gitInit.json.branch) : bad('git init', gitInit.text.slice(0, 160))
const gitStatus = await call('/api/projects/' + project.id + '/git/status')
ok('git status', 'изменений: ' + (gitStatus.json?.changes?.length ?? '?'))

// 5. поток Claude (SSE) через фейковый CLI
const streamResponse = await fetch(BASE + '/api/claude/stream', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf },
  body: JSON.stringify({ projectId: project.id, sessionId, content: 'Проверка потока', model: 'sonnet', webSearch: false, contextFiles: [] }),
})
const sseText = await streamResponse.text()
const events = [...sseText.matchAll(/event: ([a-z]+)/g)].map(m => m[1])
const delta = [...sseText.matchAll(/event: delta\ndata: (.*)/g)].map(m => JSON.parse(m[1]).text).join('')
const hasDone = events.includes('done')
const hasActivity = events.includes('activity')
const answer = delta.includes('фейкового CLI') && delta.includes('Файлы в порядке')
answer && hasDone && hasActivity
  ? ok('SSE-поток Claude', 'events=' + [...new Set(events)].join('/') + '; текст=' + delta.slice(0, 48))
  : bad('SSE-поток', 'events=' + events.join('/') + '; delta=' + delta.slice(0, 80))
const saved = await call('/api/projects/' + project.id + '/sessions/' + sessionId + '/messages')
saved.json?.messages?.length === 2 ? ok('история сохранена', 'роли: ' + saved.json.messages.map(m => m.role).join(',')) : bad('история', JSON.stringify(saved.json).slice(0, 160))
const search = await call('/api/claude/search?q=фейкового')
search.json?.results?.length === 1 ? ok('поиск по истории') : bad('поиск', JSON.stringify(search.json).slice(0, 120))

// 6. терминал: сессия + WebSocket
const term = await call('/api/terminal/sessions', { method: 'POST', body: { projectId: project.id } })
const terminalId = term.json?.session?.id
if (!terminalId) bad('терминал: сессия', term.text.slice(0, 160))
else {
  const socket = await wsConnect('/ws/terminal/' + terminalId, cookie)
  if (!socket) bad('терминал: WebSocket не подключился')
  else {
    const output = []
    socket.onMessage(frame => { try { const payload = JSON.parse(frame); if (payload.type === 'output') output.push(payload.data) } catch { /* ignore */ } })
    socket.send(JSON.stringify({ type: 'input', data: 'echo polar-terminal-ok' + String.fromCharCode(10) }))
    await new Promise(resolve => setTimeout(resolve, 1200))
    const text = output.join('')
    text.includes('polar-terminal-ok') ? ok('терминал: команда выполнена', JSON.stringify(text.trim().slice(-40))) : bad('терминал: вывод', JSON.stringify(text.slice(-120)))
    socket.close()
    await call('/api/terminal/sessions/' + terminalId, { method: 'DELETE' })
  }
}

// 7. статика
const page = await call('/')
page.status === 200 && page.text.includes('Polar Workspace') ? ok('собранный фронтенд раздаётся') : bad('статика', String(page.status) + ' ' + page.text.slice(0, 80))
const logout = await call('/api/auth/logout', { method: 'POST' })
logout.status === 200 ? ok('выход') : bad('выход', String(logout.status))
const after = await call('/api/projects')
after.status === 401 ? ok('после выхода доступ закрыт') : bad('после выхода', String(after.status))

console.log(results.join(String.fromCharCode(10)))
console.log(String.fromCharCode(10) + 'ИТОГО: ' + results.filter(r => r.startsWith('PASS')).length + ' PASS / ' + results.filter(r => r.startsWith('FAIL')).length + ' FAIL')
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0)

// --- минимальный WebSocket-клиент (клиентские кадры маскируются) ---
function wsConnect(path, cookieHeader) {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString('base64')
    const req = http.request({ host: '127.0.0.1', port: Number(new global.URL(BASE).port), path, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': 13, cookie: cookieHeader } })
    req.on('upgrade', (_res, socket) => {
      let buffer = Buffer.alloc(0)
      const listeners = []
      socket.on('data', (chunk) => { buffer = Buffer.concat([buffer, chunk]); buffer = drain(buffer, listeners) })
      resolve({ send: (text) => socket.write(maskedFrame(text)), onMessage: (fn) => listeners.push(fn), close: () => socket.end() })
    })
    req.on('error', () => resolve(null))
    req.end()
  })
}
function maskedFrame(text) {
  const payload = Buffer.from(text, 'utf8')
  const mask = crypto.randomBytes(4)
  const header = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length]) : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff])
  const masked = Buffer.from(payload)
  for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i % 4]
  return Buffer.concat([header, mask, masked])
}
function drain(buffer, listeners) {
  for (;;) {
    if (buffer.length < 2) return buffer
    const opcode = buffer[0] & 0x0f
    let length = buffer[1] & 0x7f
    let offset = 2
    if (length === 126) { if (buffer.length < 4) return buffer; length = buffer.readUInt16BE(2); offset = 4 }
    if (buffer.length < offset + length) return buffer
    const payload = buffer.subarray(offset, offset + length)
    buffer = buffer.subarray(offset + length)
    if (opcode === 0x1) { const text = payload.toString('utf8'); for (const fn of listeners) fn(text) }
    if (opcode === 0x8) return Buffer.alloc(0)
  }
}
