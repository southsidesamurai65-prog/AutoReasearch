import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { DEFAULT_MODEL } from '../../shared/presets'
import type {
  HarnessRuntimeStatus,
  HarnessStatus,
} from '../../shared/types'
import type {
  HarnessRunOptions,
  HarnessRunResult,
} from './types'

const execFileAsync = promisify(execFile)

let cachedStatus: { at: number; status: HarnessStatus } | null = null

async function probeRuntime(
  command: string,
): Promise<HarnessRuntimeStatus> {
  try {
    const { stdout } = await execFileAsync(command, ['--version'], {
      timeout: 10_000,
    })
    return { available: true, version: stdout.trim() }
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function getHarnessStatus(force = false): Promise<HarnessStatus> {
  if (!force && cachedStatus && Date.now() - cachedStatus.at < 60_000) {
    return cachedStatus.status
  }

  const [opencode, claude, codex] = await Promise.all([
    probeRuntime('opencode'),
    probeRuntime('claude'),
    probeRuntime('codex'),
  ])

  const status: HarnessStatus = {
    available:
      opencode.available || claude.available || codex.available,
    version: opencode.version,
    error: opencode.error,
    defaultModel: DEFAULT_MODEL,
    models: [],
    runtimes: {
      opencode,
      'claude-code': claude,
      codex,
      'openai-compatible': {
        available: false,
        error: '暂未接入直连 API',
      },
    },
  }

  cachedStatus = { at: Date.now(), status }
  return status
}

export async function deleteOpencodeSession(sessionId: string): Promise<boolean> {
  try {
    await execFileAsync('opencode', ['session', 'delete', sessionId], {
      timeout: 15_000,
    })
    return true
  } catch {
    return false
  }
}

interface ParsedEvent {
  type?: string
  sessionID?: string
  part?: {
    id?: string
    type?: string
    text?: string
    tool?: string
    tokens?: {
      total?: number
      cache?: { read?: number; write?: number }
    }
    cost?: number
    state?: { status?: string }
  }
  error?: {
    name?: string
    data?: { message?: string; statusCode?: number }
  }
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

export function runOpencode(options: HarnessRunOptions): Promise<HarnessRunResult> {
  const model = options.model.trim()
  if (!/^[\w.-]+\/[\w.:-]+$/.test(model)) {
    return Promise.resolve({
      text: '',
      tokens: 0,
      costUsd: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: 0,
      error: `模型格式无效：${model || '(空)'}`,
      exitCode: null,
    })
  }

  const args = [
    'run',
    '--model',
    model,
    '--format',
    'json',
    '--dir',
    options.cwd,
  ]
  if (options.sessionId) {
    args.push('--session', options.sessionId)
  } else {
    args.push('--title', options.title ?? 'AUTO research')
  }
  if (options.autoApprove !== false) args.push('--auto')
  args.push(options.prompt)

  return new Promise((resolve) => {
    let settled = false
    let timedOut = false
    let aborted = false
    let stderr = ''
    let tokens = 0
    let costUsd = 0
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    let toolCalls = 0
    let steps = 0
    let sessionID: string | undefined
    let runtimeError: string | undefined
    const textParts = new Map<string, { order: number; text: string }>()
    const seenTools = new Set<string>()
    let order = 0

    const finalise = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
      const text = [...textParts.values()]
        .sort((a, b) => a.order - b.order)
        .map((part) => part.text)
        .join('')

      let error = runtimeError
      if (aborted) error = '已取消'
      else if (timedOut) error = 'harness 执行超时'
      else if (!error && exitCode !== 0) {
        const tail = stripAnsi(stderr).trim().split('\n').slice(-6).join('\n')
        error = tail || `opencode 退出码 ${exitCode}`
      }

      resolve({
        text,
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

    const child = spawn('opencode', args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timeout = setTimeout(() => {
      timedOut = true
      terminate(child)
    }, options.timeoutMs ?? 10 * 60 * 1000)
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
        let event: ParsedEvent
        try {
          event = JSON.parse(trimmed) as ParsedEvent
        } catch {
          return
        }

        if (event.sessionID) sessionID = event.sessionID

        if (event.type === 'text' && event.part?.text) {
          const id = event.part.id ?? `text-${order}`
          const previous = textParts.get(id)
          if (!previous) {
            textParts.set(id, { order: order++, text: event.part.text })
            options.onText?.(event.part.text, event.part.text)
          } else if (event.part.text !== previous.text) {
            const delta = event.part.text.startsWith(previous.text)
              ? event.part.text.slice(previous.text.length)
              : event.part.text
            previous.text = event.part.text
            options.onText?.(delta, event.part.text)
          }
        }

        if (event.type === 'step_finish' && event.part) {
          steps += 1
          tokens += event.part.tokens?.total ?? 0
          cacheReadTokens += event.part.tokens?.cache?.read ?? 0
          cacheWriteTokens += event.part.tokens?.cache?.write ?? 0
          costUsd += event.part.cost ?? 0

          if (!runtimeError && options.maxSteps && steps > options.maxSteps) {
            runtimeError = `已达到最大轮次限制（${options.maxSteps}）`
            terminate(child)
          } else if (
            !runtimeError &&
            options.maxCostUsd !== undefined &&
            costUsd > options.maxCostUsd
          ) {
            runtimeError = `已达到预算上限（$${options.maxCostUsd.toFixed(4)}）`
            terminate(child)
          }
        }

        if (event.type === 'tool_use' && event.part) {
          const status = event.part.state?.status ?? ''
          const tool = event.part.tool ?? 'tool'
          if (status === 'completed' || status === 'error') {
            const callID = `${tool}:${event.part.id ?? toolCalls}`
            if (!seenTools.has(callID)) {
              seenTools.add(callID)
              toolCalls += 1
            }
          }
          options.onTool?.(tool, status)
        }

        if (event.type === 'error') {
          runtimeError =
            event.error?.data?.message ?? event.error?.name ?? 'harness 返回错误'
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
