import type { HarnessKind } from '../../shared/types'
import { runClaude } from './claude'
import { runCodex } from './codex'
import { runOpenAICompatible } from './openai'
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
      return runOpenAICompatible(options)
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
