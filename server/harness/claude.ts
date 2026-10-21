import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type {
  HarnessRunOptions,
  HarnessRunResult,
} from './types'

interface ClaudeEvent {
  type?: string
  subtype?: string
  session_id?: string
  result?: string
  is_error?: boolean
  total_cost_usd?: number
  duration_ms?: number
  num_turns?: number
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  message?: {
    content?: Array<{
      type?: string
      text?: string
      name?: string
    }>
  }
  parent_tool_use_id?: string | null
  error?: string
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

export function runClaude(
  options: HarnessRunOptions,
): Promise<HarnessRunResult> {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
  ]
  if (options.model.trim()) {
    args.push('--model', options.model.trim())
  }
  if (options.sessionId) {
    args.push('--resume', options.sessionId)
  }
  if (options.ephemeral) {
    args.push('--no-session-persistence')
  }
  if (options.autoApprove !== false) {
    args.push('--permission-mode', 'bypassPermissions')
  }
  if (options.maxCostUsd !== undefined) {
    args.push(
      '--max-budget-usd',
      Math.max(0.0001, options.maxCostUsd).toFixed(4),
    )
  }
  args.push(options.prompt)

  return new Promise((resolve) => {
    let settled = false
    let timedOut = false
    let aborted = false
    let stderr = ''
    let sessionID: string | undefined
    let runtimeError: string | undefined
    let resultText: string | undefined
    let totalCost = 0
    let tokens = 0
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    let toolCalls = 0
    let turns = 0
    let resultReceived = false
    const texts: string[] = []
    const usage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    }

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
        error = tail || `claude 退出码 ${exitCode}`
      }

      if (!resultReceived && !error && texts.length === 0) {
        error = 'Claude Code 没有返回结果'
      }

      if (resultReceived) {
        tokens =
          usage.input + usage.output + usage.cacheRead + usage.cacheWrite
        cacheReadTokens = usage.cacheRead
        cacheWriteTokens = usage.cacheWrite
      }

      resolve({
        text: texts.join('\n\n') || resultText || '',
        tokens,
        costUsd: Number(totalCost.toFixed(6)),
        cacheReadTokens,
        cacheWriteTokens,
        toolCalls,
        sessionID,
        error,
        exitCode,
      })
    }

    const child = spawn('claude', args, {
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
        let event: ClaudeEvent
        try {
          event = JSON.parse(trimmed) as ClaudeEvent
        } catch {
          return
        }

        if (event.session_id) sessionID = event.session_id

        if (event.type === 'assistant' && event.message?.content) {
          const text = event.message.content
            .filter((block) => block.type === 'text' && block.text)
            .map((block) => block.text ?? '')
            .join('')
          if (event.parent_tool_use_id == null) {
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
          if (text) emitText(text)
          for (const block of event.message.content) {
            if (block.type === 'tool_use') {
              toolCalls += 1
              options.onTool?.(block.name ?? 'tool', 'completed')
            }
          }
          if (event.usage) {
            usage.input += event.usage.input_tokens ?? 0
            usage.output += event.usage.output_tokens ?? 0
            usage.cacheRead += event.usage.cache_read_input_tokens ?? 0
            usage.cacheWrite +=
              event.usage.cache_creation_input_tokens ?? 0
          }
        }

        if (event.type === 'result') {
          resultReceived = true
          resultText = event.result
          totalCost = event.total_cost_usd ?? totalCost
          if (event.usage) {
            usage.input = event.usage.input_tokens ?? usage.input
            usage.output = event.usage.output_tokens ?? usage.output
            usage.cacheRead =
              event.usage.cache_read_input_tokens ?? usage.cacheRead
            usage.cacheWrite =
              event.usage.cache_creation_input_tokens ?? usage.cacheWrite
          }
          if (texts.length === 0 && event.result) emitText(event.result)
          if (event.is_error || (event.subtype && event.subtype !== 'success')) {
            runtimeError =
              event.result || `Claude Code ${event.subtype ?? '执行失败'}`
          }
        }

        if (event.type === 'error') {
          runtimeError = event.error ?? 'Claude Code 返回错误'
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
