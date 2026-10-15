import { appendFileSync, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { workspacesDirectory } from '../db.js'

/**
 * Проекты в существующих каталогах сервера (например, /root/maestro-memory).
 *
 * Включается только явно: POLAR_ALLOW_HOST_PATHS=1. В Docker-установке по
 * умолчанию выключено — проекты живут только внутри WORKSPACES_DIR.
 */
export function hostPathsAllowed(): boolean {
  return process.env.POLAR_ALLOW_HOST_PATHS === '1'
}

export class HostPathError extends Error {}

/** Проверяет и канонизирует абсолютный путь к существующему каталогу. */
export function resolveHostProjectPath(input: string): string {
  if (!hostPathsAllowed()) throw new HostPathError('Проекты в каталогах сервера отключены (POLAR_ALLOW_HOST_PATHS).')
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > 1024 || trimmed.includes('\0')) throw new HostPathError('Некорректный путь.')
  if (!isAbsolute(trimmed)) throw new HostPathError('Укажите абсолютный путь, например /root/maestro-memory.')
  let real: string
  try { real = realpathSync(resolve(trimmed)) } catch { throw new HostPathError('Каталог не найден.') }
  if (!statSync(real).isDirectory()) throw new HostPathError('Это не каталог.')
  if (real === sep) throw new HostPathError('Корень файловой системы нельзя сделать проектом.')
  return real
}

/** Каталог проекта допустим: внутри WORKSPACES_DIR или (если разрешено) любой существующий каталог. */
export function isAllowedProjectRoot(path: string): boolean {
  const base = resolve(workspacesDirectory)
  const target = resolve(path)
  if (target === base || target.startsWith(`${base}${sep}`)) return true
  return hostPathsAllowed() && existsSync(target) && statSync(target).isDirectory()
}

/** Служебные вложения чата (.polar/) не должны попадать в git существующего репозитория. */
export function excludePolarFromGit(projectRoot: string) {
  const exclude = join(projectRoot, '.git', 'info', 'exclude')
  if (!existsSync(join(projectRoot, '.git', 'info'))) return
  try {
    const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
    if (!current.split('\n').some(line => line.trim() === '.polar/')) appendFileSync(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}.polar/\n`)
  } catch { /* не критично */ }
}
