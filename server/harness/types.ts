export interface HarnessRunOptions {
  prompt: string
  cwd: string
  model: string
  title?: string
  sessionId?: string
  signal?: AbortSignal
  timeoutMs?: number
  maxSteps?: number
  maxCostUsd?: number
  env?: NodeJS.ProcessEnv
  ephemeral?: boolean
  autoApprove?: boolean
  onText?: (delta: string, fullText: string) => void
  onTool?: (tool: string, status: string) => void
}

export interface HarnessRunResult {
  text: string
  tokens: number
  costUsd: number
  cacheReadTokens: number
  cacheWriteTokens: number
  toolCalls: number
  sessionID?: string
  error?: string
  exitCode: number | null
}
