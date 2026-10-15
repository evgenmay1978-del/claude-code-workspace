/**
 * Минимальный MCP-сервер (stdio, JSON-RPC 2.0 построчно) с одним инструментом
 * `approve`. Claude Code вызывает его через `--permission-prompt-tool
 * mcp__polar__approve`, когда хочет выполнить действие, требующее разрешения.
 *
 * Инструмент пересылает запрос во внутренний маршрут Polar Workspace и ждёт
 * решения владельца в чате. Без зависимостей: только встроенные модули Node.
 *
 * Окружение (задаётся приложением в mcp-config):
 *   POLAR_PERMISSION_URL — http://127.0.0.1:<порт>/_internal/claude/permission
 *   POLAR_RUN_TOKEN      — одноразовый токен этого запуска CLI
 */
import { request as httpRequest } from 'node:http'
import { createInterface } from 'node:readline'

type JsonRpcId = string | number | null
interface JsonRpcMessage { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: Record<string, unknown> }

const SERVER_INFO = { name: 'polar-permissions', version: '1.0.0' }
const TOOL = {
  name: 'approve',
  description: 'Asks the Polar Workspace owner to allow or deny a Claude Code tool call.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string', description: 'Name of the tool that needs permission' },
      input: { type: 'object', description: 'Input of the tool call' },
      tool_use_id: { type: 'string', description: 'Tool use identifier' },
    },
    required: ['tool_name', 'input'],
  },
}

function write(message: unknown) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function reply(id: JsonRpcId | undefined, result: unknown) {
  if (id === undefined) return
  write({ jsonrpc: '2.0', id, result })
}

function fail(id: JsonRpcId | undefined, code: number, message: string) {
  if (id === undefined) return
  write({ jsonrpc: '2.0', id, error: { code, message } })
}

const deny = (message: string) => ({ behavior: 'deny', message })

export function askOwner(toolName: string, input: Record<string, unknown>, endpoint = process.env.POLAR_PERMISSION_URL, token = process.env.POLAR_RUN_TOKEN): Promise<Record<string, unknown>> {
  if (!endpoint || !token) return Promise.resolve(deny('Подтверждение недоступно: приложение не передало адрес или токен.'))
  const body = JSON.stringify({ tool_name: toolName, input })
  return new Promise(resolve => {
    let url: URL
    try { url = new URL(endpoint) } catch { return resolve(deny('Некорректный адрес подтверждения.')) }
    // node:http без таймаута ответа: владелец может думать несколько минут.
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: `Bearer ${token}` },
    }, res => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>
          if (res.statusCode === 200 && (parsed.behavior === 'allow' || parsed.behavior === 'deny')) return resolve(parsed)
        } catch { /* ниже — отказ */ }
        resolve(deny(`Подтверждение не получено (HTTP ${res.statusCode ?? 0}).`))
      })
    })
    req.on('error', () => resolve(deny('Не удалось связаться с Polar Workspace для подтверждения.')))
    req.end(body)
  })
}

export async function handleMessage(message: JsonRpcMessage, ask: typeof askOwner = askOwner): Promise<void> {
  const { id, method, params } = message
  switch (method) {
    case 'initialize': {
      const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18'
      return reply(id, { protocolVersion: requested, capabilities: { tools: {} }, serverInfo: SERVER_INFO })
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return
    case 'ping':
      return reply(id, {})
    case 'tools/list':
      return reply(id, { tools: [TOOL] })
    case 'tools/call': {
      if (params?.name !== TOOL.name) return fail(id, -32602, `Unknown tool: ${String(params?.name)}`)
      const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>
      const toolName = typeof args.tool_name === 'string' ? args.tool_name : 'unknown'
      const input = args.input && typeof args.input === 'object' && !Array.isArray(args.input) ? args.input as Record<string, unknown> : {}
      const decision = await ask(toolName, input)
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(decision) }] })
    }
    default:
      if (method && id !== undefined) fail(id, -32601, `Method not found: ${method}`)
  }
}

export function main() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  lines.on('line', line => {
    if (!line.trim()) return
    let message: JsonRpcMessage
    try { message = JSON.parse(line) as JsonRpcMessage } catch { return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) }
    void handleMessage(message).catch(() => fail(message.id, -32603, 'Internal error'))
  })
  lines.on('close', () => process.exit(0))
}
