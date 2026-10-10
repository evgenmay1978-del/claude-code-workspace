import { spawn } from 'node:child_process'
import { resolve as resolvePath } from 'node:path'
import { resolveWorkspacePath, UnsafeWorkspacePathError } from '../workspaces/paths.js'

export interface GitChange {
  path: string
  kind: 'M' | 'A' | 'D'
  staged: boolean
  unstaged: boolean
}
export interface GitStatus { initialized: boolean; branch: string; changes: GitChange[] }
export interface GitDiff { staged: string; unstaged: string }

type Result = { code: number | null; stdout: string; stderr: string }

function runGit(cwd: string, args: string[], timeoutMs = 10_000): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: process.env.HOME ?? '/home/polar',
        LANG: process.env.LANG ?? 'C.UTF-8',
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CEILING_DIRECTORIES: resolvePath(cwd, '..'),
        GIT_OPTIONAL_LOCKS: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { if (stdout.length < 4_000_000) stdout += chunk.slice(0, 4_000_000 - stdout.length) })
    child.stderr.on('data', (chunk: string) => { if (stderr.length < 16_000) stderr += chunk.slice(0, 16_000 - stderr.length) })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    timer.unref()
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
  })
}

async function run(cwd: string, args: string[], allowDiffExit = false): Promise<string> {
  const result = await runGit(cwd, args)
  if (result.code !== 0 && !(allowDiffExit && result.code === 1)) {
    throw new Error(result.stderr.trim().slice(0, 800) || 'Git command failed.')
  }
  return result.stdout
}

function changeKind(status: string): GitChange['kind'] {
  if (status.includes('D')) return 'D'
  if (status.includes('A') || status === '??') return 'A'
  return 'M'
}

function parseStatus(root: string, output: string): GitChange[] {
  const entries = output.split('\0')
  const changes: GitChange[] = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (!entry || entry.length < 4) continue
    const status = entry.slice(0, 2)
    const path = entry.slice(3)
    if (!path || path.split('/').some(segment => /^\.env(?:\..*)?$/i.test(segment))) continue
    try { resolveWorkspacePath(root, path, true) } catch (error) {
      if (error instanceof UnsafeWorkspacePathError) continue
      throw error
    }
    changes.push({ path, kind: changeKind(status), staged: status[0] !== ' ' && status !== '??', unstaged: status[1] !== ' ' || status === '??' })
    if (status.includes('R') || status.includes('C')) index++
  }
  return changes
}

export async function getGitStatus(root: string): Promise<GitStatus> {
  const probe = await runGit(root, ['rev-parse', '--is-inside-work-tree'])
  if (probe.code !== 0 || probe.stdout.trim() !== 'true') return { initialized: false, branch: '', changes: [] }
  const [branch, status] = await Promise.all([
    run(root, ['branch', '--show-current']),
    run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ])
  return { initialized: true, branch: branch.trim() || '(detached)', changes: parseStatus(root, status) }
}

export async function initializeRepository(root: string): Promise<{ initialized: boolean; branch: string }> {
  const status = await getGitStatus(root)
  if (!status.initialized) await run(root, ['init', '--initial-branch=main'])
  const next = await getGitStatus(root)
  return { initialized: next.initialized, branch: next.branch || 'main' }
}

function requireSafePath(root: string, path: string): string {
  try { resolveWorkspacePath(root, path, true) }
  catch { throw new Error('Unsafe or unavailable workspace path.') }
  return path
}

export async function getGitDiff(root: string, path: string): Promise<GitDiff> {
  requireSafePath(root, path)
  const [staged, unstaged] = await Promise.all([
    run(root, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--unified=3', '--', path], true),
    run(root, ['diff', '--no-ext-diff', '--no-textconv', '--unified=3', '--', path], true),
  ])
  if (!staged && !unstaged) {
    const changes = await getGitStatus(root)
    const item = changes.changes.find(change => change.path === path)
    if (item?.kind === 'A') {
      const result = await runGit(root, ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--unified=3', '--', '/dev/null', path])
      return { staged: '', unstaged: result.stdout }
    }
  }
  return { staged, unstaged }
}

export async function stagePath(root: string, path: string): Promise<void> {
  const status = await getGitStatus(root)
  if (!status.initialized) throw new Error('Git is not initialized for this project.')
  requireSafePath(root, path)
  if (!status.changes.some(change => change.path === path)) throw new Error('The file has no pending Git change.')
  await run(root, ['add', '--', path])
}

export async function unstagePath(root: string, path: string): Promise<void> {
  const status = await getGitStatus(root)
  if (!status.initialized) throw new Error('Git is not initialized for this project.')
  requireSafePath(root, path)
  if (!status.changes.some(change => change.path === path)) throw new Error('The file has no pending Git change.')
  const tracked = await runGit(root, ['ls-files', '--error-unmatch', '--', path])
  if (tracked.code === 0) await run(root, ['restore', '--staged', '--', path])
  else await run(root, ['rm', '--cached', '--ignore-unmatch', '--', path])
}

export async function commitStaged(root: string, message: string): Promise<{ hash: string; message: string }> {
  if (!message.trim() || message.length > 256) throw new Error('Commit message must contain 1 to 256 characters.')
  const staged = await run(root, ['diff', '--cached', '--name-only', '-z'])
  if (!staged.split('\0').some(Boolean)) throw new Error('There are no staged changes to commit.')
  await run(root, [
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Polar Workspace',
    '-c', 'user.email=polar@localhost.invalid',
    'commit', '-m', message.trim(),
  ])
  const hash = (await run(root, ['rev-parse', '--short', 'HEAD'])).trim()
  return { hash, message: message.trim() }
}
