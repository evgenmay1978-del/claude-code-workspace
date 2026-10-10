import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import type { AppDatabase } from '../db.js'

const COOKIE_NAME = 'polar_session'
const SESSION_MS = 7 * 24 * 60 * 60 * 1000
const passphraseSchema = z.string().min(12).max(256)
const setupSchema = z.object({ username: z.string().trim().min(3).max(32).regex(/^[\p{L}0-9_.-]+$/u), password: passphraseSchema }).strict()
const loginSchema = z.object({ username: z.string().trim().min(1).max(32), password: z.string().min(1).max(256) }).strict()

type OwnerRow = { id: string; username: string; password_hash: string; password_salt: string }
type SessionRow = { user_id: string; csrf_token: string; expires_at: number }

function deriveKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 64, (error, key) => error ? reject(error) : resolve(key as Buffer))
  })
}

function hashSession(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function readCookie(header: string | undefined): string | undefined {
  if (!header) return undefined
  for (const item of header.split(';')) {
    const separator = item.indexOf('=')
    if (separator < 0) continue
    if (item.slice(0, separator).trim() !== COOKIE_NAME) continue
    try { return decodeURIComponent(item.slice(separator + 1).trim()) } catch { return undefined }
  }
  return undefined
}

function writeCookie(res: Parameters<RequestHandler>[1], token: string, maxAgeMs: number): void {
  const secure = process.env.SESSION_COOKIE_SECURE !== '0'
  const sameSite = secure ? 'None' : 'Lax'
  const maxAgeSeconds = Math.max(0, Math.floor(maxAgeMs / 1000))
  const attributes = [`${COOKIE_NAME}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', `SameSite=${sameSite}`, `Max-Age=${maxAgeSeconds}`]
  if (secure) attributes.push('Secure')
  res.setHeader('Set-Cookie', attributes.join('; '))
}

function clearCookie(res: Parameters<RequestHandler>[1]): void {
  const secure = process.env.SESSION_COOKIE_SECURE !== '0'
  const attributes = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', `SameSite=${secure ? 'None' : 'Lax'}`, 'Max-Age=0']
  if (secure) attributes.push('Secure')
  res.setHeader('Set-Cookie', attributes.join('; '))
}

function createSession(db: AppDatabase, userId: string, res: Parameters<RequestHandler>[1]): string {
  const token = randomBytes(32).toString('base64url')
  const csrfToken = randomBytes(32).toString('base64url')
  const now = Date.now()
  db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)').run(hashSession(token), userId, csrfToken, now + SESSION_MS, now)
  writeCookie(res, token, SESSION_MS)
  return csrfToken
}

export function loadSession(db: AppDatabase): RequestHandler {
  return (req, res, next) => {
    const token = readCookie(req.headers.cookie)
    if (!token) return next()
    const row = db.prepare('SELECT user_id,csrf_token,expires_at FROM sessions WHERE token_hash=?').get(hashSession(token)) as SessionRow | undefined
    if (!row || row.expires_at <= Date.now()) {
      if (row) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashSession(token))
      clearCookie(res)
      return next()
    }
    req.auth = { userId: row.user_id, csrfToken: row.csrf_token }
    next()
  }
}

export function resolveSession(db: AppDatabase, cookieHeader: string | undefined): { userId: string; csrfToken: string } | undefined {
  const token = readCookie(cookieHeader)
  if (!token) return undefined
  const row = db.prepare('SELECT user_id,csrf_token,expires_at FROM sessions WHERE token_hash=?').get(hashSession(token)) as SessionRow | undefined
  if (!row || row.expires_at <= Date.now()) {
    if (row) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashSession(token))
    return undefined
  }
  return { userId: row.user_id, csrfToken: row.csrf_token }
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.auth) return res.status(401).json({ error: 'unauthorized', message: 'Войдите в своё рабочее пространство.' })
  next()
}

export const requireCsrf: RequestHandler = (req, res, next) => {
  const supplied = req.get('x-csrf-token') ?? ''
  if (!req.auth || !safeEqual(supplied, req.auth.csrfToken)) return res.status(403).json({ error: 'csrf_failed', message: 'Сессия изменилась. Обновите страницу и повторите действие.' })
  next()
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'rate_limited', message: 'Слишком много попыток входа. Подождите и повторите.' } })

export function createAuthRouter(db: AppDatabase): Router {
  const router = Router()

  router.get('/status', (req, res) => {
    const count = (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count
    res.json({ initialized: count > 0, authenticated: Boolean(req.auth), username: req.auth ? (db.prepare('SELECT username FROM users WHERE id=?').get(req.auth.userId) as { username: string } | undefined)?.username : undefined, csrfToken: req.auth?.csrfToken })
  })

  router.post('/setup', authLimiter, async (req, res) => {
    const parsed = setupSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_setup', message: 'Укажите имя владельца и пароль не короче 12 символов.' })
    const alreadyInitialized = (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count > 0
    if (alreadyInitialized) return res.status(409).json({ error: 'already_initialized', message: 'Первоначальная настройка уже завершена.' })

    const salt = randomBytes(16).toString('hex')
    const passwordHash = (await deriveKey(parsed.data.password, salt)).toString('hex')
    const id = randomUUID()
    const now = Date.now()
    try {
      db.transaction(() => {
        const count = (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count
        if (count > 0) throw new Error('already_initialized')
        db.prepare('INSERT INTO users(id,username,password_hash,password_salt,created_at) VALUES(?,?,?,?,?)').run(id, parsed.data.username, passwordHash, salt, now)
      }).immediate()
    } catch {
      return res.status(409).json({ error: 'already_initialized', message: 'Первоначальная настройка уже завершена.' })
    }
    const csrfToken = createSession(db, id, res)
    res.status(201).json({ authenticated: true, username: parsed.data.username, csrfToken })
  })

  router.post('/login', authLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_login', message: 'Проверьте имя пользователя и пароль.' })
    const owner = db.prepare('SELECT id,username,password_hash,password_salt FROM users WHERE username=? COLLATE NOCASE').get(parsed.data.username) as OwnerRow | undefined
    const candidate = await deriveKey(parsed.data.password, owner?.password_salt ?? 'polar-unknown-user-salt')
    const expected = Buffer.from(owner?.password_hash ?? '00'.repeat(64), 'hex')
    const valid = Boolean(owner && candidate.length === expected.length && timingSafeEqual(candidate, expected))
    if (!valid || !owner) return res.status(401).json({ error: 'invalid_login', message: 'Имя пользователя или пароль неверны.' })
    const csrfToken = createSession(db, owner.id, res)
    res.json({ authenticated: true, username: owner.username, csrfToken })
  })

  router.post('/logout', requireAuth, requireCsrf, (req, res) => {
    const token = readCookie(req.headers.cookie)
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashSession(token))
    clearCookie(res)
    res.status(204).end()
  })

  return router
}
