import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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
    // Подтверждение действия ждёт решения владельца до 10 минут; MCP-вызов не должен обрываться раньше.
    MCP_TOOL_TIMEOUT: String(11 * 60 * 1000),
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

/**
 * Режимы прав в чате:
 *  - ask         — чтение без вопросов, любые правки и команды подтверждает владелец;
 *  - acceptEdits — правки файлов без вопросов, команды и прочее подтверждает владелец;
 *  - plan        — только чтение и план, без изменений.
 */
export type ChatPermissionMode = 'ask' | 'acceptEdits' | 'plan'

export const PERMISSION_TOOL = 'mcp__polar__approve'

export interface PermissionBridge {
  /** http://127.0.0.1:<порт>/_internal/claude/permission */
  endpoint: string
  /** Одноразовый токен этого запуска. */
  token: string
}

export interface ClaudeRunOptions {
  prompt: string
  cwd: string
  model: 'sonnet' | 'opus' | 'haiku'
  sessionId: string
  resume: boolean
  webSearch: boolean
  instructions?: string
  permissionMode?: ChatPermissionMode
  permissionBridge?: PermissionBridge
}

const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'LS', 'TodoWrite']
const WEB_TOOLS = ['WebSearch', 'WebFetch']

/** Команда запуска MCP-сервера подтверждений: собранный .js в проде, .ts через tsx в разработке и тестах. */
export function permissionServerCommand(): { command: string; args: string[] } {
  const here = fileURLToPath(import.meta.url)
  const directory = dirname(here)
  if (here.endsWith('.ts')) return { command: process.execPath, args: ['--import', 'tsx', join(directory, 'permission-mcp-entry.ts')] }
  return { command: process.execPath, args: [join(directory, 'permission-mcp-entry.js')] }
}

export function buildClaudeArgs(options: ClaudeRunOptions, mcpConfigPath?: string): string[] {
  const mode = options.permissionMode ?? 'plan'
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ]
  if (mode === 'plan' || !mcpConfigPath) {
    // Без моста подтверждений — только безопасное чтение, как раньше.
    args.push('--permission-mode', 'plan', '--allowedTools', [...READ_ONLY_TOOLS, ...(options.webSearch ? WEB_TOOLS : [])].join(','))
  } else {
    args.push(
      '--permission-mode', mode === 'acceptEdits' ? 'acceptEdits' : 'default',
      '--mcp-config', mcpConfigPath,
      '--permission-prompt-tool', PERMISSION_TOOL,
      '--allowedTools', [...READ_ONLY_TOOLS, ...(options.webSearch ? WEB_TOOLS : [])].join(','),
    )
  }
  if (!options.webSearch) args.push('--disallowedTools', WEB_TOOLS.join(','))
  if (options.resume) args.push('--resume', options.sessionId)
  else args.push('--session-id', options.sessionId)
  args.push('--model', options.model)
  if (options.instructions?.trim()) args.push('--append-system-prompt', options.instructions.trim())
  return args
}

/** Пишет mcp-config во временный каталог с правами 0700/0600; токен не попадает в аргументы процесса. */
function writePermissionConfig(bridge: PermissionBridge): { path: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'polar-mcp-'))
  const path = join(directory, 'mcp.json')
  const server = permissionServerCommand()
  writeFileSync(path, JSON.stringify({
    mcpServers: {
      polar: {
        type: 'stdio',
        command: server.command,
        args: server.args,
        env: { POLAR_PERMISSION_URL: bridge.endpoint, POLAR_RUN_TOKEN: bridge.token },
      },
    },
  }), { mode: 0o600 })
  return { path, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
}

export function spawnClaude(options: ClaudeRunOptions): ChildProcessWithoutNullStreams {
  const cli = process.env.CLAUDE_BIN ?? 'claude'
  const config = options.permissionMode && options.permissionMode !== 'plan' && options.permissionBridge
    ? writePermissionConfig(options.permissionBridge)
    : undefined
  const args = buildClaudeArgs(options, config?.path)

  // No shell is involved: user content is piped on stdin and never interpolated
  // into a command string. File operations stay inside this project's cwd.
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(cli, args, {
      cwd: options.cwd,
      env: cliEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
  } catch (error) {
    config?.cleanup()
    throw error
  }
  if (config) {
    child.once('exit', config.cleanup)
    child.once('error', config.cleanup)
  }
  child.stdin.end(options.prompt)
  return child
}
