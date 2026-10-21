import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type {
  HarnessRunOptions,
  HarnessRunResult,
} from './types'

interface CodexEvent {
  type?: string
  thread_id?: string
  item?: {
    id?: string
    type?: string
    text?: string
    message?: string
  }
  usage?: {
    input_tokens?: number
    cached_input_tokens?: number
    cache_write_input_tokens?: number
    output_tokens?: number
    reasoning_output_tokens?: number
    cost_usd?: number
  }
  error?: string | { message?: string }
  message?: string
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '')
}

function terminate(child: ChildProcess): void {
  if (!child.pid) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid!, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }, 3000)
  timer.unref()
}

function errorMessage(error: CodexEvent['error']): string | undefined {
  if (typeof error === 'string') return error
  return error?.message
}

export function runCodex(
  options: HarnessRunOptions,
): Promise<HarnessRunResult> {
  const safety = [
    '-c',
    'sandbox_mode="workspace-write"',
    '-c',
    'approval_policy="never"',
  ]
  const args = options.sessionId
    ? [
        'exec',
        'resume',
        '--json',
        '--skip-git-repo-check',
        ...safety,
        ...(options.ephemeral ? ['--ephemeral'] : []),
        ...(options.model.trim() ? ['-m', options.model.trim()] : []),
        options.sessionId,
        options.prompt,
      ]
    : [
        'exec',
        '--json',
        '--skip-git-repo-check',
        ...safety,
        ...(options.ephemeral ? ['--ephemeral'] : []),
        ...(options.model.trim() ? ['-m', options.model.trim()] : []),
        options.prompt,
      ]

  return new Promise((resolve) => {
    let settled = false
    let timedOut = false
    let aborted = false
    let stderr = ''
    let sessionID: string | undefined
    let runtimeError: string | undefined
    let warning: string | undefined
    let costUsd = 0
    let tokens = 0
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    let toolCalls = 0
    let turns = 0
    const texts: string[] = []

    const emitText = (text: string) => {
      if (!text) return
      texts.push(text)
      options.onText?.(text, texts.join('\n\n'))
    }

    const finalise = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)

      let error = runtimeError
      if (aborted) error = '已取消'
      else if (timedOut) error = 'harness 执行超时'
      else if (!error && exitCode !== 0) {
        const tail = stripAnsi(stderr).trim().split('\n').slice(-6).join('\n')
        error = tail || `codex 退出码 ${exitCode}`
      }
      if (!error && texts.length === 0) {
        error = warning || 'Codex 没有返回结果'
      }

      resolve({
        text: texts.join('\n\n'),
        tokens,
        costUsd: Number(costUsd.toFixed(6)),
        cacheReadTokens,
        cacheWriteTokens,
        toolCalls,
        sessionID,
        error,
        exitCode,
      })
    }

    const child = spawn('codex', args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timeout = setTimeout(() => {
      timedOut = true
      terminate(child)
    }, options.timeoutMs ?? 15 * 60 * 1000)
    timeout.unref()

    const onAbort = () => {
      aborted = true
      terminate(child)
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-12_000)
    })

    if (child.stdout) {
      const reader = createInterface({ input: child.stdout })
      reader.on('line', (line) => {
        const trimmed = line.trim()
        if (!trimmed) return
        let event: CodexEvent
        try {
          event = JSON.parse(trimmed) as CodexEvent
        } catch {
          return
        }

        if (event.thread_id) sessionID = event.thread_id

        if (event.type === 'turn.started') {
          turns += 1
          if (
            !runtimeError &&
            options.maxSteps &&
            turns > options.maxSteps
          ) {
            runtimeError = `已达到最大轮次限制（${options.maxSteps}）`
            terminate(child)
          }
        }

        if (event.type === 'item.completed' && event.item) {
          const item = event.item
          if (item.type === 'agent_message' && item.text) {
            emitText(item.text)
          } else if (item.type === 'error') {
            warning = item.message ?? 'Codex 返回警告'
          } else if (
            item.type &&
            item.type !== 'reasoning' &&
            item.type !== 'todo_list'
          ) {
            toolCalls += 1
            options.onTool?.(item.type, 'completed')
          }
        }

        if (event.type === 'turn.completed') {
          const usage = event.usage
          if (usage) {
            tokens =
              (usage.input_tokens ?? 0) +
              (usage.output_tokens ?? 0) +
              (usage.cache_write_input_tokens ?? 0)
            cacheReadTokens = usage.cached_input_tokens ?? 0
            cacheWriteTokens = usage.cache_write_input_tokens ?? 0
            costUsd = usage.cost_usd ?? 0
          }
        }

        if (event.type === 'turn.failed' || event.type === 'error') {
          runtimeError =
            errorMessage(event.error) ??
            event.message ??
            'Codex 执行失败'
        }
      })
    }

    child.on('error', (error) => {
      runtimeError = error.message
      finalise(null)
    })

    child.on('close', (code) => {
      finalise(code)
    })
  })
}
