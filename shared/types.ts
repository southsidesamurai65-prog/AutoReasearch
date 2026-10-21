export type AgentRole =
  | 'boss'
  | 'backend'
  | 'frontend'
  | 'debug'
  | 'hard'
  | 'search'
  | 'teacher'
  | 'custom'

export type HarnessKind = 'opencode' | 'claude-code' | 'codex' | 'openai-compatible'

export type RunMode = 'mock' | 'real'
export type ThreadMode = 'continue' | 'new'
export type SubagentSessionPolicy = 'delete' | 'keep'

export interface NetworkSettings {
  enabled: boolean
  httpProxy: string
  httpsProxy: string
  noProxy: string
  caCertPath: string
}

export interface RuntimeSettings {
  runTimeoutMinutes: number
  subagentSessionPolicy: SubagentSessionPolicy
}

export interface AppSettings {
  network: NetworkSettings
  runtime: RuntimeSettings
}

export interface AgentConfig {
  id: string
  name: string
  role: AgentRole
  description: string
  systemPrompt: string
  harness: HarnessKind
  model: string
  baseUrl: string
  apiKey: string
  maxTurns: number
  budgetUsd: number
  enabled: boolean
  color: string
}

export type PublicAgentConfig = Omit<AgentConfig, 'apiKey'> & { hasKey: boolean }

export interface AppConfig {
  projectName: string
  workspace: string
  defaultModel: string
  agents: PublicAgentConfig[]
  settings: AppSettings
}

export interface WorkspaceInfo {
  path: string
  name: string
  writable: boolean
  isGit: boolean
}

export interface RecentWorkspace {
  path: string
  name: string
  lastOpened: string
}

export interface ThreadInfo {
  active: boolean
  turns: number
  model: string | null
  lastUsedAt: string | null
  memoryChars: number
}

export interface WorkspaceState {
  workspace: WorkspaceInfo
  recent: RecentWorkspace[]
  thread: ThreadInfo
}

export interface WorkspaceFile {
  path: string
  name: string
  size: number
  modifiedAt: string
  ext: string
}

export type ReferenceMode = 'linked' | 'uploaded'

export interface ReferenceItem {
  id: string
  name: string
  sourcePath: string
  workspacePath: string
  mode: ReferenceMode
  size: number
  addedAt: string
  exists: boolean
}

export interface FsEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  ext?: string
}

export interface FsListing {
  path: string
  parent: string | null
  entries: FsEntry[]
}

export interface HarnessStatus {
  available: boolean
  version?: string
  error?: string
  defaultModel: string
  models: string[]
}

export type RunStatus = 'running' | 'done' | 'error' | 'cancelled'
export type CallStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface CallNode {
  id: string
  parentId: string | null
  agentId: string
  agentName: string
  role: AgentRole
  color: string
  task: string
  status: CallStatus
  startedAt?: string
  endedAt?: string
  tokens?: number
  costUsd?: number
  summary?: string
  output?: string
  toolCalls?: number
}

export interface TeacherSection {
  heading: string
  body: string
}

export interface TeacherBrief {
  title: string
  intro: string
  mermaid: string
  sections: TeacherSection[]
  glossary: { term: string; meaning: string }[]
}

export type RunEvent =
  | {
      type: 'run.started'
      at: string
      runId: string
      prompt: string
      files: string[]
      mode: RunMode
      workspace: string
      threadMode: ThreadMode
    }
  | { type: 'boss.delta'; at: string; text: string }
  | { type: 'call.started'; at: string; call: CallNode }
  | {
      type: 'call.updated'
      at: string
      id: string
      patch: Partial<CallNode>
    }
  | { type: 'call.delta'; at: string; id: string; text: string }
  | { type: 'teacher.ready'; at: string; brief: TeacherBrief }
  | {
      type: 'run.finished'
      at: string
      status: RunStatus
      summary: string
    }
  | {
      type: 'log'
      at: string
      level: 'info' | 'warn' | 'error'
      message: string
    }

export interface WorkspaceCheckpoint {
  ref: string
  commit: string
  createdAt: string
}

export interface WorkspaceDiff {
  checkpoint: WorkspaceCheckpoint
  stat: string
  diff: string
  status: string
  truncated: boolean
}

export interface RunSnapshot {
  id: string
  prompt: string
  files: string[]
  mode: RunMode
  workspace: string
  threadMode: ThreadMode
  bossSessionId?: string
  checkpoint?: WorkspaceCheckpoint
  status: RunStatus
  startedAt: string
  endedAt?: string
  calls: CallNode[]
  bossReport: string
  teacher?: TeacherBrief
  summary?: string
  events: RunEvent[]
}

export interface RunSummary {
  id: string
  prompt: string
  mode: RunMode
  workspace: string
  threadMode: ThreadMode
  status: RunStatus
  startedAt: string
  endedAt?: string
  summary?: string
  tokens: number
  costUsd: number
  callCount: number
  checkpoint?: WorkspaceCheckpoint
}

export interface CreateRunResponse {
  runId: string
}

export interface CreateRunInput {
  prompt: string
  mode: RunMode
  threadMode: ThreadMode
}
