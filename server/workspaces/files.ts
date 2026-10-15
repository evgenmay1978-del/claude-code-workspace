import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, sep } from 'node:path'
import type { Dirent } from 'node:fs'
import { UnsafeWorkspacePathError, resolveWorkspacePath } from './paths.js'

export interface WorkspaceFileEntry {
  path: string
  kind: 'file' | 'folder'
  language?: string
  size?: number
}

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_DEPTH = 12
// Каталоги сервера (например, /root) бывают огромными — список ограничен, чтобы не вешать API.
const MAX_ENTRIES = 5000
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', '.polar', '.cache', 'dist', 'dist-server', 'coverage', '.next', '.venv', '__pycache__', '.turbo'])
const SECRET_FILE = /^\.env(?:\..*)?$/i

const LANGUAGE_NAMES: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  json: 'JSON', jsonc: 'JSON', css: 'CSS', scss: 'SCSS', less: 'Less', html: 'HTML', htm: 'HTML',
  md: 'Markdown', mdx: 'Markdown', txt: 'Text', py: 'Python', rb: 'Ruby', php: 'PHP',
  rs: 'Rust', go: 'Go', java: 'Java', kt: 'Kotlin', swift: 'Swift', c: 'C', h: 'C', cpp: 'C++', hpp: 'C++', cs: 'C#',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', fish: 'Shell', ps1: 'PowerShell',
  yml: 'YAML', yaml: 'YAML', toml: 'TOML', ini: 'INI', conf: 'Config', cfg: 'Config', env: 'Env',
  sql: 'SQL', graphql: 'GraphQL', gql: 'GraphQL', xml: 'XML', svg: 'SVG', vue: 'Vue', svelte: 'Svelte',
  dockerfile: 'Dockerfile', lock: 'Lockfile', csv: 'CSV', tsv: 'TSV', pdf: 'PDF', log: 'Log',
}

export function languageForPath(filePath: string): string {
  return LANGUAGE_NAMES[extname(filePath).slice(1).toLowerCase()] ?? 'Text'
}

/** Рекурсивный список файлов проекта: без служебных каталогов, симлинков и файлов секретов. */
export function listWorkspaceFiles(workspaceRoot: string): WorkspaceFileEntry[] {
  const root = resolveWorkspacePath(workspaceRoot, '.', false)
  const entries: WorkspaceFileEntry[] = []

  const walk = (directory: string, depth: number): void => {
    if (depth > MAX_DEPTH || entries.length >= MAX_ENTRIES) return
    let children: Dirent[]
    try { children = readdirSync(directory, { withFileTypes: true }) } catch { return }
    children.sort((left, right) => left.name.localeCompare(right.name))
    for (const child of children) {
      if (entries.length >= MAX_ENTRIES) return
      if (child.isSymbolicLink()) continue
      const absolute = join(directory, child.name)
      const relativePath = relative(root, absolute).split(sep).join('/')
      if (child.isDirectory()) {
        if (child.name.startsWith('.polar') || SKIPPED_DIRECTORIES.has(child.name.toLowerCase())) continue
        entries.push({ path: relativePath, kind: 'folder' })
        walk(absolute, depth + 1)
        continue
      }
      if (!child.isFile()) continue
      if (SECRET_FILE.test(child.name)) continue
      let size = 0
      try { size = statSync(absolute).size } catch { continue }
      entries.push({ path: relativePath, kind: 'file', language: languageForPath(child.name), size })
    }
  }

  walk(root, 1)
  return entries
}

export function readWorkspaceFile(workspaceRoot: string, relativePath: string): { content: string; language: string } {
  const absolute = resolveWorkspacePath(workspaceRoot, relativePath)
  const stats = lstatSync(absolute)
  if (stats.isSymbolicLink() || !stats.isFile()) throw new UnsafeWorkspacePathError('Only regular files inside the workspace can be opened.')
  if (stats.size > MAX_FILE_BYTES) throw new RangeError('File is too large to open in the web editor.')
  return { content: readFileSync(absolute, 'utf8'), language: languageForPath(relativePath) }
}

export function writeWorkspaceFile(workspaceRoot: string, relativePath: string, content: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new RangeError('File is too large to save from the web editor.')
  const absolute = resolveWorkspacePath(workspaceRoot, relativePath, true)
  if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) throw new UnsafeWorkspacePathError('Refusing to write through a symbolic link.')
  mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 })
  writeFileSync(absolute, content, { encoding: 'utf8', mode: 0o600 })
}
