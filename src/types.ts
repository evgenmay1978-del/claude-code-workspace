export type View = 'Chat' | 'Terminal' | 'Files' | 'Source Control'
export type SessionStatus = 'active' | 'idle' | 'done'

export interface Session {
  id: string
  title: string
  status: SessionStatus
  updated: string
}

export interface Project {
  id: string
  name: string
  description: string
  instructions: string
  defaultModel: string
  repo: string
  branch: string
  color: string
  mark: string
  status: 'working' | 'ready' | 'attention'
  updated: string
  sessions: Session[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  time: string
  attachments?: AttachmentInfo[]
}

export interface AttachmentInfo {
  id: string
  name: string
  mimeType: string
  byteSize: number
  createdAt?: number
}

export interface ProjectFile {
  path: string
  kind: 'folder' | 'file'
  language?: string
  context?: boolean
}

export interface ChangeFile {
  path: string
  kind: 'M' | 'A' | 'D'
  staged: boolean
  unstaged?: boolean
}
