import type { AttachmentInfo, ChatMessage, PermissionMode, PermissionRequest, Project, ProjectFile, Session, ToolStep } from '../types'

export interface AuthStatus { initialized: boolean; authenticated: boolean; username?: string; csrfToken?: string }
export interface SessionRecord { id: string; title: string; model: string; status: string; archived: boolean; createdAt: number; updatedAt: number }
export interface ProjectRecord { id: string; name: string; description: string; instructions: string; defaultModel: string; createdAt: number; updatedAt: number; sessions: SessionRecord[] }
export interface WorkspaceFile extends ProjectFile { size?: number }
export interface GitChange { path: string; kind: 'M' | 'A' | 'D'; staged: boolean; unstaged: boolean }
export interface GitStatus { initialized: boolean; branch: string; changes: GitChange[] }
export interface GitDiff { staged: string; unstaged: string }
export interface CliStatus { enabled: boolean; installed: boolean; version: string | null; loginFilePresent: boolean; webSearchAvailable: boolean }
export interface MessageSearchResult { id: string; role: 'user' | 'assistant'; snippet: string; createdAt: number; projectId: string; projectName: string; sessionId: string; sessionTitle: string }
export type ChatStreamEvent = { type: 'started'; userMessageId: string; sessionId: string; cliSessionId: string; model: string; attachments?: AttachmentInfo[] }
  | { type: 'delta'; text: string }
  | { type: 'activity'; tool: string; summary?: string }
  | ({ type: 'permission' } & Omit<PermissionRequest, 'state'>)
  | { type: 'permission_resolved'; id: string; behavior: 'allow' | 'deny'; reason: string }
  | { type: 'done'; sessionId: string; cliSessionId: string; inputTokens: number; outputTokens: number }
  | { type: 'error'; code: string; message: string }

let csrfToken: string | undefined
const projectColors = ['#8faeff', '#93e5c4', '#eab2ff', '#ffb285', '#77d4dd', '#e6ca88']

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function addCsrf(headers: Headers, method: string) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) && csrfToken) headers.set('x-csrf-token', csrfToken)
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  addCsrf(headers, init.method ?? 'GET')
  const response = await fetch(path, { ...init, headers, credentials: 'include' })
  if (response.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new CustomEvent('polar:auth-expired'))
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => ({})) as { error?: string; message?: string } & T
  if (!response.ok) throw new ApiError(response.status, payload.error ?? 'request_failed', payload.message ?? 'Запрос не выполнен.')
  return payload
}

function parseSseBlock(block: string): { event: string; data: unknown } | undefined {
  let event = 'message'
  const data: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (!data.length) return undefined
  try { return { event, data: JSON.parse(data.join('\n')) as unknown } } catch { return undefined }
}

async function streamMessage(
  input: { projectId: string; sessionId: string; content: string; model: 'sonnet' | 'opus' | 'haiku'; webSearch: boolean; contextFiles: string[]; attachmentIds: string[]; permissionMode: PermissionMode },
  onEvent: (event: ChatStreamEvent) => void,
  onError: (error: Error) => void,
): Promise<AbortController> {
  const controller = new AbortController()
  void (async () => {
    try {
      const headers = new Headers({ 'content-type': 'application/json' })
      addCsrf(headers, 'POST')
      const response = await fetch('/api/claude/stream', { method: 'POST', headers, credentials: 'include', signal: controller.signal, body: JSON.stringify(input) })
      if (!response.ok) {
        if (response.status === 401) window.dispatchEvent(new CustomEvent('polar:auth-expired'))
        const payload = await response.json().catch(() => ({})) as { error?: string; message?: string }
        throw new ApiError(response.status, payload.error ?? 'stream_failed', payload.message ?? 'Не удалось запустить Claude Code.')
      }
      if (!response.body) throw new Error('Браузер не поддерживает потоковый ответ.')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const dispatch = (block: string) => {
        const parsed = parseSseBlock(block)
        if (!parsed || typeof parsed.data !== 'object' || parsed.data === null) return
        onEvent({ ...(parsed.data as object), type: parsed.event } as ChatStreamEvent)
      }
      for (;;) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() ?? ''
        for (const block of blocks) dispatch(block)
        if (done) break
      }
      if (buffer.trim()) dispatch(buffer)
    } catch (cause) {
      if (controller.signal.aborted) return
      onError(cause instanceof Error ? cause : new Error('Поток Claude Code прерван.'))
    }
  })()
  return controller
}

export const api = {
  async authStatus() {
    const status = await requestJson<AuthStatus>('/api/auth/status')
    csrfToken = status.csrfToken
    return status
  },
  async setup(username: string, password: string) {
    const result = await requestJson<{ username: string; csrfToken: string }>('/api/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) })
    csrfToken = result.csrfToken
    return result
  },
  async login(username: string, password: string) {
    const result = await requestJson<{ username: string; csrfToken: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
    csrfToken = result.csrfToken
    return result
  },
  async logout() {
    await requestJson<void>('/api/auth/logout', { method: 'POST' })
    csrfToken = undefined
  },
  cliStatus: () => requestJson<CliStatus>('/api/claude/status'),
  async searchMessages(query: string) {
    return (await requestJson<{ results: MessageSearchResult[] }>(`/api/claude/search?q=${encodeURIComponent(query)}`)).results
  },
  streamMessage,
  decidePermission: (requestId: string, sessionId: string, decision: 'allow' | 'deny', message?: string) => requestJson<{ ok: boolean }>(`/api/claude/permissions/${encodeURIComponent(requestId)}`, { method: 'POST', body: JSON.stringify({ sessionId, decision, ...(message ? { message } : {}) }) }),
  async uploadAttachment(projectId: string, sessionId: string, file: File) {
    const headers = new Headers({ 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), 'x-file-type': file.type })
    addCsrf(headers, 'POST')
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/attachments`, { method: 'POST', headers, credentials: 'include', body: file })
    const payload = await response.json().catch(() => ({})) as { attachment?: AttachmentInfo; error?: string; message?: string }
    if (!response.ok || !payload.attachment) throw new ApiError(response.status, payload.error ?? 'upload_failed', payload.message ?? 'Не удалось загрузить вложение.')
    return payload.attachment
  },
  deleteAttachment: (projectId: string, sessionId: string, attachmentId: string) => requestJson<void>(`/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' }),
  attachmentDownloadUrl: (projectId: string, attachmentId: string) => `/api/projects/${encodeURIComponent(projectId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
  async listTerminals(projectId: string) {
    return (await requestJson<{ sessions: { id: string; projectId: string; createdAt: number }[] }>(`/api/terminal/sessions?projectId=${encodeURIComponent(projectId)}`)).sessions
  },
  async createTerminal(projectId: string) {
    const result = await requestJson<{ session: { id: string; projectId: string; createdAt: number } }>('/api/terminal/sessions', { method: 'POST', body: JSON.stringify({ projectId }) })
    return result.session
  },
  closeTerminal: (terminalId: string) => requestJson<void>(`/api/terminal/sessions/${encodeURIComponent(terminalId)}`, { method: 'DELETE' }),
  listProjects: () => requestJson<{ projects: ProjectRecord[]; hostPathsAllowed?: boolean }>('/api/projects'),
  async createProject(name: string, description = '', path?: string) {
    const result = await requestJson<{ project: ProjectRecord }>('/api/projects', { method: 'POST', body: JSON.stringify({ name, description, ...(path ? { path } : {}) }) })
    return result.project
  },
  async updateProject(id: string, changes: Partial<Pick<ProjectRecord, 'name' | 'description' | 'instructions' | 'defaultModel'>>) {
    const result = await requestJson<{ project: ProjectRecord }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(changes) })
    return result.project
  },
  async createSession(projectId: string, title?: string, model?: string) {
    const result = await requestJson<{ session: SessionRecord }>(`/api/projects/${encodeURIComponent(projectId)}/sessions`, { method: 'POST', body: JSON.stringify({ title, model }) })
    return result.session
  },
  async updateSession(projectId: string, sessionId: string, changes: { title?: string; archived?: boolean }) {
    const result = await requestJson<{ session: SessionRecord }>(`/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`, { method: 'PATCH', body: JSON.stringify(changes) })
    return result.session
  },
  async listFiles(projectId: string) {
    return (await requestJson<{ files: WorkspaceFile[] }>(`/api/projects/${encodeURIComponent(projectId)}/files`)).files
  },
  async readFile(projectId: string, path: string) {
    const query = new URLSearchParams({ path })
    return requestJson<{ content: string; language: string }>(`/api/projects/${encodeURIComponent(projectId)}/file?${query}`)
  },
  saveFile(projectId: string, path: string, content: string) {
    return requestJson<{ saved: boolean }>(`/api/projects/${encodeURIComponent(projectId)}/file`, { method: 'PUT', body: JSON.stringify({ path, content }) })
  },
  gitStatus: (projectId: string) => requestJson<GitStatus>(`/api/projects/${encodeURIComponent(projectId)}/git/status`),
  gitInit: (projectId: string) => requestJson<{ initialized: boolean; branch: string }>(`/api/projects/${encodeURIComponent(projectId)}/git/init`, { method: 'POST', body: JSON.stringify({}) }),
  gitDiff: (projectId: string, path: string) => requestJson<GitDiff>(`/api/projects/${encodeURIComponent(projectId)}/git/diff?${new URLSearchParams({ path })}`),
  gitStage: (projectId: string, path: string) => requestJson<{ staged: boolean }>(`/api/projects/${encodeURIComponent(projectId)}/git/stage`, { method: 'POST', body: JSON.stringify({ path }) }),
  gitUnstage: (projectId: string, path: string) => requestJson<{ staged: boolean }>(`/api/projects/${encodeURIComponent(projectId)}/git/unstage`, { method: 'POST', body: JSON.stringify({ path }) }),
  gitCommit: (projectId: string, message: string) => requestJson<{ hash: string; message: string }>(`/api/projects/${encodeURIComponent(projectId)}/git/commit`, { method: 'POST', body: JSON.stringify({ message }) }),
  async messages(projectId: string, sessionId: string) {
    const result = await requestJson<{ messages: { id: string; role: string; content: unknown; model: string; inputTokens: number; outputTokens: number; createdAt: number }[] }>(`/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/messages`)
    return result.messages.map(message => ({ id: message.id, role: message.role === 'user' ? 'user' as const : 'assistant' as const, content: textContent(message.content), model: message.model, inputTokens: message.inputTokens, outputTokens: message.outputTokens, attachments: attachmentMetadata(message.content), steps: toolSteps(message.content), time: new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }))
  },
}

function textContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(block => block && typeof block === 'object' && 'text' in block && typeof block.text === 'string' ? block.text : '').filter(Boolean).join('\n\n')
  if (content && typeof content === 'object' && 'text' in content && typeof content.text === 'string') return content.text
  return ''
}

function toolSteps(content: unknown): ToolStep[] {
  if (!Array.isArray(content)) return []
  return content.flatMap(block => block && typeof block === 'object' && 'type' in block && block.type === 'tool_use' && 'name' in block && typeof block.name === 'string'
    ? [{ tool: block.name, summary: 'summary' in block && typeof block.summary === 'string' ? block.summary : '' }]
    : [])
}

function attachmentMetadata(content: unknown): AttachmentInfo[] {
  if (!content || typeof content !== 'object' || !('attachments' in content) || !Array.isArray(content.attachments)) return []
  return content.attachments.filter((item): item is AttachmentInfo => Boolean(item && typeof item === 'object' && 'id' in item && typeof item.id === 'string' && 'name' in item && typeof item.name === 'string' && 'mimeType' in item && typeof item.mimeType === 'string' && 'byteSize' in item && typeof item.byteSize === 'number'))
}

function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'сейчас'
  if (minutes < 60) return `${minutes} мин назад`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} ч назад`
  return `${Math.floor(minutes / 1440)} дн назад`
}

export function toUiProject(record: ProjectRecord): Project {
  const sessions: Session[] = record.sessions.filter(session => !session.archived).map(session => ({
    id: session.id,
    title: session.title,
    status: session.status === 'working' ? 'active' : session.status === 'done' ? 'done' : 'idle',
    updated: relativeTime(session.updatedAt),
  }))
  const colorIndex = [...record.id].reduce((value, char) => (value + char.charCodeAt(0)) % projectColors.length, 0)
  const isWorking = record.sessions.some(session => session.status === 'working')
  const hasError = record.sessions.some(session => session.status === 'error')
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    instructions: record.instructions,
    defaultModel: record.defaultModel,
    repo: `workspace/${record.name}`,
    branch: 'main',
    color: projectColors[colorIndex],
    mark: record.name.slice(0, 1).toUpperCase(),
    status: hasError ? 'attention' : isWorking ? 'working' : 'ready',
    updated: relativeTime(record.updatedAt),
    sessions,
  }
}

export function toUiMessages(messages: ChatMessage[]): ChatMessage[] { return messages }
