#!/usr/bin/env node
/**
 * Polar Workspace — единый сервер: API + WebSocket терминала + статика собранного фронтенда.
 *
 * Один процесс, без внешних зависимостей (нужен только Node >= 22):
 *   node server/index.mjs  ->  http://127.0.0.1:8787
 *
 * Всё настоящее: официальный Claude Code CLI (подписочный вход), файлы, git, shell.
 * Авторизация: единственный владелец (первичная регистрация), cookie-сессия + CSRF.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, '.data'));
const WORKSPACES_DIR = path.resolve(process.env.WORKSPACES_DIR || path.join(ROOT, 'workspaces'));
const DIST_DIR = path.join(ROOT, 'dist');
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE = 'polar_session';
const MAX_BODY = 2 * 1024 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.data', 'dist', '.cache']);
const SECRET_FILE = /(^|[/])(\.env(\..*)?|\.credentials\.json|.*\.(pem|key|p12|keystore))$/i;

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(WORKSPACES_DIR, { recursive: true, mode: 0o700 });

/* ------------------------------------------------------------------ база */
const db = new DatabaseSync(path.join(DATA_DIR, 'polar.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec([
  'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT "", instructions TEXT NOT NULL DEFAULT "", default_model TEXT NOT NULL DEFAULT "sonnet", dir TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER)',
  'CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, model TEXT NOT NULL DEFAULT "sonnet", status TEXT NOT NULL DEFAULT "idle", agent_session_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER)',
  'CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content_json TEXT NOT NULL, created_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, created_at)',
].map(statement => statement + ';').join('\n'));
db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(Date.now());

const now = () => Date.now();
const uid = () => crypto.randomUUID();
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return 'scrypt\$' + salt.toString('base64') + '\$' + derived.toString('base64');
};
const verifyPassword = (password, stored) => {
  const parts = String(stored).split('\$');
  if (parts[0] !== 'scrypt' || !parts[1] || !parts[2]) return false;
  const derived = crypto.scryptSync(password, Buffer.from(parts[1], 'base64'), 64);
  const expected = Buffer.from(parts[2], 'base64');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
};

/* --------------------------------------------------------------- сессии */
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO auth_sessions (token_hash,user_id,csrf,created_at,expires_at) VALUES (?,?,?,?,?)')
    .run(sha(token), userId, csrf, now(), now() + SESSION_TTL_MS);
  return { token, csrf };
}
function readCookies(req) {
  const header = req.headers.cookie || '';
  const jar = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}
function currentUser(req) {
  const token = readCookies(req)[COOKIE];
  if (!token) return null;
  const row = db.prepare('SELECT s.user_id AS userId, s.csrf, u.username FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?')
    .get(sha(token), now());
  return row || null;
}
function dropSession(req) {
  const token = readCookies(req)[COOKIE];
  if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(sha(token));
}

/* ----------------------------------------------------------- утилиты API */
const send = (res, code, payload, headers = {}) => {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
};
const fail = (res, code, error, message) => send(res, code, { error, message });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Слишком большой запрос'), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(Object.assign(new Error('Некорректный JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

/* -------------------------------------------------------------- проекты */
const projectRow = (row) => ({
  id: row.id, name: row.name, description: row.description, instructions: row.instructions,
  defaultModel: row.default_model, createdAt: row.created_at, updatedAt: row.updated_at,
});
const sessionRow = (row) => ({
  id: row.id, title: row.title, model: row.model, status: row.status, archived: Boolean(row.archived_at),
  createdAt: row.created_at, updatedAt: row.updated_at,
});
function getProject(id) {
  const row = db.prepare('SELECT * FROM projects WHERE id=? AND archived_at IS NULL').get(id);
  if (!row) throw Object.assign(new Error('Проект не найден'), { status: 404, code: 'project_not_found' });
  return row;
}
function projectsPayload() {
  const projects = db.prepare('SELECT * FROM projects WHERE archived_at IS NULL ORDER BY updated_at DESC').all();
  const sessionsStmt = db.prepare('SELECT * FROM conversations WHERE project_id=? AND archived_at IS NULL ORDER BY updated_at DESC');
  return projects.map((row) => ({ ...projectRow(row), sessions: sessionsStmt.all(row.id).map(sessionRow) }));
}
function projectPayload(id) {
  const row = getProject(id);
  const sessions = db.prepare('SELECT * FROM conversations WHERE project_id=? AND archived_at IS NULL ORDER BY updated_at DESC').all(id);
  return { ...projectRow(row), sessions: sessions.map(sessionRow) };
}
const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi, '-').replace(/^-+|-+$/, '').slice(0, 40) || 'project';
function projectDir(row) {
  const dir = path.join(WORKSPACES_DIR, row.dir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function touchProject(id) { db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(now(), id); }

/* ----------------------------------------------------------- файлы */
function safePath(rootDir, relative) {
  const cleaned = String(relative || '').split(String.fromCharCode(92)).join('/').replace(/^[/]+/, '');
  const target = path.resolve(rootDir, cleaned);
  if (target !== rootDir && !target.startsWith(rootDir + path.sep)) {
    throw Object.assign(new Error('Путь вне проекта'), { status: 400, code: 'path_escape' });
  }
  return target;
}
const LANGUAGES = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  json: 'json', css: 'css', scss: 'scss', html: 'html', md: 'markdown', py: 'python', rs: 'rust',
  go: 'go', java: 'java', kt: 'kotlin', sh: 'shell', yml: 'yaml', yaml: 'yaml', sql: 'sql', svg: 'xml', txt: 'text',
};
const languageOf = (file) => LANGUAGES[path.extname(file).slice(1).toLowerCase()] || 'text';
async function listFiles(rootDir, prefix = '') {
  const out = [];
  let entries = [];
  try { entries = await fsp.readdir(path.join(rootDir, prefix), { withFileTypes: true }); } catch { return out; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push({ path: relative, kind: 'folder' });
      out.push(...await listFiles(rootDir, relative));
    } else if (entry.isFile()) {
      if (SECRET_FILE.test(relative)) continue;
      let size = 0;
      try { size = (await fsp.stat(path.join(rootDir, relative))).size; } catch { /* ignore */ }
      out.push({ path: relative, kind: 'file', language: languageOf(entry.name), size });
    }
  }
  return out;
}

/* ----------------------------------------------------------------- git */
function git(dir, args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
  return { code: result.status === null ? 1 : result.status, out: (result.stdout || '').trim(), err: (result.stderr || '').trim() };
}
const gitRepo = (dir) => fs.existsSync(path.join(dir, '.git'));
function gitStatusPayload(dir) {
  if (!gitRepo(dir)) return { initialized: false, branch: 'main', changes: [] };
  const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).out || 'main';
  const porcelain = git(dir, ['status', '--porcelain']).out;
  const changes = [];
  for (const line of porcelain.split('\n')) {
    if (!line.trim()) continue;
    const index = line[0];
    const worktree = line[1];
    const file = line.slice(3).trim().replace(/^"|"$/, '');
    const staged = index !== ' ' && index !== '?';
    const unstaged = worktree !== ' ';
    const kind = index === '?' ? 'A' : (index !== ' ' ? index : worktree);
    changes.push({ path: file, kind, staged, unstaged });
  }
  return { initialized: true, branch, changes };
}

/* --------------------------------------------------------------- Claude */
let cliCache = { at: 0, value: null };
function cliStatus() {
  if (cliCache.value && now() - cliCache.at < 30000) return cliCache.value;
  const which = spawnSync('sh', ['-lc', 'command -v ' + CLAUDE_BIN], { encoding: 'utf8' });
  const installed = which.status === 0 && Boolean((which.stdout || '').trim());
  let version = null;
  if (installed) {
    const probe = spawnSync(CLAUDE_BIN, ['--version'], { encoding: 'utf8', timeout: 15000 });
    version = ((probe.stdout || '').trim().split('\n')[0]) || null;
  }
  const loginFile = path.join(os.homedir(), '.claude', '.credentials.json');
  const value = {
    enabled: true, installed, version,
    loginFilePresent: fs.existsSync(loginFile) || Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN) || Boolean(process.env.ANTHROPIC_API_KEY),
    webSearchAvailable: installed, binary: CLAUDE_BIN,
  };
  cliCache = { at: now(), value };
  return value;
}
function saveMessage(conversationId, role, content) {
  const id = uid();
  db.prepare('INSERT INTO messages (id,conversation_id,role,content_json,created_at) VALUES (?,?,?,?,?)')
    .run(id, conversationId, role, JSON.stringify(content), now());
  db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(now(), conversationId);
  return id;
}
const sse = (res, event, data) => { if (!res.writableEnded) res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); };

function streamClaude(req, res, body) {
  const project = getProject(String(body.projectId || ''));
  const conversation = db.prepare('SELECT * FROM conversations WHERE id=? AND project_id=?').get(String(body.sessionId || ''), project.id);
  if (!conversation) return fail(res, 404, 'session_not_found', 'Сессия не найдена.');
  const prompt = String(body.content || '').trim();
  if (!prompt) return fail(res, 400, 'empty_prompt', 'Пустой запрос.');
  const model = ['sonnet', 'opus', 'haiku'].includes(body.model) ? body.model : 'sonnet';
  const contextFiles = Array.isArray(body.contextFiles) ? body.contextFiles.slice(0, 32).map(String) : [];
  const dir = projectDir(project);

  const userMessageId = saveMessage(conversation.id, 'user', prompt);
  db.prepare('UPDATE conversations SET status=?, model=?, updated_at=?, title=CASE WHEN title=? THEN ? ELSE title END WHERE id=?')
    .run('working', model, now(), 'Новый чат', prompt.slice(0, 60), conversation.id);
  touchProject(project.id);

  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', model,
    '--permission-mode', process.env.CLAUDE_PERMISSION_MODE || 'acceptEdits'];
  if (conversation.agent_session_id) args.push('--resume', conversation.agent_session_id);

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
    connection: 'keep-alive', 'x-accel-buffering': 'no',
  });
  const prefix = contextFiles.length ? 'Контекст проекта (файлы): ' + contextFiles.join(', ') + '\n\n' : '';
  let cliSessionId = conversation.agent_session_id || null;
  let text = '';
  let usage = { inputTokens: 0, outputTokens: 0 };
  let buffer = '';
  let finished = false;

  sse(res, 'started', { userMessageId, sessionId: conversation.id, cliSessionId, model });

  const child = spawn(CLAUDE_BIN, args, { cwd: dir, env: process.env });
  child.stdin.end(prefix + prompt);

  const handle = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event;
    try { event = JSON.parse(trimmed); } catch { return; }
    if (event.session_id) cliSessionId = event.session_id;
    if (event.type === 'system' && event.subtype === 'init') {
      db.prepare('UPDATE conversations SET agent_session_id=? WHERE id=?').run(cliSessionId, conversation.id);
      sse(res, 'started', { userMessageId, sessionId: conversation.id, cliSessionId, model });
      return;
    }
    if (event.type === 'assistant' && event.message) {
      for (const block of event.message.content || []) {
        if (block.type === 'text' && block.text) { text += block.text; sse(res, 'delta', { text: block.text }); }
        if (block.type === 'tool_use') sse(res, 'activity', { tool: String(block.name || 'tool') });
      }
      if (event.message.usage) {
        usage = { inputTokens: event.message.usage.input_tokens || usage.inputTokens, outputTokens: event.message.usage.output_tokens || usage.outputTokens };
      }
      return;
    }
    if (event.type === 'result') {
      if (typeof event.result === 'string' && event.result && !text) { text += event.result; sse(res, 'delta', { text: event.result }); }
      if (event.usage) usage = { inputTokens: event.usage.input_tokens || usage.inputTokens, outputTokens: event.usage.output_tokens || usage.outputTokens };
      if (cliSessionId) db.prepare('UPDATE conversations SET agent_session_id=? WHERE id=?').run(cliSessionId, conversation.id);
    }
  };

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) handle(line);
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.on('error', (error) => {
    if (finished) return;
    finished = true;
    db.prepare('UPDATE conversations SET status=? WHERE id=?').run('error', conversation.id);
    sse(res, 'error', { code: 'cli_spawn_failed', message: 'Не удалось запустить Claude Code: ' + error.message });
    res.end();
  });
  child.on('close', (code) => {
    if (finished) return;
    finished = true;
    if (buffer.trim()) handle(buffer);
    if (text) {
      saveMessage(conversation.id, 'assistant', [{ type: 'text', text }]);
      db.prepare('UPDATE conversations SET status=?, agent_session_id=COALESCE(?,agent_session_id), updated_at=? WHERE id=?')
        .run('idle', cliSessionId, now(), conversation.id);
      sse(res, 'done', { sessionId: conversation.id, cliSessionId, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    } else {
      db.prepare('UPDATE conversations SET status=? WHERE id=?').run('error', conversation.id);
      const message = code === 0
        ? 'Claude Code завершился без ответа.'
        : (stderr.trim().split('\n').slice(-3).join(' ') || ('Claude Code завершился с кодом ' + code + '. Установлен ли CLI и выполнен ли вход?'));
      sse(res, 'error', { code: 'cli_failed', message });
    }
    res.end();
  });
  req.on('close', () => { if (!finished) { finished = true; child.kill('SIGTERM'); } });
}

/* ------------------------------------------------------------ терминалы */
const terminals = new Map();
const broadcast = (session, payload) => {
  const frame = encodeFrame(JSON.stringify(payload));
  for (const socket of session.sockets) { try { socket.write(frame); } catch { /* ignore */ } }
};
function createTerminal(project) {
  const dir = projectDir(project);
  const shell = process.env.SHELL || 'bash';
  const child = spawn(shell, ['-i'], { cwd: dir, env: { ...process.env, TERM: 'xterm-256color', PS1: '$ ' } });
  const session = { id: uid(), projectId: project.id, createdAt: now(), child, sockets: new Set() };
  child.stdout.on('data', (chunk) => broadcast(session, { type: 'output', data: chunk.toString() }));
  child.stderr.on('data', (chunk) => broadcast(session, { type: 'output', data: chunk.toString() }));
  child.on('close', (code) => { broadcast(session, { type: 'exit', code }); terminals.delete(session.id); });
  terminals.set(session.id, session);
  return session;
}

/* ------------------------------------------------------------- WebSocket */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const length = payload.length;
  let header;
  if (length < 126) { header = Buffer.from([0x81, length]); }
  else if (length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2); }
  return Buffer.concat([header, payload]);
}
function decodeFrames(state, chunk) {
  state.buffer = Buffer.concat([state.buffer, chunk]);
  const messages = [];
  for (;;) {
    const buffer = state.buffer;
    if (buffer.length < 2) break;
    const opcode = buffer[0] & 0x0f;
    const isFinal = (buffer[0] & 0x80) !== 0;
    const masked = (buffer[1] & 0x80) !== 0;
    let length = buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) { if (buffer.length < 4) break; length = buffer.readUInt16BE(2); offset = 4; }
    else if (length === 127) { if (buffer.length < 10) break; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
    const maskLength = masked ? 4 : 0;
    if (buffer.length < offset + maskLength + length) break;
    const mask = masked ? buffer.subarray(offset, offset + 4) : null;
    const start = offset + maskLength;
    const payload = Buffer.from(buffer.subarray(start, start + length));
    if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    state.buffer = buffer.subarray(start + length);
    if (opcode === 0x8) { messages.push({ type: 'close' }); break; }
    if (opcode === 0x9) { messages.push({ type: 'ping' }); continue; }
    if (opcode === 0x1 || opcode === 0x0) {
      state.fragments.push(payload);
      if (!isFinal) continue;
      const text = Buffer.concat(state.fragments).toString('utf8');
      state.fragments = [];
      messages.push({ type: 'text', text });
    }
  }
  return messages;
}
function onSocketMessage(session, socket, message) {
  if (message.type === 'ping') { socket.write(encodeFrame('')); return; }
  if (message.type === 'close') { socket.end(); return; }
  if (message.type !== 'text') return;
  try {
    const payload = JSON.parse(message.text);
    if (payload.type === 'input' && typeof payload.data === 'string') session.child.stdin.write(payload.data);
  } catch { /* ignore malformed frame */ }
}
function upgradeTerminal(req, socket, head, terminalId) {
  const session = terminals.get(terminalId);
  const key = req.headers['sec-websocket-key'];
  if (!key || !session) { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const state = { buffer: Buffer.alloc(0), fragments: [] };
  session.sockets.add(socket);
  if (head && head.length) for (const message of decodeFrames(state, head)) onSocketMessage(session, socket, message);
  socket.on('data', (chunk) => { for (const message of decodeFrames(state, chunk)) onSocketMessage(session, socket, message); });
  socket.on('close', () => session.sockets.delete(socket));
  socket.on('error', () => session.sockets.delete(socket));
}

/* --------------------------------------------------------------- роутер */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const attempts = new Map();
function rateLimited(key) {
  const entry = attempts.get(key) || { count: 0, at: now() };
  if (now() - entry.at > 15 * 60 * 1000) { entry.count = 0; entry.at = now(); }
  entry.count += 1;
  attempts.set(key, entry);
  return entry.count > 12;
}
let loginChild = null;

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method || 'GET';

  if (p === '/api/health') return send(res, 200, { ok: true, workspace: WORKSPACES_DIR, claude: cliStatus(), pid: process.pid });

  if (p === '/api/auth/status') {
    const user = currentUser(req);
    return send(res, 200, {
      initialized: Boolean(db.prepare('SELECT id FROM users LIMIT 1').get()),
      authenticated: Boolean(user), username: user ? user.username : undefined, csrfToken: user ? user.csrf : undefined,
    });
  }
  if (p === '/api/auth/setup' && method === 'POST') {
    if (db.prepare('SELECT id FROM users LIMIT 1').get()) return fail(res, 409, 'already_initialized', 'Владелец уже создан. Войдите.');
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (username.length < 3) return fail(res, 400, 'bad_username', 'Логин минимум 3 символа.');
    if (password.length < 8) return fail(res, 400, 'bad_password', 'Пароль минимум 8 символов.');
    const id = uid();
    db.prepare('INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)').run(id, username, hashPassword(password), now());
    const session = createSession(id);
    return send(res, 200, { username, csrfToken: session.csrf }, { 'set-cookie': COOKIE + '=' + session.token + '; HttpOnly; Path=/; SameSite=Lax; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000) });
  }
  if (p === '/api/auth/login' && method === 'POST') {
    if (rateLimited('login:' + (req.socket.remoteAddress || 'local'))) return fail(res, 429, 'rate_limited', 'Слишком много попыток входа. Подождите.');
    const body = await readBody(req);
    const row = db.prepare('SELECT * FROM users WHERE username=?').get(String(body.username || '').trim());
    if (!row || !verifyPassword(String(body.password || ''), row.password_hash)) return fail(res, 401, 'bad_credentials', 'Неверный логин или пароль.');
    const session = createSession(row.id);
    return send(res, 200, { username: row.username, csrfToken: session.csrf }, { 'set-cookie': COOKIE + '=' + session.token + '; HttpOnly; Path=/; SameSite=Lax; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000) });
  }
  if (p === '/api/auth/logout' && method === 'POST') { dropSession(req); return send(res, 200, { ok: true }); }

  const user = currentUser(req);
  if (!user) return fail(res, 401, 'unauthorized', 'Требуется вход.');
  if (MUTATING.has(method) && req.headers['x-csrf-token'] !== user.csrf) return fail(res, 403, 'csrf_failed', 'Недействительный CSRF-токен. Обновите страницу.');

  if (p === '/api/claude/status') return send(res, 200, cliStatus());

  if (p === '/api/claude/search') {
    const query = String(url.searchParams.get('q') || '').trim().slice(0, 120);
    if (query.length < 2) return send(res, 200, { results: [] });
    const rows = db.prepare('SELECT m.id, m.role, m.content_json, m.created_at, c.id AS session_id, c.title AS session_title, p.id AS project_id, p.name AS project_name FROM messages m JOIN conversations c ON c.id=m.conversation_id JOIN projects p ON p.id=c.project_id WHERE c.archived_at IS NULL AND instr(lower(m.content_json), lower(?)) > 0 ORDER BY m.created_at DESC LIMIT 40').all(query);
    const results = rows.map((row) => {
      let text = '';
      try {
        const value = JSON.parse(row.content_json);
        text = typeof value === 'string' ? value : Array.isArray(value) ? value.map((block) => (block && typeof block === 'object' && typeof block.text === 'string' ? block.text : '')).filter(Boolean).join('\n\n') : '';
      } catch { text = String(row.content_json); }
      const at = text.toLowerCase().indexOf(query.toLowerCase());
      const start = Math.max(0, at - 60);
      const snippet = (start > 0 ? '…' : '') + text.slice(start, start + 180) + (start + 180 < text.length ? '…' : '');
      return { id: row.id, role: row.role, snippet, createdAt: row.created_at, projectId: row.project_id, projectName: row.project_name, sessionId: row.session_id, sessionTitle: row.session_title };
    });
    return send(res, 200, { results });
  }

  if (p === '/api/claude/stream' && method === 'POST') return streamClaude(req, res, await readBody(req));

  if (p === '/api/claude/login' && method === 'POST') {
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
    const child = spawn(CLAUDE_BIN, ['setup-token'], { env: process.env });
    loginChild = child;
    const emit = (payload) => { if (!res.writableEnded) res.write(JSON.stringify(payload) + '\n'); };
    child.stdout.on('data', (chunk) => emit({ kind: 'out', text: chunk.toString() }));
    child.stderr.on('data', (chunk) => emit({ kind: 'err', text: chunk.toString() }));
    child.on('close', (code) => { loginChild = null; emit({ kind: 'exit', code }); res.end(); });
    child.on('error', (error) => { loginChild = null; emit({ kind: 'error', message: error.message }); res.end(); });
    return;
  }
  if (p === '/api/claude/login/input' && method === 'POST') {
    const body = await readBody(req);
    if (!loginChild) return fail(res, 409, 'no_login', 'Процесс входа не запущен.');
    loginChild.stdin.write(String(body.text || '') + '\n');
    return send(res, 200, { ok: true });
  }

  if (p === '/api/terminal/sessions') {
    if (method === 'GET') {
      const projectId = String(url.searchParams.get('projectId') || '');
      const sessions = [...terminals.values()].filter((session) => session.projectId === projectId)
        .map((session) => ({ id: session.id, projectId: session.projectId, createdAt: session.createdAt }));
      return send(res, 200, { sessions });
    }
    if (method === 'POST') {
      const body = await readBody(req);
      const project = getProject(String(body.projectId || ''));
      const session = createTerminal(project);
      return send(res, 200, { session: { id: session.id, projectId: session.projectId, createdAt: session.createdAt } });
    }
  }
  if (p.startsWith('/api/terminal/sessions/') && method === 'DELETE') {
    const id = decodeURIComponent(p.slice('/api/terminal/sessions/'.length));
    const session = terminals.get(id);
    if (session) { session.child.kill('SIGTERM'); terminals.delete(id); }
    return send(res, 204);
  }

  if (p === '/api/projects') {
    if (method === 'GET') return send(res, 200, { projects: projectsPayload() });
    if (method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim().slice(0, 64);
      if (!name) return fail(res, 400, 'bad_name', 'Название проекта обязательно.');
      const id = uid();
      let dir = slug(name);
      let suffix = 1;
      while (db.prepare('SELECT id FROM projects WHERE dir=?').get(dir)) dir = slug(name) + '-' + (suffix += 1);
      db.prepare('INSERT INTO projects (id,name,description,instructions,default_model,dir,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, name, String(body.description || '').slice(0, 500), '', 'sonnet', dir, now(), now());
      fs.mkdirSync(path.join(WORKSPACES_DIR, dir), { recursive: true });
      db.prepare('INSERT INTO conversations (id,project_id,title,model,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(uid(), id, 'Новый чат', 'sonnet', 'idle', now(), now());
      return send(res, 200, { project: projectPayload(id) });
    }
  }
  const projectMatch = p.match(/^[/]api[/]projects[/]([^/]+)([/].*)?$/);
  if (projectMatch) {
    const project = getProject(decodeURIComponent(projectMatch[1]));
    const rest = projectMatch[2] || '';
    const dir = projectDir(project);

    if (rest === '' && method === 'PATCH') {
      const body = await readBody(req);
      const fields = [];
      const values = [];
      for (const key of ['name', 'description', 'instructions', 'defaultModel']) {
        if (typeof body[key] === 'string') {
          const column = key === 'defaultModel' ? 'default_model' : key;
          fields.push(column + '=?');
          values.push(body[key].slice(0, key === 'instructions' ? 20000 : 500));
        }
      }
      if (fields.length) db.prepare('UPDATE projects SET ' + fields.join(', ') + ', updated_at=? WHERE id=?').run(...values, now(), project.id);
      return send(res, 200, { project: projectPayload(project.id) });
    }

    if (rest === '/sessions' && method === 'POST') {
      const body = await readBody(req);
      const title = String(body.title || 'Новый чат').slice(0, 120);
      const model = ['sonnet', 'opus', 'haiku'].includes(body.model) ? body.model : 'sonnet';
      const id = uid();
      db.prepare('INSERT INTO conversations (id,project_id,title,model,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, project.id, title, model, 'idle', now(), now());
      touchProject(project.id);
      return send(res, 200, { session: sessionRow(db.prepare('SELECT * FROM conversations WHERE id=?').get(id)) });
    }
    const sessionMatch = rest.match(/^[/]sessions[/]([^/]+)([/]messages)?$/);
    if (sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1]);
      const conversation = db.prepare('SELECT * FROM conversations WHERE id=? AND project_id=?').get(sessionId, project.id);
      if (!conversation) return fail(res, 404, 'session_not_found', 'Сессия не найдена.');
      if (sessionMatch[2] === '/messages' && method === 'GET') {
        const messages = db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at ASC LIMIT 500').all(sessionId)
          .map((row) => ({ id: row.id, role: row.role, content: JSON.parse(row.content_json), createdAt: row.created_at }));
        return send(res, 200, { messages });
      }
      if (method === 'PATCH') {
        const body = await readBody(req);
        if (typeof body.title === 'string') db.prepare('UPDATE conversations SET title=? WHERE id=?').run(body.title.slice(0, 120), sessionId);
        if (body.archived !== undefined) db.prepare('UPDATE conversations SET archived_at=? WHERE id=?').run(body.archived ? now() : null, sessionId);
        db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(now(), sessionId);
        return send(res, 200, { session: sessionRow(db.prepare('SELECT * FROM conversations WHERE id=?').get(sessionId)) });
      }
      if (method === 'DELETE') {
        db.prepare('UPDATE conversations SET archived_at=? WHERE id=?').run(now(), sessionId);
        return send(res, 204);
      }
    }

    if (rest === '/files' && method === 'GET') return send(res, 200, { files: await listFiles(dir) });
    if (rest === '/file') {
      if (method === 'GET') {
        const relative = url.searchParams.get('path') || '';
        if (SECRET_FILE.test(relative)) return fail(res, 403, 'forbidden_file', 'Файл закрыт.');
        const target = safePath(dir, relative);
        const stat = await fsp.stat(target).catch(() => null);
        if (!stat || !stat.isFile()) return fail(res, 404, 'file_not_found', 'Файл не найден.');
        if (stat.size > 2 * 1024 * 1024) return fail(res, 413, 'file_too_large', 'Файл больше 2 МБ.');
        const content = await fsp.readFile(target, 'utf8');
        return send(res, 200, { content, language: languageOf(relative) });
      }
      if (method === 'PUT') {
        const body = await readBody(req);
        const relative = String(body.path || '');
        if (SECRET_FILE.test(relative)) return fail(res, 403, 'forbidden_file', 'Файл закрыт.');
        const target = safePath(dir, relative);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, String(body.content === undefined ? '' : body.content), 'utf8');
        touchProject(project.id);
        return send(res, 200, { saved: true });
      }
    }

    if (rest === '/git/status' && method === 'GET') return send(res, 200, gitStatusPayload(dir));
    if (rest === '/git/init' && method === 'POST') {
      if (!gitRepo(dir)) {
        git(dir, ['init', '-b', 'main']);
        await fsp.writeFile(path.join(dir, '.gitignore'), 'node_modules/\n.data/\ndist/\n.env\n', 'utf8').catch(() => {});
        git(dir, ['add', '-A']);
        git(dir, ['-c', 'user.name=Polar Workspace', '-c', 'user.email=polar@localhost', 'commit', '-m', 'Initial commit']);
      }
      const status = gitStatusPayload(dir);
      return send(res, 200, { initialized: status.initialized, branch: status.branch });
    }
    if (rest === '/git/diff' && method === 'GET') {
      const relative = url.searchParams.get('path') || '';
      safePath(dir, relative);
      const staged = git(dir, ['diff', '--cached', '--', relative]).out;
      const untracked = gitRepo(dir) && git(dir, ['status', '--porcelain', '--', relative]).out.startsWith('??');
      const unstaged = untracked
        ? await fsp.readFile(safePath(dir, relative), 'utf8').catch(() => '')
        : git(dir, ['diff', '--', relative]).out;
      return send(res, 200, { staged, unstaged });
    }
    if (rest === '/git/stage' && method === 'POST') {
      const body = await readBody(req);
      safePath(dir, String(body.path || ''));
      git(dir, ['add', '--', String(body.path || '')]);
      return send(res, 200, { staged: true });
    }
    if (rest === '/git/unstage' && method === 'POST') {
      const body = await readBody(req);
      git(dir, ['reset', 'HEAD', '--', String(body.path || '')]);
      return send(res, 200, { staged: false });
    }
    if (rest === '/git/commit' && method === 'POST') {
      const body = await readBody(req);
      const message = String(body.message || '').trim();
      if (!message) return fail(res, 400, 'empty_message', 'Сообщение коммита обязательно.');
      const result = git(dir, ['-c', 'user.name=Polar Workspace', '-c', 'user.email=polar@localhost', 'commit', '-m', message]);
      if (result.code !== 0) return fail(res, 400, 'commit_failed', result.err || result.out || 'Коммит не создан.');
      const hash = git(dir, ['rev-parse', '--short', 'HEAD']).out;
      touchProject(project.id);
      return send(res, 200, { hash, message });
    }
  }
  return fail(res, 404, 'not_found', 'Маршрут не найден: ' + p);
}

/* --------------------------------------------------------------- статика */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8' };
async function serveStatic(req, res, url) {
  const relative = decodeURIComponent(url.pathname).replace(/^[/]+/, '');
  let target = path.resolve(DIST_DIR, relative || 'index.html');
  if (!target.startsWith(DIST_DIR)) return fail(res, 400, 'bad_path', 'Некорректный путь.');
  let stat = await fsp.stat(target).catch(() => null);
  if (!stat || stat.isDirectory()) { target = path.join(DIST_DIR, 'index.html'); stat = await fsp.stat(target).catch(() => null); }
  if (!stat) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end('<h1>Polar Workspace</h1><p>Фронтенд не собран. Выполните <code>npm run build</code> и перезапустите сервер.</p>');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream', 'cache-control': path.basename(target) === 'index.html' ? 'no-store' : 'public, max-age=3600' });
  fs.createReadStream(target).pipe(res);
}

/* --------------------------------------------------------------- сервер */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('[polar]', error);
    return fail(res, status, error.code || 'server_error', error.message || 'Внутренняя ошибка.');
  }
});
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const match = url.pathname.match(/^[/]ws[/]terminal[/]([^/]+)$/);
  if (!match) { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
  if (!currentUser(req)) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
  upgradeTerminal(req, socket, head, decodeURIComponent(match[1]));
});
process.on('SIGINT', () => { for (const session of terminals.values()) session.child.kill('SIGTERM'); server.close(() => process.exit(0)); });
server.listen(PORT, HOST, () => {
  const status = cliStatus();
  console.log('[polar] http://' + HOST + ':' + PORT + '  (данные: ' + DATA_DIR + ', проекты: ' + WORKSPACES_DIR + ')');
  console.log('[polar] Claude Code: ' + (status.installed ? 'найден ' + (status.version || '') : 'НЕ найден') + '; вход: ' + (status.loginFilePresent ? 'есть' : 'нет'));
});
