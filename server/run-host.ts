import type {
  AgentConfig,
  CallNode,
  ReferenceItem,
  RunEvent,
  RunSnapshot,
  RunStatus,
  ThreadMode,
  WorkspaceFile,
} from '../shared/types'

export interface RunHost {
  snapshot: RunSnapshot
  signal: AbortSignal
  agents: AgentConfig[]
  refs: ReferenceItem[]
  workspaceFiles: WorkspaceFile[]
  bossCall: CallNode
  threadMode: ThreadMode
  bossSessionId: string | null
  threadMemory: string
  threadNotice?: string
  emit(event: RunEvent): void
  log(message: string, level?: 'info' | 'warn' | 'error'): void
  emitBoss(text: string): void
  finish(status: RunStatus, summary: string): void
  saveThread(sessionId: string, memory: string): Promise<void>
}
