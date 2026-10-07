// Claude Code Workspace — реальный backend. Никаких заглушек.
// Запускает официальный Claude Code CLI (подписочная авторизация) и отдаёт
// чат/файлы/терминал фронтенду. Все вызовы — настоящие.
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = Number(process.env.PORT || 8787);
const WORKSPACE = path.resolve(process.env.WORKSPACE_DIR || process.cwd());
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};
const readBody = (req) => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 4e6) { reject(new Error('body too large')); req.destroy(); } });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});
const safeJoin = (rel) => {
  const p = path.resolve(WORKSPACE, '.' + path.posix.normalize('/' + String(rel || '')));
  if (p !== WORKSPACE && !p.startsWith(WORKSPACE + path.sep)) throw new Error('path escapes workspace');
  return p;
};
const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
function authStatus() {
  const tokenEnv = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const credsFile = fs.existsSync(credPath);
  const apiKey = !!process.env.ANTHROPIC_API_KEY;
  return { authorized: tokenEnv || credsFile || apiKey, source: tokenEnv ? 'CLAUDE_CODE_OAUTH_TOKEN' : credsFile ? credPath : apiKey ? 'ANTHROPIC_API_KEY' : null, mode: 'subscription-or-api-key' };
}

// --- Claude Code (official CLI, stream-json) ---
function runClaude(prompt, sessionId, res) {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', process.env.CLAUDE_PERMISSION_MODE || 'acceptEdits'];
  if (sessionId) args.push('--resume', sessionId);
  const child = spawn(CLAUDE_BIN, args, { cwd: WORKSPACE, env: process.env });
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const line of lines) { if (!line.trim()) continue; res.write(JSON.stringify({ kind: 'claude', raw: line }) + '\n'); }
  });
  child.stderr.on('data', (d) => res.write(JSON.stringify({ kind: 'stderr', text: d.toString() }) + '\n'));
  child.on('close', (code) => { res.write(JSON.stringify({ kind: 'exit', code }) + '\n'); res.end(); });
  child.on('error', (e) => { res.write(JSON.stringify({ kind: 'error', message: e.message }) + '\n'); res.end(); });
  return child;
}

// --- OAuth login of the subscription: claude setup-token (official) ---
let loginChild = null;
function startLogin(res) {
  if (loginChild) { json(res, 409, { error: 'login already in progress' }); return; }
  const child = spawn(CLAUDE_BIN, ['setup-token'], { cwd: WORKSPACE, env: process.env });
  loginChild = child;
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
  const send = (o) => res.write(JSON.stringify(o) + '\n');
  child.stdout.on('data', (d) => send({ kind: 'out', text: d.toString() }));
  child.stderr.on('data', (d) => send({ kind: 'err', text: d.toString() }));
  child.on('close', (code) => { loginChild = null; send({ kind: 'exit', code }); res.end(); });
  child.on('error', (e) => { loginChild = null; send({ kind: 'error', message: e.message }); res.end(); });
}
const sendLoginInput = (text) => { if (loginChild) { loginChild.stdin.write(text + '\n'); return true; } return false; };

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/api/health') return json(res, 200, { ok: true, workspace: WORKSPACE, claudeBin: CLAUDE_BIN, pid: process.pid });
    if (p === '/api/auth/status') return json(res, 200, authStatus());
    if (p === '/api/auth/login' && req.method === 'POST') return startLogin(res);
    if (p === '/api/auth/code' && req.method === 'POST') { const b = await readBody(req); return json(res, sendLoginInput(String(b.code || '')) ? 200 : 409, { ok: sendLoginInput(String(b.code || '')) }); }
    if (p === '/api/chat' && req.method === 'POST') { const b = await readBody(req); if (!b.prompt) return json(res, 400, { error: 'prompt required' }); return runClaude(String(b.prompt), b.sessionId ? String(b.sessionId) : null, res); }
    if (p === '/api/files') { const rel = u.searchParams.get('path') || ''; const dir = safeJoin(rel); const items = fs.readdirSync(dir, { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory(), size: e.isDirectory() ? null : fs.statSync(path.join(dir, e.name)).size })); return json(res, 200, { path: rel, items }); }
    if (p === '/api/file' && req.method === 'GET') { const file = safeJoin(u.searchParams.get('path')); return json(res, 200, { path: u.searchParams.get('path'), text: fs.readFileSync(file, 'utf8') }); }
    if (p === '/api/file' && req.method === 'PUT') { const b = await readBody(req); const file = safeJoin(b.path); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, String(b.text ?? '')); return json(res, 200, { ok: true, bytes: Buffer.byteLength(String(b.text ?? '')) }); }
    if (p === '/api/terminal' && req.method === 'POST') {
      const b = await readBody(req); const cmd = String(b.cmd || '').trim(); if (!cmd) return json(res, 400, { error: 'cmd required' });
      const child = spawn(process.env.SHELL || '/bin/sh', ['-lc', cmd], { cwd: WORKSPACE, env: process.env });
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
      child.on('close', (code) => json(res, 200, { code, stdout: out, stderr: err }));
      child.on('error', (e) => json(res, 500, { error: e.message }));
      return;
    }
    return json(res, 404, { error: 'not found', path: p });
  } catch (e) { return json(res, 500, { error: e.message }); }
});
server.listen(PORT, process.env.BIND || '127.0.0.1', () => {
  console.log('claude-code-workspace backend: http://' + (process.env.BIND || '127.0.0.1') + ':' + PORT);
  console.log('workspace: ' + WORKSPACE);
  console.log('auth: ' + JSON.stringify(authStatus()));
});
