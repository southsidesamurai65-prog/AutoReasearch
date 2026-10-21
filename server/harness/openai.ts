import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { DATA_DIR } from '../paths'
import type {
  HarnessRunOptions,
  HarnessRunResult,
} from './types'

const SESSIONS_DIR = path.join(DATA_DIR, 'api-sessions')
const MAX_STEPS = 24
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_FILE_CHARS = 60_000
const MAX_WRITE_CHARS = 200_000
const MAX_TOOL_OUTPUT = 20_000
const MAX_LIST_ENTRIES = 600
const MAX_SESSION_MESSAGES = 160
const KEEP_SESSION_MESSAGES = 120

interface FunctionCall {
  name?: string
  arguments?: string
}

interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

interface ChatResponse {
  choices?: Array<{
    message?: {
      content?: unknown
      tool_calls?: Array<{
        id?: string
        type?: string
        function?: FunctionCall
      }>
      function_call?: FunctionCall
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_tokens_details?: {
      cached_tokens?: number
    }
  }
  error?: {
    message?: string
  }
}

interface StoredSession {
  id: string
  updatedAt: string
  messages: ChatMessage[]
}

interface ToolContext {
  cwd: string
  env: NodeJS.ProcessEnv
  allowWrite: boolean
  signal?: AbortSignal
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        '读取工作区内的文本文件。path 可以使用相对工作区的路径。offset/limit 按行截取，默认最多 2000 行。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          offset: { type: 'integer', description: '起始行，从 1 开始' },
          limit: { type: 'integer', description: '最多读取多少行' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        '列出工作区内的文件和目录。会跳过 .git、node_modules 等噪声目录。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '起始目录，默认 .' },
          depth: { type: 'integer', description: '递归深度，默认 2，最大 4' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        '在工作区内写入文本文件；会自动创建父目录，但不能修改 .auto/refs 外部引用。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '完整文件内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        '在工作区运行 shell 命令，返回退出码和输出。适用于检索、构建、测试和 git 操作。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的 shell 命令' },
          timeout_seconds: {
            type: 'number',
            description: '超时秒数，默认 120，最大 300',
          },
        },
        required: ['command'],
      },
    },
  },
]

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (relative !== '' &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative))
  )
}

async function realRoot(cwd: string): Promise<string> {
  return fs.realpath(path.resolve(cwd))
}

async function resolveReadable(
  root: string,
  input: string,
): Promise<string> {
  const abs = path.resolve(root, input || '.')
  if (!isInside(root, abs)) throw new Error('路径超出工作区')
  let real: string
  try {
    real = await fs.realpath(abs)
  } catch {
    throw new Error(`文件不存在：${input}`)
  }
  if (!isInside(root, real)) throw new Error('路径超出工作区')
  return real
}

async function resolveWritable(
  root: string,
  input: string,
): Promise<string> {
  const abs = path.resolve(root, input || '.')
  if (!isInside(root, abs)) throw new Error('路径超出工作区')

  let existing = abs
  let missing: string[] = []
  while (true) {
    try {
      const real = await fs.realpath(existing)
      const target = path.join(real, ...missing)
      if (!isInside(root, target)) throw new Error('路径超出工作区')
      if (
        isInside(path.join(root, '.auto', 'refs'), target)
      ) {
        throw new Error('外部引用只读，不能写入')
      }
      return target
    } catch (error) {
      if (
        error instanceof Error &&
        !/ENOENT/.test((error as NodeJS.ErrnoException).code ?? '')
      ) {
        throw error
      }
      const parent = path.dirname(existing)
      if (parent === existing) throw new Error('路径超出工作区')
      missing = [path.basename(existing), ...missing]
      existing = parent
    }
  }
}

function stringValue(
  args: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function numberValue(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = args[key]
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback
}

function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('工具参数必须是 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n…（已截断 ${value.length - max} 字符）`
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
  }, 2000)
  timer.unref()
}

async function readFileTool(
  root: string,
  args: Record<string, unknown>,
): Promise<string> {
  const input = stringValue(args, 'path', 'file', 'file_path')
  if (!input) throw new Error('缺少 path 参数')
  const file = await resolveReadable(root, input)
  const stat = await fs.stat(file)
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`文件过大（${stat.size} bytes），请分段读取`)
  }
  const buffer = await fs.readFile(file)
  if (buffer.includes(0)) throw new Error('二进制文件不能按文本读取')
  const lines = buffer.toString('utf8').split('\n')
  const offset = Math.max(1, Math.round(numberValue(args, 'offset', 1)))
  const limit = Math.min(
    5000,
    Math.max(1, Math.round(numberValue(args, 'limit', 2000))),
  )
  const selected = lines.slice(offset - 1, offset - 1 + limit)
  if (selected.length === 0) {
    return `${path.relative(root, file)}（共 ${lines.length} 行，offset ${offset} 超出范围）`
  }
  const body = selected
    .map((line, index) => `${offset + index}: ${line}`)
    .join('\n')
  return truncate(
    `${path.relative(root, file)}（第 ${offset}-${offset + selected.length - 1} 行，共 ${lines.length} 行）\n${body}`,
    MAX_FILE_CHARS,
  )
}

async function listFilesTool(
  root: string,
  args: Record<string, unknown>,
): Promise<string> {
  const input = stringValue(args, 'path', 'dir', 'directory') || '.'
  const start = await resolveReadable(root, input)
  const depth = Math.min(
    4,
    Math.max(0, Math.round(numberValue(args, 'depth', 2))),
  )
  const skip = new Set([
    '.git',
    'node_modules',
    '.next',
    'dist',
    'coverage',
    '__pycache__',
  ])
  const lines: string[] = []

  const walk = async (dir: string, level: number): Promise<void> => {
    if (lines.length >= MAX_LIST_ENTRIES) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const entry of entries) {
      if (lines.length >= MAX_LIST_ENTRIES) return
      if (skip.has(entry.name)) continue
      const abs = path.join(dir, entry.name)
      const relative = path.relative(root, abs) || entry.name
      if (entry.isDirectory()) {
        lines.push(`${relative}/`)
        if (level < depth) await walk(abs, level + 1)
      } else if (entry.isFile()) {
        lines.push(relative)
      }
    }
  }

  await walk(start, 0)
  if (lines.length === 0) return '（空目录）'
  if (lines.length >= MAX_LIST_ENTRIES) {
    lines.push(`…（达到 ${MAX_LIST_ENTRIES} 条上限）`)
  }
  return lines.join('\n')
}

async function writeFileTool(
  root: string,
  args: Record<string, unknown>,
): Promise<string> {
  const input = stringValue(args, 'path', 'file', 'file_path')
  const content = stringValue(args, 'content', 'text')
  if (!input) throw new Error('缺少 path 参数')
  if (!('content' in args) && !('text' in args)) {
    throw new Error('缺少 content 参数')
  }
  if (content.length > MAX_WRITE_CHARS) {
    throw new Error(`内容过长（${content.length} 字符），请拆分写入`)
  }
  const target = await resolveWritable(root, input)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content, 'utf8')
  return `已写入 ${path.relative(root, target)}（${content.length} 字符）`
}

async function runCommandTool(
  context: ToolContext,
  args: Record<string, unknown>,
): Promise<string> {
  if (!context.allowWrite) {
    throw new Error('当前运行未授权执行命令')
  }
  const command = stringValue(args, 'command', 'cmd')
  if (!command) throw new Error('缺少 command 参数')
  const timeoutMs =
    Math.min(300, Math.max(1, numberValue(args, 'timeout_seconds', 120))) *
    1000

  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], {
      cwd: context.cwd,
      env: context.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      context.signal?.removeEventListener('abort', onAbort)
      resolve(
        truncate(
          `退出码：${code ?? 'null'}${timedOut ? '（超时）' : ''}\nstdout:\n${stdout || '（空）'}\nstderr:\n${stderr || '（空）'}`,
          MAX_TOOL_OUTPUT,
        ),
      )
    }

    const timer = setTimeout(() => {
      timedOut = true
      terminate(child)
    }, timeoutMs)
    timer.unref()

    const onAbort = () => terminate(child)
    context.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString('utf8')}`.slice(-MAX_TOOL_OUTPUT)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-MAX_TOOL_OUTPUT)
    })
    child.on('error', (error) => {
      stderr = `${stderr}${error.message}`
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}

async function executeTool(
  context: ToolContext,
  name: string,
  rawArguments: string,
): Promise<string> {
  const args = parseToolArguments(rawArguments)
  const root = await realRoot(context.cwd)
  switch (name) {
    case 'read_file':
      return readFileTool(root, args)
    case 'list_files':
      return listFilesTool(root, args)
    case 'write_file':
      if (!context.allowWrite) throw new Error('当前运行未授权写文件')
      return writeFileTool(root, args)
    case 'run_command':
      return runCommandTool(context, args)
    default:
      return `未知工具：${name}`
  }
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text?: unknown }).text
          return typeof text === 'string' ? text : ''
        }
        return ''
      })
      .join('')
  }
  return ''
}

function normalizeToolCalls(
  message: NonNullable<ChatResponse['choices']>[number]['message'],
): ToolCall[] {
  const raw = message?.tool_calls ?? []
  const calls: ToolCall[] = []
  for (const [index, call] of raw.entries()) {
    const name = call.function?.name?.trim()
    if (!name) continue
    calls.push({
      id: call.id?.trim() || `call_${Date.now()}_${index}`,
      type: 'function',
      function: {
        name,
        arguments:
          typeof call.function?.arguments === 'string'
            ? call.function.arguments
            : JSON.stringify(call.function?.arguments ?? {}),
      },
    })
  }
  if (calls.length === 0 && message?.function_call?.name) {
    calls.push({
      id: `call_${Date.now()}_legacy`,
      type: 'function',
      function: {
        name: message.function_call.name,
        arguments:
          typeof message.function_call.arguments === 'string'
            ? message.function_call.arguments
            : JSON.stringify(message.function_call.arguments ?? {}),
      },
    })
  }
  return calls
}

function compactMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= MAX_SESSION_MESSAGES) return messages
  let start = messages.length - KEEP_SESSION_MESSAGES
  while (start < messages.length && messages[start].role !== 'user') {
    start += 1
  }
  if (start >= messages.length) start = messages.length - 40
  return messages.slice(start)
}

function chatCompletionsUrl(baseUrl: string): string {
  const url = baseUrl.trim().replace(/\/+$/, '')
  if (!url) throw new Error('未配置 Base URL')
  if (/\/chat\/completions(?:\?|$)/i.test(url)) return url
  if (/\/(?:v\d+(?:beta)?|openai)$/i.test(url)) {
    return `${url}/chat/completions`
  }
  return `${url}/v1/chat/completions`
}

function sessionPath(sessionId: string): string {
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(sessionId)) {
    throw new Error('会话 ID 格式无效')
  }
  return path.join(SESSIONS_DIR, `${sessionId}.json`)
}

async function loadSession(sessionId: string): Promise<ChatMessage[]> {
  const raw = await fs
    .readFile(sessionPath(sessionId), 'utf8')
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        throw new Error(`直连会话不存在（session not found）：${sessionId}`)
      }
      throw error
    })
  const parsed = JSON.parse(raw) as StoredSession
  if (!Array.isArray(parsed.messages)) {
    throw new Error(`直连会话损坏：${sessionId}`)
  }
  return parsed.messages
}

async function persistSession(
  sessionId: string,
  messages: ChatMessage[],
): Promise<string | undefined> {
  try {
    await saveSession(sessionId, messages)
    return undefined
  } catch (error) {
    return `保存直连会话失败：${error instanceof Error ? error.message : String(error)}`
  }
}

async function saveSession(
  sessionId: string,
  messages: ChatMessage[],
): Promise<void> {
  await fs.mkdir(SESSIONS_DIR, { recursive: true })
  const file = sessionPath(sessionId)
  const temp = `${file}.${process.pid}.tmp`
  const stored: StoredSession = {
    id: sessionId,
    updatedAt: new Date().toISOString(),
    messages: compactMessages(messages),
  }
  await fs.writeFile(temp, JSON.stringify(stored), 'utf8')
  await fs.rename(temp, file)
}

async function requestChat(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ChatResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  const raw = await response.text()
  let parsed: ChatResponse | null = null
  try {
    parsed = JSON.parse(raw) as ChatResponse
  } catch {
    parsed = null
  }

  if (!response.ok) {
    const detail =
      parsed?.error?.message?.trim() ||
      raw.trim().slice(0, 600) ||
      response.statusText
    throw new Error(`API 请求失败（HTTP ${response.status}）：${detail}`)
  }
  if (!parsed) throw new Error('API 返回的不是 JSON')
  return parsed
}

function addUsage(
  response: ChatResponse,
  totals: { tokens: number; cacheRead: number },
): void {
  const usage = response.usage
  if (!usage) return
  totals.tokens +=
    usage.total_tokens ??
    (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0)
  totals.cacheRead += usage.prompt_tokens_details?.cached_tokens ?? 0
}

export async function runOpenAICompatible(
  options: HarnessRunOptions,
): Promise<HarnessRunResult> {
  const model = options.model.trim()
  if (!model) {
    return errorResult('OpenAI 兼容 API 需要填写模型名')
  }
  let url: string
  try {
    url = chatCompletionsUrl(options.baseUrl ?? '')
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error))
  }

  const persist = !options.ephemeral
  const sessionId =
    persist && options.sessionId && options.sessionId.trim()
      ? options.sessionId.trim()
      : persist
        ? `api-${nanoid(16)}`
        : undefined

  let messages: ChatMessage[] = []
  if (options.sessionId?.trim() && persist) {
    try {
      messages = compactMessages(await loadSession(options.sessionId.trim()))
    } catch (error) {
      return errorResult(
        error instanceof Error ? error.message : String(error),
      )
    }
  }
  messages.push({ role: 'user', content: options.prompt })

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? 15 * 60 * 1000)
  timer.unref()
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })

  let steps = 0
  let toolCalls = 0
  let toolsEnabled = options.autoApprove !== false
  let toolsFallbackTried = false
  let runtimeError: string | undefined
  const texts: string[] = []
  const usage = { tokens: 0, cacheRead: 0 }

  try {
    while (true) {
      if (options.signal?.aborted) {
        runtimeError = '已取消'
        break
      }
      const maxSteps = options.maxSteps ?? MAX_STEPS
      steps += 1
      if (steps > maxSteps) {
        runtimeError = `已达到最大轮次限制（${maxSteps}）`
        break
      }

      let response: ChatResponse
      try {
        response = await requestChat(
          url,
          options.apiKey ?? '',
          {
            model,
            messages,
            ...(toolsEnabled ? { tools: TOOLS } : {}),
          },
          controller.signal,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (
          toolsEnabled &&
          !toolsFallbackTried &&
          /tool|function|unsupported|not support|unknown field/i.test(message)
        ) {
          toolsEnabled = false
          toolsFallbackTried = true
          steps -= 1
          continue
        }
        runtimeError = message
        break
      }

      addUsage(response, usage)
      const message = response.choices?.[0]?.message
      if (!message) {
        runtimeError = 'API 响应缺少 choices[0].message'
        break
      }

      const text = contentText(message.content).trim()
      const calls = toolsEnabled ? normalizeToolCalls(message) : []
      if (text) {
        texts.push(text)
        options.onText?.(text, texts.join('\n\n'))
      }

      if (calls.length === 0) {
        if (text) {
          messages.push({ role: 'assistant', content: text })
        } else {
          runtimeError = 'API 没有返回内容'
        }
        if (sessionId) {
          const saveError = await persistSession(sessionId, messages)
          if (saveError) runtimeError = saveError
        }
        break
      }

      messages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: calls,
      })

      for (const call of calls) {
        toolCalls += 1
        const name = call.function.name
        options.onTool?.(name, 'running')
        let output: string
        try {
          output = await executeTool(
            {
              cwd: options.cwd,
              env: { ...process.env, ...options.env },
              allowWrite: options.autoApprove !== false,
              signal: controller.signal,
            },
            name,
            call.function.arguments,
          )
          options.onTool?.(name, 'completed')
        } catch (error) {
          output = `工具错误：${error instanceof Error ? error.message : String(error)}`
          options.onTool?.(name, 'error')
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: truncate(output, MAX_TOOL_OUTPUT),
        })
      }
      if (sessionId) {
        const saveError = await persistSession(sessionId, messages)
        if (saveError) {
          runtimeError = saveError
          break
        }
      }
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }

  if (timedOut) runtimeError = 'harness 执行超时'
  else if (options.signal?.aborted) runtimeError = '已取消'

  return {
    text: texts.join('\n\n'),
    tokens: usage.tokens,
    costUsd: 0,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: 0,
    toolCalls,
    sessionID: sessionId,
    error: runtimeError,
    exitCode: runtimeError ? null : 0,
  }
}

function errorResult(error: string): HarnessRunResult {
  return {
    text: '',
    tokens: 0,
    costUsd: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls: 0,
    error,
    exitCode: null,
  }
}
