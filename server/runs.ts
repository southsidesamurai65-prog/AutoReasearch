import { nanoid } from 'nanoid'
import type {
  AgentConfig,
  AgentRole,
  AppSettings,
  CallNode,
  ReferenceItem,
  RunEvent,
  RunMode,
  RunSnapshot,
  RunStatus,
  RunSummary,
  ThreadMode,
  WorkspaceFile,
} from '../shared/types'
import { buildTeacherBrief } from './teacher-brief'
import { looksHard } from './run-utils'
import { realScenario } from './real'
import {
  deleteHistoricalRun,
  getHistoricalRun,
  listHistoricalRuns,
  saveRunHistory,
  summarizeRun,
} from './run-history'
import { createWorkspaceCheckpoint } from './workspace-checkpoint'
import { recordBossThread } from './workspace'

interface RunRecord {
  snapshot: RunSnapshot
  controller: AbortController
  listeners: Set<(event: RunEvent) => void>
  agents: AgentConfig[]
  refs: ReferenceItem[]
  workspaceFiles: WorkspaceFile[]
}

const runs = new Map<string, RunRecord>()
const MAX_RUNS = 40
const BOSS_TOKENS = 2400
const BOSS_COST = 0.05

const now = () => new Date().toISOString()

function emit(run: RunRecord, event: RunEvent): void {
  run.snapshot.events.push(event)
  if (event.type === 'boss.delta') {
    run.snapshot.bossReport += event.text
  }
  if (event.type === 'call.delta') {
    const call = run.snapshot.calls.find((item) => item.id === event.id)
    if (call) call.output = `${call.output ?? ''}${event.text}`
  }
  for (const listener of run.listeners) {
    try {
      listener(event)
    } catch {
      // a broken SSE client must not break the orchestrator
    }
  }
}

function log(
  run: RunRecord,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
): void {
  emit(run, { type: 'log', at: now(), level, message })
}

function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(true)
    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timer)
      resolve(true)
    }
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(false)
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function finish(run: RunRecord, status: RunStatus, summary: string): void {
  const snapshot = run.snapshot
  if (snapshot.status !== 'running') return

  snapshot.status = status
  snapshot.endedAt = now()
  snapshot.summary = summary

  if (status === 'cancelled' || status === 'error') {
    for (const call of snapshot.calls) {
      if (call.status === 'running' || call.status === 'queued') {
        call.status = 'cancelled'
        call.endedAt = now()
        emit(run, {
          type: 'call.updated',
          at: now(),
          id: call.id,
          patch: { status: 'cancelled', endedAt: call.endedAt },
        })
      }
    }
  }

  const boss = snapshot.calls.find((call) => call.role === 'boss')
  if (boss && boss.status !== 'done') {
    Object.assign(boss, {
      status:
        status === 'done' ? 'done' : status === 'error' ? 'error' : 'cancelled',
      endedAt: snapshot.endedAt,
      tokens: boss.tokens ?? BOSS_TOKENS,
      costUsd: boss.costUsd ?? BOSS_COST,
      summary,
    })
    emit(run, {
      type: 'call.updated',
      at: now(),
      id: boss.id,
      patch: boss,
    })
  }

  emit(run, { type: 'run.finished', at: now(), status, summary })
  run.listeners.clear()
  void saveRunHistory({ ...snapshot, events: [] }).catch(() => {
    // history persistence is best-effort; the live snapshot still exists
  })
}

function pick(agents: AgentConfig[], role: AgentRole): AgentConfig | undefined {
  return agents.find((agent) => agent.role === role && agent.enabled)
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = []
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size))
  }
  return chunks
}

async function say(
  run: RunRecord,
  markdown: string,
  chunkSize = 16,
  ms = 24,
): Promise<boolean> {
  for (const chunk of chunkText(markdown, chunkSize)) {
    if (run.snapshot.status !== 'running') return false
    emit(run, { type: 'boss.delta', at: now(), text: chunk })
    if (await pause(ms, run.controller.signal)) return false
  }
  return true
}

interface CallMeta {
  duration: number
  tokens: number
  costPerMillion: number
  summary: string
}

async function callAgent(
  run: RunRecord,
  agent: AgentConfig,
  parentId: string,
  task: string,
  meta: CallMeta,
): Promise<CallNode | null> {
  const signal = run.controller.signal
  const node: CallNode = {
    id: nanoid(8),
    parentId,
    agentId: agent.id,
    agentName: agent.name,
    role: agent.role,
    color: agent.color,
    task,
    status: 'queued',
  }

  run.snapshot.calls.push(node)
  emit(run, { type: 'call.started', at: now(), call: node })

  if (await pause(140, signal)) return null
  if (run.snapshot.status !== 'running') return null

  node.status = 'running'
  node.startedAt = now()
  emit(run, {
    type: 'call.updated',
    at: now(),
    id: node.id,
    patch: { status: 'running', startedAt: node.startedAt },
  })

  if (await pause(meta.duration, signal)) return null
  if (run.snapshot.status !== 'running') return null

  const tokens = Math.round(meta.tokens * (0.85 + Math.random() * 0.35))
  const costUsd = Number(
    ((tokens / 1_000_000) * meta.costPerMillion).toFixed(4),
  )

  Object.assign(node, {
    status: 'done',
    endedAt: now(),
    tokens,
    costUsd,
    summary: meta.summary,
  })

  emit(run, {
    type: 'call.updated',
    at: now(),
    id: node.id,
    patch: {
      status: node.status,
      endedAt: node.endedAt,
      tokens: node.tokens,
      costUsd: node.costUsd,
      summary: node.summary,
    },
  })

  return node
}

async function mockScenario(
  run: RunRecord,
  agents: AgentConfig[],
  bossCall: CallNode,
): Promise<void> {
  const { snapshot, controller } = run
  const signal = controller.signal

  const subject =
    snapshot.prompt.length > 40
      ? `${snapshot.prompt.slice(0, 40)}…`
      : snapshot.prompt

  if (await pause(260, signal)) return finish(run, 'cancelled', '已取消本次研究。')

  const refNote =
    run.refs.length > 0
      ? `外部引用 **${run.refs.length}** 个，已只读挂载到 \`.auto/refs\`。`
      : '外部引用暂时为空。'
  const workspaceNote = `工作区 \`${snapshot.workspace}\` 已交给 harness，子代理可以直接读写其中文件。${refNote}`

  const plan = `## 研究简报

**目标**：${subject}

我先做了一次任务拆解，把工作分成四条线：**资料检索 → 方案实现 → 交叉检查 → 成果讲解**。${workspaceNote}

### 01 · 先补齐信息

不急着写代码。先确认这个方向已经有哪些工作、哪些坑被踩过，避免重复造轮子。

`
  if (!(await say(run, plan))) return

  const search = pick(agents, 'search')
  if (search) {
    const node = await callAgent(
      run,
      search,
      bossCall.id,
      `检索「${subject}」的相关论文、官方文档与开源实现，提取可复用方法与出处`,
      {
        duration: 1400,
        tokens: 3200,
        costPerMillion: 0.8,
        summary: '检索到 4 篇相关工作、2 个开源实现，已整理成带出处的摘要。',
      },
    )
    if (!node) return
  }

  const afterSearch = `检索结果已经回来了：目前的主流做法集中在**分层调度**和**失败后重试**两条路线，其中分层调度更适合我们这种多角色场景。下面开始并行实现。

### 02 · 两条线并行推进

后端负责把任务拆解、事件流和持久化串起来；前端负责把调用链、汇报和讲解实时呈现出来。两边共享同一份类型定义，避免接口对不上。

`
  if (!(await say(run, afterSearch))) return

  const backend = pick(agents, 'backend')
  const frontend = pick(agents, 'frontend')
  const parallel: Promise<CallNode | null>[] = []

  if (backend) {
    parallel.push(
      callAgent(
        run,
        backend,
        bossCall.id,
        '实现研究流程的服务端编排、数据模型、事件流与文件上下文注入',
        {
          duration: 1900,
          tokens: 5600,
          costPerMillion: 2.8,
          summary: '完成编排器与 SSE 事件流，新增 3 个模块，并接入文件上下文。',
        },
      ),
    )
  }

  if (frontend) {
    parallel.push(
      callAgent(
        run,
        frontend,
        bossCall.id,
        '实现左右分栏研究台、Agent 配置卡片与实时调用链可视化',
        {
          duration: 2100,
          tokens: 4800,
          costPerMillion: 2.4,
          summary: '完成三大面板与配置交互，接入实时事件并补齐空状态。',
        },
      ),
    )
  }

  if (parallel.length > 0) {
    const results = await Promise.all(parallel)
    if (results.some((node) => node === null)) return
  } else {
    log(run, '后端与前端 Agent 均已停用，跳过实现阶段。', 'warn')
  }

  const debug = pick(agents, 'debug')
  let debugNode: CallNode | null = null
  if (debug) {
    debugNode = await callAgent(
      run,
      debug,
      bossCall.id,
      '交叉检查后端与前端产物：类型、边界条件、并发写入与错误处理',
      {
        duration: 1500,
        tokens: 2600,
        costPerMillion: 0.5,
        summary: '发现 2 个中风险问题：事件竞态与空文件注入，已附修复建议。',
      },
    )
    if (!debugNode) return
  }

  const hardTriggered = looksHard(snapshot.prompt, snapshot.files)
  const hard = pick(agents, 'hard')

  const afterDebug = `### 03 · 交叉检查

${
  debugNode
    ? 'Debug Agent 发现了两处中风险问题：一是取消任务时事件可能晚到，二是空文件会被无意义地注入上下文。两处都不致命，但会让结果不稳定。'
    : 'Debug Agent 未启用，本次跳过了独立检查，建议在正式运行前打开。'
}

${
  hardTriggered && hard
    ? '其中「如何避免多 Agent 互相等待」属于结构性难题，我额外把攻坚 Agent 拉了进来。'
    : '目前没有触发结构性难题，攻坚 Agent 继续待命，不产生额外成本。'
}

`
  if (!(await say(run, afterDebug))) return

  if (hardTriggered && hard) {
    const hardNode = await callAgent(
      run,
      hard,
      debugNode?.id ?? bossCall.id,
      '重新审视多 Agent 调度的等待与竞态问题，给出可落地的突破方案',
      {
        duration: 1800,
        tokens: 8800,
        costPerMillion: 12,
        summary: '将问题重构为分层调度模型，给出「先并行后收敛」的两阶段策略。',
      },
    )
    if (!hardNode) return
    log(run, '攻坚 Agent 已介入并产出替代方案。', 'warn')
  } else if (hard) {
    log(run, '本次难度未达到阈值，攻坚 Agent 保持待命。')
  }

  const teacher = pick(agents, 'teacher')
  if (teacher) {
    const teacherNode = await callAgent(
      run,
      teacher,
      bossCall.id,
      '把项目架构、调用链和本次产物翻译成零基础读者能懂的解释',
      {
        duration: 1200,
        tokens: 1800,
        costPerMillion: 0.4,
        summary: '已生成组织架构图与 7 节通俗讲解。',
      },
    )
    if (!teacherNode) return

    const brief = buildTeacherBrief(
      agents,
      snapshot.prompt,
      [
        ...run.refs.map((ref) => ref.name),
        ...run.workspaceFiles.slice(0, 12).map((file) => file.path),
      ],
      snapshot.calls,
      hardTriggered,
    )
    snapshot.teacher = brief
    emit(run, { type: 'teacher.ready', at: now(), brief })
  } else {
    log(run, '教师 Agent 未启用，跳过通俗讲解。', 'warn')
  }

  const totalTokens =
    snapshot.calls.reduce((sum, call) => sum + (call.tokens ?? 0), 0) +
    BOSS_TOKENS
  const totalCost =
    snapshot.calls.reduce((sum, call) => sum + (call.costUsd ?? 0), 0) +
    BOSS_COST

  const closing = `### 04 · 结论

这一轮研究已经跑通：资料有了出处，实现有了骨架，检查也留下了可执行的修复清单。教师 Agent 在右侧生成了一张组织架构图和通俗讲解，你可以直接对照着看。

**本轮开销**：约 ${totalTokens.toLocaleString('zh-CN')} tokens / $${totalCost.toFixed(2)}。

**建议下一步**
1. 把这次发现的竞态问题补上取消令牌与事件序号。
2. 文件区补充领域资料，让检索 Agent 少走弯路。
3. 若要接真实 harness，先从 Boss + 单个子代理跑通，再逐步放开并行。

> 当前为 Mock 编排：调用链、耗时与费用都是模拟数据。切换到「真实」模式后会调用 opencode harness。
`
  if (!(await say(run, closing))) return

  finish(run, 'done', 'Mock 流程完成，产物与讲解已生成。')
}

export interface StartRunInput {
  prompt: string
  mode: RunMode
  threadMode: ThreadMode
  bossSessionId: string | null
  threadMemory: string
  threadNotice?: string
  files: string[]
  agents: AgentConfig[]
  workspace: string
  refs: ReferenceItem[]
  workspaceFiles: WorkspaceFile[]
  settings: AppSettings
}

export function startRun(input: StartRunInput): string {
  const id = nanoid(10)
  const record: RunRecord = {
    snapshot: {
      id,
      prompt: input.prompt,
      files: input.files,
      mode: input.mode,
      workspace: input.workspace,
      threadMode: input.threadMode,
      bossSessionId: input.bossSessionId ?? undefined,
      status: 'running',
      startedAt: now(),
      calls: [],
      bossReport: '',
      events: [],
    },
    controller: new AbortController(),
    listeners: new Set(),
    agents: input.agents,
    refs: input.refs,
    workspaceFiles: input.workspaceFiles,
  }

  runs.set(id, record)
  trimRuns()

  const boss = input.agents.find((agent) => agent.role === 'boss') ?? input.agents[0]

  emit(record, {
    type: 'run.started',
    at: now(),
    runId: id,
    prompt: input.prompt,
    files: input.files,
    mode: input.mode,
    workspace: input.workspace,
    threadMode: input.threadMode,
  })

  if (!boss) {
    finish(record, 'error', '没有可用的 Boss Agent。')
    return id
  }

  const bossCall: CallNode = {
    id: nanoid(8),
    parentId: null,
    agentId: boss.id,
    agentName: boss.name,
    role: boss.role,
    color: boss.color,
    task: input.prompt,
    status: 'running',
    startedAt: now(),
  }
  record.snapshot.calls.push(bossCall)
  emit(record, { type: 'call.started', at: now(), call: bossCall })

  const host = {
    snapshot: record.snapshot,
    signal: record.controller.signal,
    agents: input.agents,
    refs: input.refs,
    workspaceFiles: input.workspaceFiles,
    bossCall,
    threadMode: input.threadMode,
    bossSessionId: input.bossSessionId,
    threadMemory: input.threadMemory,
    threadNotice: input.threadNotice,
    settings: input.settings,
    agentUsage: new Map(),
    emit: (event: RunEvent) => emit(record, event),
    log: (message: string, level: 'info' | 'warn' | 'error' = 'info') =>
      log(record, message, level),
    emitBoss: (text: string) => {
      if (record.snapshot.status === 'running' && text) {
        emit(record, { type: 'boss.delta', at: now(), text })
      }
    },
    finish: (status: RunStatus, summary: string) =>
      finish(record, status, summary),
    saveThread: async (sessionId: string, memory: string) => {
      await recordBossThread(input.workspace, {
        sessionId,
        model: boss.model,
        memory,
      })
    },
  }

  void (async () => {
    try {
      if (input.mode === 'real') {
        try {
          const checkpoint = await createWorkspaceCheckpoint(input.workspace, id)
          if (checkpoint) {
            record.snapshot.checkpoint = checkpoint
            log(
              record,
              `工作区快照已创建：${checkpoint.commit.slice(0, 12)}`,
            )
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          log(record, `工作区快照创建失败：${message}`, 'warn')
        }
        await realScenario(host)
      } else {
        await mockScenario(record, input.agents, bossCall)
      }
    } catch (error) {
      if (record.controller.signal.aborted) {
        finish(record, 'cancelled', '已取消本次研究。')
      } else {
        const message = error instanceof Error ? error.message : String(error)
        log(record, `编排器异常：${message}`, 'error')
        emit(record, {
          type: 'boss.delta',
          at: now(),
          text: `\n\n> 编排器异常：${message}\n`,
        })
        finish(record, 'error', '编排器异常中止，请查看日志。')
      }
    }
  })()

  return id
}

function trimRuns(): void {
  if (runs.size <= MAX_RUNS) return
  for (const [id, record] of runs) {
    if (record.snapshot.status !== 'running') {
      runs.delete(id)
      if (runs.size <= MAX_RUNS) return
    }
  }
}

function cloneSnapshot(snapshot: RunSnapshot): RunSnapshot {
  return {
    ...snapshot,
    calls: snapshot.calls.map((call) => ({ ...call })),
    events: [...snapshot.events],
  }
}

export function getRunSnapshot(id: string): RunSnapshot | undefined {
  const record = runs.get(id)
  if (record) return cloneSnapshot(record.snapshot)
  return getHistoricalRun(id)
}

export function listRuns(): RunSummary[] {
  const merged = new Map<string, RunSummary>()
  for (const summary of listHistoricalRuns()) {
    merged.set(summary.id, summary)
  }
  for (const record of runs.values()) {
    merged.set(record.snapshot.id, summarizeRun(record.snapshot))
  }
  return [...merged.values()].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  )
}

export async function deleteRun(id: string): Promise<boolean> {
  const record = runs.get(id)
  if (record?.snapshot.status === 'running') return false
  runs.delete(id)
  return deleteHistoricalRun(id)
}

export function subscribe(
  id: string,
  listener: (event: RunEvent) => void,
): () => void {
  const record = runs.get(id)
  if (!record) return () => {}
  record.listeners.add(listener)
  return () => record.listeners.delete(listener)
}

export function cancelRun(id: string): boolean {
  const record = runs.get(id)
  if (!record || record.snapshot.status !== 'running') return false
  record.controller.abort()
  finish(record, 'cancelled', '已取消本次研究。')
  return true
}

