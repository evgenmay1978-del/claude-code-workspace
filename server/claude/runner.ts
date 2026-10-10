import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dataDirectory } from '../db.js'

export interface CliStatus {
  enabled: boolean
  installed: boolean
  version: string | null
  loginFilePresent: boolean
}

export function cliConfigDirectory(): string {
  const directory = resolve(process.env.CLAUDE_CONFIG_DIR ?? join(dataDirectory, 'claude-config'))
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  return directory
}

export function cliEnvironment(): NodeJS.ProcessEnv {
  const inherited = process.env
  const safe: NodeJS.ProcessEnv = {
    PATH: inherited.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: inherited.CLAUDE_HOME ?? inherited.HOME ?? '/home/polar',
    LANG: inherited.LANG ?? 'C.UTF-8',
    LC_ALL: inherited.LC_ALL,
    TERM: 'xterm-256color',
    TMPDIR: inherited.TMPDIR,
    NO_COLOR: inherited.NO_COLOR,
    CLAUDE_CONFIG_DIR: cliConfigDirectory(),
  }
  // The application intentionally supports only subscription login inside the
  // unmodified official CLI. Do not pass API, token, or proxy variables through.
  for (const key of Object.keys(safe)) if (safe[key] === undefined) delete safe[key]
  return safe
}

export function getCliStatus(): CliStatus {
  const cli = process.env.CLAUDE_BIN ?? 'claude'
  let version: string | null = null
  let installed = false
  try {
    const result = spawnSync(cli, ['--version'], { encoding: 'utf8', timeout: 4000, env: cliEnvironment() })
    if (result.status === 0) {
      version = String(result.stdout).trim().slice(0, 80)
      installed = Boolean(version)
    }
  } catch {
    installed = false
  }
  const loginFilePresent = existsSync(join(cliConfigDirectory(), '.credentials.json'))
  return { enabled: process.env.CLAUDE_ENABLED === '1', installed, version, loginFilePresent }
}

export interface ClaudeRunOptions {
  prompt: string
  cwd: string
  model: 'sonnet' | 'opus' | 'haiku'
  sessionId: string
  resume: boolean
  webSearch: boolean
  instructions?: string
}

export function spawnClaude(options: ClaudeRunOptions): ChildProcessWithoutNullStreams {
  const cli = process.env.CLAUDE_BIN ?? 'claude'
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', 'plan',
    '--allowedTools', options.webSearch ? 'Read,Glob,Grep,WebSearch,WebFetch' : 'Read,Glob,Grep',
  ]
  if (options.resume) args.push('--resume', options.sessionId)
  else args.push('--session-id', options.sessionId)
  args.push('--model', options.model)
  if (options.instructions?.trim()) args.push('--append-system-prompt', options.instructions.trim())

  // No shell is involved: user content is piped on stdin and never interpolated
  // into a command string. File operations stay inside this project's cwd.
  const child = spawn(cli, args, {
    cwd: options.cwd,
    env: cliEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdin.end(options.prompt)
  return child
}
