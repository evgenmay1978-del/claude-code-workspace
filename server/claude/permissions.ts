import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

/**
 * Брокер подтверждений действий Claude Code.
 *
 * Официальный CLI в режиме `--print` не может спросить разрешение в терминале,
 * поэтому получает его через MCP-инструмент, указанный в `--permission-prompt-tool`.
 * Этот инструмент (permission-mcp) обращается к внутреннему маршруту приложения,
 * а брокер держит запрос до решения владельца в чате.
 *
 * Каждый запуск CLI получает собственный одноразовый токен; запросы с чужим или
 * просроченным токеном отклоняются. По окончании запуска все его незакрытые
 * запросы автоматически отклоняются, чтобы CLI не висел бесконечно.
 */

export type PermissionDecision =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

export interface PermissionRequestView {
  id: string
  tool: string
  summary: string
  detail: string
  createdAt: number
}

interface PendingRequest extends PermissionRequestView {
  runToken: string
  input: Record<string, unknown>
  resolve: (decision: PermissionDecision) => void
  timer: NodeJS.Timeout
}

interface RunRegistration {
  sessionId: string
  onRequest: (request: PermissionRequestView) => void
  onResolved: (id: string, behavior: 'allow' | 'deny', reason: string) => void
}

const DETAIL_LIMIT = 6000

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}\n…(обрезано, всего ${value.length} символов)` : value
}

/** Короткое описание действия для заголовка карточки и ленты активности. */
export function summarizeToolInput(tool: string, input: Record<string, unknown>): string {
  const path = text(input.file_path) || text(input.notebook_path) || text(input.path)
  switch (tool) {
    case 'Bash': return text(input.command).split('\n')[0].slice(0, 200) || 'команда shell'
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'Read':
    case 'NotebookEdit': return path || tool
    case 'Glob':
    case 'Grep': return [text(input.pattern), path].filter(Boolean).join(' в ').slice(0, 200)
    case 'WebFetch': return text(input.url).slice(0, 200)
    case 'WebSearch': return text(input.query).slice(0, 200)
    default: {
      const first = Object.values(input).find(value => typeof value === 'string') as string | undefined
      return (first ?? '').split('\n')[0].slice(0, 200)
    }
  }
}

/** Полное содержимое действия: команда, дифф правки или текст файла. */
export function describeToolInput(tool: string, input: Record<string, unknown>): string {
  if (tool === 'Bash') {
    const description = text(input.description)
    return clip(`${description ? `# ${description}\n` : ''}$ ${text(input.command)}`, DETAIL_LIMIT)
  }
  if (tool === 'Edit') {
    const removed = text(input.old_string).split('\n').map(line => `- ${line}`).join('\n')
    const added = text(input.new_string).split('\n').map(line => `+ ${line}`).join('\n')
    return clip(`${text(input.file_path)}${input.replace_all === true ? ' (все вхождения)' : ''}\n${removed}\n${added}`, DETAIL_LIMIT)
  }
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    const parts = input.edits.map((edit, index) => {
      const item = (edit && typeof edit === 'object' ? edit : {}) as Record<string, unknown>
      const removed = text(item.old_string).split('\n').map(line => `- ${line}`).join('\n')
      const added = text(item.new_string).split('\n').map(line => `+ ${line}`).join('\n')
      return `@@ правка ${index + 1}\n${removed}\n${added}`
    })
    return clip(`${text(input.file_path)}\n${parts.join('\n')}`, DETAIL_LIMIT)
  }
  if (tool === 'Write') return clip(`${text(input.file_path)} (новое содержимое)\n${text(input.content)}`, DETAIL_LIMIT)
  try {
    return clip(JSON.stringify(input, null, 2), DETAIL_LIMIT)
  } catch {
    return ''
  }
}

export class PermissionBroker {
  private readonly runs = new Map<string, RunRegistration>()
  private readonly pending = new Map<string, PendingRequest>()
  private readonly timeoutMs: number

  constructor(timeoutMs = 10 * 60 * 1000) {
    this.timeoutMs = timeoutMs
  }

  /** Регистрирует запуск CLI и возвращает его одноразовый токен. */
  openRun(registration: RunRegistration): string {
    const token = randomBytes(32).toString('base64url')
    this.runs.set(token, registration)
    return token
  }

  /** Завершает запуск: все его ожидающие запросы отклоняются. */
  closeRun(token: string, reason = 'Запуск Claude Code завершён до решения владельца.') {
    for (const request of [...this.pending.values()]) {
      if (request.runToken === token) this.finish(request, { behavior: 'deny', message: reason }, reason)
    }
    this.runs.delete(token)
  }

  private findRun(token: string): RunRegistration | undefined {
    const candidate = Buffer.from(token)
    for (const [known, registration] of this.runs) {
      const expected = Buffer.from(known)
      if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) return registration
    }
    return undefined
  }

  isValidRun(token: string): boolean {
    return Boolean(token) && this.findRun(token) !== undefined
  }

  /** Вызывается внутренним маршрутом: ждёт решения владельца. */
  request(token: string, tool: string, input: Record<string, unknown>): Promise<PermissionDecision> {
    const run = this.findRun(token)
    if (!run) return Promise.resolve({ behavior: 'deny', message: 'Неизвестный или завершённый запуск Claude Code.' })
    return new Promise(resolve => {
      const id = randomUUID()
      const request: PendingRequest = {
        id,
        tool,
        summary: summarizeToolInput(tool, input),
        detail: describeToolInput(tool, input),
        createdAt: Date.now(),
        runToken: token,
        input,
        resolve,
        timer: setTimeout(() => {
          const current = this.pending.get(id)
          if (current) this.finish(current, { behavior: 'deny', message: 'Владелец не ответил на запрос разрешения вовремя.' }, 'timeout')
        }, this.timeoutMs),
      }
      request.timer.unref()
      this.pending.set(id, request)
      run.onRequest({ id, tool: request.tool, summary: request.summary, detail: request.detail, createdAt: request.createdAt })
    })
  }

  /** Решение владельца из чата. Возвращает false, если запрос уже закрыт или чужой. */
  decide(id: string, sessionId: string, behavior: 'allow' | 'deny', message?: string): boolean {
    const request = this.pending.get(id)
    if (!request) return false
    const run = this.runs.get(request.runToken)
    if (!run || run.sessionId !== sessionId) return false
    const decision: PermissionDecision = behavior === 'allow'
      ? { behavior: 'allow', updatedInput: request.input }
      : { behavior: 'deny', message: message?.trim() || 'Владелец отклонил это действие.' }
    this.finish(request, decision, behavior === 'allow' ? 'allowed' : 'denied')
    return true
  }

  pendingForSession(sessionId: string): PermissionRequestView[] {
    return [...this.pending.values()]
      .filter(request => this.runs.get(request.runToken)?.sessionId === sessionId)
      .map(({ id, tool, summary, detail, createdAt }) => ({ id, tool, summary, detail, createdAt }))
  }

  private finish(request: PendingRequest, decision: PermissionDecision, reason: string) {
    clearTimeout(request.timer)
    this.pending.delete(request.id)
    this.runs.get(request.runToken)?.onResolved(request.id, decision.behavior, reason)
    request.resolve(decision)
  }
}
