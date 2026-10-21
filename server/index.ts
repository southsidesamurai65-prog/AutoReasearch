import { existsSync } from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import type {
  AgentConfig,
  HarnessKind,
  NetworkSettings,
  RunMode,
  RuntimeSettings,
  ThreadMode,
} from '../shared/types'
import { DEFAULT_MODEL } from '../shared/presets'
import {
  addAgent,
  deleteAgent,
  ensureStore,
  getAgents,
  getProjectName,
  getPublicConfig,
  getSettings,
  updateAgent,
  updateSettings,
} from './store'
import {
  addLinkedReference,
  addUploadedReference,
  createDirectory,
  ensureWorkspaceStore,
  getActiveWorkspacePath,
  getBossThread,
  getWorkspaceState,
  listDirectory,
  MAX_THREAD_TURNS,
  listReferences,
  listWorkspaceFiles,
  openWorkspace,
  prepareReferencesForRun,
  removeReference,
} from './workspace'
import {
  deleteHarnessSession,
  runHarnessCli,
} from './harness'
import { getHarnessStatus } from './harness/opencode'
import { proxyEnv } from './network'
import { loadRunHistory } from './run-history'
import {
  cancelRun,
  deleteRun,
  getRunSnapshot,
  listRuns,
  startRun,
  subscribe,
} from './runs'
import {
  getWorkspaceDiff,
  restoreWorkspaceCheckpoint,
} from './workspace-checkpoint'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '127.0.0.1'

const HARNESSES: HarnessKind[] = [
  'opencode',
  'claude-code',
  'codex',
  'openai-compatible',
]

function sanitizeAgentPatch(
  body: unknown,
): Partial<AgentConfig> & { clearKey?: boolean } {
  if (!body || typeof body !== 'object') return {}
  const raw = body as Record<string, unknown>
  const patch: Partial<AgentConfig> & { clearKey?: boolean } = {}

  if (typeof raw.name === 'string' && raw.name.trim()) {
    patch.name = raw.name.trim().slice(0, 40)
  }
  if (typeof raw.description === 'string') {
    patch.description = raw.description.slice(0, 500)
  }
  if (typeof raw.systemPrompt === 'string') {
    patch.systemPrompt = raw.systemPrompt.slice(0, 20_000)
  }
  if (
    typeof raw.harness === 'string' &&
    HARNESSES.includes(raw.harness as HarnessKind)
  ) {
    patch.harness = raw.harness as HarnessKind
  }
  if (typeof raw.model === 'string') {
    patch.model = raw.model.trim().slice(0, 200)
  }
  if (typeof raw.baseUrl === 'string') {
    patch.baseUrl = raw.baseUrl.trim().slice(0, 500)
  }
  if (typeof raw.apiKey === 'string') {
    patch.apiKey = raw.apiKey.slice(0, 500)
  }
  if (raw.clearKey === true) patch.clearKey = true
  if (typeof raw.enabled === 'boolean') patch.enabled = raw.enabled
  if (typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color)) {
    patch.color = raw.color
  }
  if (typeof raw.maxTurns === 'number' && Number.isFinite(raw.maxTurns)) {
    patch.maxTurns = Math.min(200, Math.max(1, Math.round(raw.maxTurns)))
  }
  if (typeof raw.budgetUsd === 'number' && Number.isFinite(raw.budgetUsd)) {
    patch.budgetUsd = Math.min(100, Math.max(0, raw.budgetUsd))
  }

  return patch
}

function sanitizeSettings(body: unknown): {
  network?: Partial<NetworkSettings>
  runtime?: Partial<RuntimeSettings>
} {
  if (!body || typeof body !== 'object') return {}
  const raw = body as Record<string, unknown>
  const result: {
    network?: Partial<NetworkSettings>
    runtime?: Partial<RuntimeSettings>
  } = {}

  if (raw.network && typeof raw.network === 'object') {
    const network = raw.network as Record<string, unknown>
    const next: Partial<NetworkSettings> = {}
    if (typeof network.enabled === 'boolean') next.enabled = network.enabled
    if (typeof network.httpProxy === 'string') {
      next.httpProxy = network.httpProxy.trim().slice(0, 500)
    }
    if (typeof network.httpsProxy === 'string') {
      next.httpsProxy = network.httpsProxy.trim().slice(0, 500)
    }
    if (typeof network.noProxy === 'string') {
      next.noProxy = network.noProxy.trim().slice(0, 2000)
    }
    if (typeof network.caCertPath === 'string') {
      next.caCertPath = network.caCertPath.trim().slice(0, 1000)
    }
    result.network = next
  }

  if (raw.runtime && typeof raw.runtime === 'object') {
    const runtime = raw.runtime as Record<string, unknown>
    const next: Partial<RuntimeSettings> = {}
    if (
      typeof runtime.runTimeoutMinutes === 'number' &&
      Number.isFinite(runtime.runTimeoutMinutes)
    ) {
      next.runTimeoutMinutes = Math.min(
        180,
        Math.max(1, Math.round(runtime.runTimeoutMinutes)),
      )
    }
    if (
      runtime.subagentSessionPolicy === 'delete' ||
      runtime.subagentSessionPolicy === 'keep'
    ) {
      next.subagentSessionPolicy = runtime.subagentSessionPolicy
    }
    result.runtime = next
  }

  return result
}

async function main(): Promise<void> {
  await ensureStore()
  await ensureWorkspaceStore()
  await loadRunHistory()

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 2 * 1024 * 1024,
  })

  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  })

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (!origin) return
    try {
      const hostname = new URL(origin).hostname
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname === '[::1]'
      ) {
        return
      }
    } catch {
      // malformed origins are rejected below
    }
    return reply.code(403).send({ error: 'origin not allowed' })
  })

  app.get('/api/health', async () => ({
    ok: true,
    mode: 'opencode',
    workspace: getActiveWorkspacePath(),
    uptime: process.uptime(),
  }))

  app.get('/api/harness/status', async () => getHarnessStatus())

  app.get('/api/config', async () =>
    getPublicConfig(getActiveWorkspacePath()),
  )

  app.get('/api/settings', async () => getSettings())

  app.put<{ Body: unknown }>('/api/settings', async (request) => {
    return updateSettings(sanitizeSettings(request.body))
  })

  app.post<{ Body: { model?: string } }>(
    '/api/settings/test-model',
    async (request, reply) => {
      const agents = getAgents()
      const boss =
        agents.find((agent) => agent.role === 'boss') ?? agents[0]
      const harness = boss?.harness ?? 'opencode'
      const model =
        typeof request.body?.model === 'string' && request.body.model.trim()
          ? request.body.model.trim()
          : boss?.model.trim() ||
            (harness === 'opencode' ? DEFAULT_MODEL : '')

      if (
        harness === 'opencode' &&
        !/^[\w.-]+\/[\w.:-]+$/.test(model)
      ) {
        return reply.code(400).send({ error: `模型格式无效：${model}` })
      }

      const startedAt = Date.now()
      const settings = getSettings()
      const result = await runHarnessCli(harness, {
        prompt: '请只回复 OK，不要调用任何工具。',
        cwd: getActiveWorkspacePath(),
        model,
        title: 'AUTO model test',
        timeoutMs: 120_000,
        maxSteps: 2,
        maxCostUsd: 1,
        ephemeral: true,
        autoApprove: false,
        env: proxyEnv(settings.network),
      })
      if (harness === 'opencode' && result.sessionID) {
        await deleteHarnessSession(harness, result.sessionID)
      }

      return {
        ok: !result.error,
        harness,
        model: model || '(CLI 默认模型)',
        text: result.text.slice(0, 500),
        error: result.error,
        latencyMs: Date.now() - startedAt,
        tokens: result.tokens,
        costUsd: result.costUsd,
      }
    },
  )

  app.post<{ Body: { presetId?: string; name?: string } }>(
    '/api/agents',
    async (request, reply) => {
      const body = request.body ?? {}
      const agent = await addAgent({
        presetId: typeof body.presetId === 'string' ? body.presetId : undefined,
        name: typeof body.name === 'string' ? body.name : undefined,
      })
      return reply.code(201).send(agent)
    },
  )

  app.put<{ Params: { id: string } }>(
    '/api/agents/:id',
    async (request, reply) => {
      const patch = sanitizeAgentPatch(request.body)
      const agent = await updateAgent(request.params.id, patch)
      if (!agent) return reply.code(404).send({ error: 'agent not found' })
      return agent
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/agents/:id',
    async (request, reply) => {
      const removed = await deleteAgent(request.params.id)
      if (!removed) {
        return reply.code(400).send({ error: 'cannot delete this agent' })
      }
      return { ok: true }
    },
  )

  app.get('/api/workspace', async () => getWorkspaceState())

  app.post<{ Body: { path?: string } }>(
    '/api/workspace/open',
    async (request, reply) => {
      const target = request.body?.path
      if (typeof target !== 'string' || !target.trim()) {
        return reply.code(400).send({ error: 'path is required' })
      }
      return openWorkspace(target)
    },
  )

  app.get('/api/workspace/files', async () => ({
    files: await listWorkspaceFiles(),
  }))

  app.get('/api/workspace/references', async () => ({
    references: await listReferences(),
  }))

  app.post<{ Body: { path?: string } }>(
    '/api/workspace/references',
    async (request, reply) => {
      const target = request.body?.path
      if (typeof target !== 'string' || !target.trim()) {
        return reply.code(400).send({ error: 'path is required' })
      }
      const reference = await addLinkedReference(target)
      return reply.code(201).send(reference)
    },
  )

  app.post('/api/workspace/references/upload', async (request, reply) => {
    const part = await request.file()
    if (!part) return reply.code(400).send({ error: 'no file uploaded' })
    try {
      const buffer = await part.toBuffer()
      const reference = await addUploadedReference(
        part.filename || 'reference.bin',
        buffer,
      )
      return reply.code(201).send(reference)
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'file too large (max 50MB)' })
      }
      throw error
    }
  })

  app.delete<{ Params: { id: string } }>(
    '/api/workspace/references/:id',
    async (request, reply) => {
      const removed = await removeReference(request.params.id)
      if (!removed) return reply.code(404).send({ error: 'reference not found' })
      return { ok: true }
    },
  )

  app.get<{ Querystring: { path?: string } }>(
    '/api/fs/list',
    async (request) => listDirectory(request.query.path),
  )

  app.post<{ Body: { parent?: string; name?: string } }>(
    '/api/fs/mkdir',
    async (request, reply) => {
      const parent = request.body?.parent
      const name = request.body?.name
      if (
        typeof parent !== 'string' ||
        !parent.trim() ||
        typeof name !== 'string' ||
        !name.trim()
      ) {
        return reply.code(400).send({ error: 'parent and name are required' })
      }
      const created = await createDirectory(parent, name)
      return reply.code(201).send({ path: created })
    },
  )

  app.post<{
    Body: { prompt?: string; mode?: string; threadMode?: string }
  }>('/api/runs', async (request, reply) => {
    const prompt =
      typeof request.body?.prompt === 'string'
        ? request.body.prompt.trim()
        : ''
    if (!prompt) {
      return reply.code(400).send({ error: 'prompt is required' })
    }
    if (prompt.length > 20_000) {
      return reply.code(413).send({ error: 'prompt too long' })
    }

    const mode: RunMode = request.body?.mode === 'mock' ? 'mock' : 'real'
    const requestedThreadMode: ThreadMode =
      request.body?.threadMode === 'new' ? 'new' : 'continue'

    const agents = getAgents()

    if (mode === 'real') {
      const harness = await getHarnessStatus()
      const missing = agents.filter(
        (agent) =>
          agent.enabled &&
          !harness.runtimes[agent.harness]?.available,
      )
      if (missing.length > 0) {
        return reply.code(400).send({
          error: `以下 Agent 的 CLI 不可用：${missing
            .map((agent) => `${agent.name}（${agent.harness}）`)
            .join('、')}。请安装/登录对应 CLI，或在 Agent 设置中切换 harness。`,
        })
      }
    }

    const workspace = getActiveWorkspacePath()
    const refs = await prepareReferencesForRun()
    const workspaceFiles = await listWorkspaceFiles()
    const boss =
      agents.find((agent) => agent.role === 'boss') ?? agents[0]
    const bossHarness = boss?.harness ?? 'opencode'
    const bossModel =
      boss?.model.trim() ||
      (bossHarness === 'opencode' ? DEFAULT_MODEL : '')
    const storedThread = getBossThread(workspace)
    const storedHarness = storedThread?.harness ?? 'opencode'

    let threadMode = requestedThreadMode
    let bossSessionId: string | null = null
    let threadMemory = storedThread?.memory ?? ''
    let threadNotice = ''

    if (mode === 'real') {
      if (requestedThreadMode === 'new') {
        threadNotice = threadMemory
          ? '本次新开 Boss 线程，已带入项目记忆。'
          : '本次新开 Boss 线程。'
      } else if (!storedThread?.sessionId) {
        threadMode = 'new'
        threadNotice = '没有可续用的 Boss 会话，本次自动新开。'
      } else if (storedHarness !== bossHarness) {
        threadMode = 'new'
        threadNotice = `Boss harness 已从 ${storedHarness} 更换为 ${bossHarness}，本次自动新开线程，并带入项目记忆。`
      } else if (storedThread.model !== bossModel) {
        threadMode = 'new'
        threadNotice = 'Boss 模型已更换，本次自动新开线程，并带入项目记忆。'
      } else if (storedThread.turns >= MAX_THREAD_TURNS) {
        threadMode = 'new'
        threadNotice = `Boss 会话已达 ${MAX_THREAD_TURNS} 轮，本次自动新开并带入项目记忆。`
      } else {
        bossSessionId = storedThread.sessionId
        threadNotice = `续用上次 Boss 会话（第 ${storedThread.turns + 1} 轮，${storedHarness}，模型 ${storedThread.model || 'CLI 默认'}）。`
      }
    }

    const runId = startRun({
      prompt,
      mode,
      threadMode,
      bossSessionId,
      threadMemory,
      threadNotice,
      files: refs.map((ref) => ref.name),
      agents,
      workspace,
      refs,
      workspaceFiles,
      settings: getSettings(),
    })
    return reply.code(202).send({ runId })
  })

  app.get('/api/runs', async () => ({ runs: listRuns() }))

  app.get<{ Params: { id: string } }>(
    '/api/runs/:id',
    async (request, reply) => {
      const snapshot = getRunSnapshot(request.params.id)
      if (!snapshot) return reply.code(404).send({ error: 'run not found' })
      return snapshot
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/runs/:id',
    async (request, reply) => {
      const removed = await deleteRun(request.params.id)
      if (!removed) {
        return reply
          .code(409)
          .send({ error: 'run not found or still running' })
      }
      return { ok: true }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/runs/:id/diff',
    async (request, reply) => {
      const snapshot = getRunSnapshot(request.params.id)
      if (!snapshot) return reply.code(404).send({ error: 'run not found' })
      if (!snapshot.checkpoint) {
        return reply.code(400).send({ error: '该运行没有工作区快照' })
      }
      return getWorkspaceDiff(snapshot.workspace, snapshot.checkpoint)
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/runs/:id/rollback',
    async (request, reply) => {
      const snapshot = getRunSnapshot(request.params.id)
      if (!snapshot) return reply.code(404).send({ error: 'run not found' })
      if (snapshot.status === 'running') {
        return reply.code(409).send({ error: '研究进行中，无法回滚' })
      }
      if (!snapshot.checkpoint) {
        return reply.code(400).send({ error: '该运行没有工作区快照' })
      }
      const result = await restoreWorkspaceCheckpoint(
        snapshot.workspace,
        snapshot.checkpoint,
      )
      return { ok: true, removed: result.removed }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/runs/:id/cancel',
    async (request, reply) => {
      const cancelled = cancelRun(request.params.id)
      if (!cancelled) {
        return reply.code(409).send({ error: 'run is not active' })
      }
      return { ok: true }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/runs/:id/events',
    async (request, reply) => {
      const snapshot = getRunSnapshot(request.params.id)
      if (!snapshot) {
        return reply.code(404).send({ error: 'run not found' })
      }

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      let closed = false
      const send = (event: unknown) => {
        if (closed || reply.raw.writableEnded) return
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
      }

      for (const event of snapshot.events) send(event)

      if (snapshot.status !== 'running') {
        reply.raw.end()
        return
      }

      let unsubscribe = () => {}
      const heartbeat = setInterval(() => {
        if (!closed && !reply.raw.writableEnded) reply.raw.write(': ping\n\n')
      }, 15_000)

      const cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        unsubscribe()
        if (!reply.raw.writableEnded) reply.raw.end()
      }

      unsubscribe = subscribe(request.params.id, (event) => {
        send(event)
        if (event.type === 'run.finished') {
          setTimeout(cleanup, 30)
        }
      })

      request.raw.on('aborted', cleanup)
      reply.raw.on('close', cleanup)
      reply.raw.on('error', cleanup)
    },
  )

  const distDir = path.resolve('dist')
  if (process.env.NODE_ENV === 'production' && existsSync(distDir)) {
    await app.register(fastifyStatic, { root: distDir, prefix: '/' })
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith('/api')) {
        return reply.code(404).send({ error: 'not found' })
      }
      return reply.sendFile('index.html')
    })
  }

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error)
    const known = error as { statusCode?: number; message?: string }
    const status = known.statusCode ?? 500
    reply.code(status).send({ error: known.message || 'internal error' })
  })

  const shutdown = async () => {
    await app.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await app.listen({ port: PORT, host: HOST })
  app.log.info(
    `AUTO research console · workspace="${getActiveWorkspacePath()}" · project="${getProjectName()}"`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
