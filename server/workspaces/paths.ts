import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, resolve, sep } from 'node:path'

export class UnsafeWorkspacePathError extends Error {
  constructor(message = 'Unsafe workspace path.') {
    super(message)
    this.name = 'UnsafeWorkspacePathError'
  }
}

const MAX_PATH_LENGTH = 1024
const BLOCKED_SEGMENTS = new Set(['.polar'])
const SECRET_FILE = /^\.env(?:\..*)?$/i

function realpathOrNull(target: string): string | null {
  try { return realpathSync(target) } catch { return null }
}

/**
 * Канонизирует путь внутри рабочей папки проекта.
 * Бросает UnsafeWorkspacePathError при выходе за корень, симлинк-эскейпе,
 * обращении к .polar (вложения чата) или к файлам секретов.
 */
export function resolveWorkspacePath(workspaceRoot: string, relativePath: string, allowMissing = false): string {
  if (typeof relativePath !== 'string') throw new UnsafeWorkspacePathError('Workspace path must be a string.')
  const trimmed = relativePath.trim()
  if (!trimmed || trimmed.length > MAX_PATH_LENGTH) throw new UnsafeWorkspacePathError('Workspace path is empty or too long.')
  if (trimmed.includes(String.fromCharCode(0))) throw new UnsafeWorkspacePathError('Workspace path contains a null byte.')
  if (isAbsolute(trimmed) || /^[a-zA-Z]:/.test(trimmed)) throw new UnsafeWorkspacePathError('Absolute paths are not allowed.')

  const root = resolve(workspaceRoot)
  const candidate = resolve(root, trimmed)
  if (candidate !== root && !candidate.startsWith(root + sep)) throw new UnsafeWorkspacePathError('Path escapes the project workspace.')

  const segments = trimmed.split(/[^a-zA-Z0-9._-]+/).filter(segment => segment.length > 0 && segment !== '.')
  for (const segment of segments) {
    if (BLOCKED_SEGMENTS.has(segment.toLowerCase())) throw new UnsafeWorkspacePathError('This workspace area is not exposed through the web app.')
  }
  const last = segments[segments.length - 1] ?? ''
  if (SECRET_FILE.test(last)) throw new UnsafeWorkspacePathError('Secret files are not exposed through the web app.')

  const realRoot = realpathOrNull(root)
  if (realRoot) {
    let probe = candidate
    for (let depth = 0; depth < 64; depth += 1) {
      const real = realpathOrNull(probe)
      if (real) {
        if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new UnsafeWorkspacePathError('Path escapes the project workspace.')
        break
      }
      const parent = dirname(probe)
      if (parent === probe) break
      probe = parent
    }
  }
  if (!allowMissing && !existsSync(candidate)) throw new UnsafeWorkspacePathError('Path does not exist in the project workspace.')
  return candidate
}
