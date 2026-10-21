import type { HarnessKind } from '../../shared/types'
import { runClaude } from './claude'
import { runCodex } from './codex'
import {
  deleteOpencodeSession,
  runOpencode,
} from './opencode'
import type {
  HarnessRunOptions,
  HarnessRunResult,
} from './types'

export async function runHarnessCli(
  kind: HarnessKind,
  options: HarnessRunOptions,
): Promise<HarnessRunResult> {
  switch (kind) {
    case 'opencode':
      return runOpencode(options)
    case 'claude-code':
      return runClaude(options)
    case 'codex':
      return runCodex(options)
    case 'openai-compatible':
      return {
        text: '',
        tokens: 0,
        costUsd: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: 0,
        error: 'OpenAI 兼容 API 尚未接入，请改用 opencode、Claude Code 或 Codex',
        exitCode: null,
      }
  }
}

export async function deleteHarnessSession(
  kind: HarnessKind,
  sessionId: string,
): Promise<boolean> {
  if (kind === 'opencode') return deleteOpencodeSession(sessionId)
  return false
}

export type { HarnessRunOptions, HarnessRunResult }
