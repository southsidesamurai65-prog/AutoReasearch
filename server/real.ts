import { DEFAULT_MODEL, ROLE_LABELS } from '../shared/presets'
import type {
  AgentConfig,
  CallNode,
  TeacherBrief,
} from '../shared/types'
import type { HarnessRunResult } from './harness/opencode'
import { runOpencode } from './harness/opencode'
import type { RunHost } from './run-host'
import { buildTeacherBrief } from './teacher-brief'
import {
  clampText,
  extractJsonObject,
  looksHard,
  summarize,
} from './run-utils'

const MAX_CALL_OUTPUT = 24_000
const MAX_CONTEXT_OUTPUT = 4_000
const MAX_TASKS = 5

const nowIso = () => new Date().toISOString()

interface PlanTask {
  id: string
  agent: AgentConfig
  task: string
  dependsOn: string[]
}

interface RealPlan {
  summary: string
  tasks: PlanTask[]
  needsHard: boolean
}

interface TaskResult {
  taskId: string
  agent: AgentConfig
  callId: string | null
  ok: boolean
  output: string
  summary: string
  tokens: number
  costUsd: number
  toolCalls: number
  error?: string
}

interface Usage {
  tokens: number
  costUsd: number
}

function modelFor(agent: AgentConfig): string {
  return agent.model.trim() || DEFAULT_MODEL
}

function addCall(
  host: RunHost,
  agent: AgentConfig,
  parentId: string | null,
  task: string,
): CallNode {
  const call: CallNode = {
    id: `call_${Math.random().toString(36).slice(2, 10)}`,
    parentId,
    agentId: agent.id,
    agentName: agent.name,
    role: agent.role,
    color: agent.color,
    task,
    status: 'queued',
  }
  host.snapshot.calls.push(call)
  host.emit({ type: 'call.started', at: nowIso(), call })
  return call
}

function patchCall(
  host: RunHost,
  call: CallNode,
  patch: Partial<CallNode>,
): void {
  Object.assign(call, patch)
  host.emit({ type: 'call.updated', at: nowIso(), id: call.id, patch })
}

function addUsage(usage: Usage, result: HarnessRunResult): void {
  usage.tokens += result.tokens
  usage.costUsd += result.costUsd
}

function syncBossUsage(host: RunHost, usage: Usage): void {
  patchCall(host, host.bossCall, {
    tokens: usage.tokens,
    costUsd: Number(usage.costUsd.toFixed(6)),
  })
}

function roster(agents: AgentConfig[]): string {
  const list = agents.filter(
    (agent) =>
      agent.enabled &&
      agent.role !== 'boss' &&
      agent.role !== 'teacher',
  )
  if (list.length === 0) return '- 无可用子代理'
  return list
    .map(
      (agent) =>
        `- key: ${agent.id} | ${agent.name}（${ROLE_LABELS[agent.role]}）：${agent.description}`,
    )
    .join('\n')
}

function externalRefs(host: RunHost): string {
  if (host.refs.length === 0) return '- 无'
  return host.refs
    .map((ref) =>
      ref.exists
        ? `- \`${ref.workspacePath}\`（${ref.mode === 'linked' ? '只读链接' : '已复制'}，原名：${ref.name}）`
        : `- （缺失）${ref.name}：${ref.sourcePath}`,
    )
    .join('\n')
}

function workspaceFiles(host: RunHost): string {
  if (host.workspaceFiles.length === 0) return '- 空工作区'
  const list = host.workspaceFiles
    .slice(0, 120)
    .map((file) => `- ${file.path}`)
    .join('\n')
  return host.workspaceFiles.length > 120
    ? `${list}\n- …共 ${host.workspaceFiles.length} 个文件`
    : list
}

function subject(prompt: string, max = 80): string {
  return prompt.length > max ? `${prompt.slice(0, max)}…` : prompt
}

function planPrompt(host: RunHost, memory = ''): string {
  return `你是「自动科研平台」的 Boss Agent，负责统筹一次真实研究。

${memory ? `## 项目记忆（来自之前的 Boss 线程，可能过时，请以工作区现状为准）\n${memory}\n\n` : ''}工作区（opencode harness 已将它作为 cwd，可直接读写）：
${host.snapshot.workspace}

用户目标：
${host.snapshot.prompt}

当前日期：${new Date().toLocaleDateString('zh-CN')}

可用子代理（plan 中的 agent 字段必须使用这里的 key）：
${roster(host.agents)}

外部只读引用（已挂载到工作区的 .auto/refs 下，禁止修改）：
${externalRefs(host)}

工作区文件（仅供你判断，不必全部读取）：
${workspaceFiles(host)}

请先按需浏览工作区，然后输出一个可执行的任务计划。只输出一个 JSON 对象，不要代码块，不要额外解释：
{
  "summary": "一句话说明研究路线",
  "tasks": [
    { "id": "t1", "agent": "<key>", "task": "具体、可执行、带验收标准的任务", "dependsOn": [] }
  ],
  "needsHard": false
}

规则：
1. 最多 ${MAX_TASKS} 个任务；只选择真正需要的角色，不要机械地全用。
2. task 必须具体，说明要查什么、做什么、产出什么。
3. 只有确实依赖前序任务结果时才写 dependsOn。
4. 不要创建 teacher 任务，教师由平台单独调用。
5. needsHard 仅在存在结构性难题或高风险未知时为 true。
6. 如果任务主要是文献调研，不要强行安排前端/后端实现。`
}

function continuationPlanPrompt(host: RunHost): string {
  return `继续当前 Boss 线程。用户提出了新的要求：

用户新要求：
${host.snapshot.prompt}

当前工作区：${host.snapshot.workspace}

当前外部只读引用：
${externalRefs(host)}

当前工作区文件（仅概览，可按需读取）：
${workspaceFiles(host)}

请基于本会话已有的项目上下文，判断是否需要浏览工作区，然后只输出本次任务的 JSON 计划。格式与之前相同：
{
  "summary": "一句话说明本次路线",
  "tasks": [
    { "id": "t1", "agent": "<key>", "task": "具体、可执行、带验收标准的任务", "dependsOn": [] }
  ],
  "needsHard": false
}

规则：
1. 最多 ${MAX_TASKS} 个任务；只选择本次真正需要的角色。
2. 不要机械重复已经完成的工作；只有确实需要重新验证时才重复。
3. 不要创建 teacher 任务。
4. needsHard 仅在存在结构性难题或高风险未知时为 true。`
}

function isSessionMissing(error: string): boolean {
  return /session.*(not found|missing|expired|invalid)|no such session|unknown session/i.test(
    error,
  )
}

function buildMemory(
  host: RunHost,
  plan: RealPlan,
  results: TaskResult[],
  finalText: string,
): string {
  const completed = results
    .filter((result) => result.ok)
    .map(
      (result) =>
        `- ${result.agent.name}（${result.taskId}）：${result.summary}`,
    )
    .join('\n')
  const failed = results
    .filter((result) => !result.ok)
    .map(
      (result) =>
        `- ${result.agent.name}（${result.taskId}）：${result.error ?? result.summary}`,
    )
    .join('\n')

  return clampText(
    `## 最近一轮研究（${new Date().toISOString().slice(0, 10)}）
目标：${host.snapshot.prompt}
路线：${plan.summary}

已完成：
${completed || '- 无'}

失败 / 未完成：
${failed || '- 无'}

报告摘要：
${clampText(finalText, 1800)}`,
    3000,
  )
}

function logCacheUsage(
  host: RunHost,
  label: string,
  result: HarnessRunResult,
): void {
  if (result.cacheReadTokens > 0 || result.cacheWriteTokens > 0) {
    host.log(
      `${label}缓存：命中 ${result.cacheReadTokens.toLocaleString('zh-CN')} tokens，写入 ${result.cacheWriteTokens.toLocaleString('zh-CN')} tokens；费用 $${result.costUsd.toFixed(6)}。`,
    )
  }
}

function dependencyContext(results: TaskResult[]): string {
  if (results.length === 0) return '上游任务结果：无'
  const blocks = results.map((result) => {
    const output = clampText(
      result.output || result.error || '（无输出）',
      MAX_CONTEXT_OUTPUT,
    )
    return `### ${result.taskId} · ${result.agent.name}（${result.ok ? '完成' : '失败'}）
摘要：${result.summary}
输出：
${output}`
  })
  return `上游任务结果：\n${blocks.join('\n\n')}`
}

function subagentPrompt(
  host: RunHost,
  agent: AgentConfig,
  task: string,
  deps: TaskResult[],
): string {
  return `你是 ${agent.name}（${ROLE_LABELS[agent.role]}）。

${agent.systemPrompt}

---
工作区：${host.snapshot.workspace}
用户总目标：${host.snapshot.prompt}

你的任务：
${task}

${dependencyContext(deps)}

外部只读引用（位于 .auto/refs；只能读取，禁止修改）：
${externalRefs(host)}

你可以直接使用 harness 的文件、命令和检索工具。完成后用中文给出：
1. 结论（先给结果）
2. 产出或改动（列出具体文件路径）
3. 风险与未完成项

不要修改外部引用；不要编造不存在的文件或结果。`
}

function finalPrompt(
  host: RunHost,
  plan: RealPlan,
  results: TaskResult[],
  debugResult: TaskResult | null,
  hardResult: TaskResult | null,
): string {
  const taskLines = plan.tasks
    .map(
      (task, index) =>
        `${index + 1}. ${task.agent.name} — ${task.task}${task.dependsOn.length ? `（依赖 ${task.dependsOn.join('、')}）` : ''}`,
    )
    .join('\n')

  const resultBlocks = results.map((result) => {
    const output = clampText(
      result.output || result.error || '（无输出）',
      MAX_CONTEXT_OUTPUT,
    )
    return `### ${result.agent.name} · ${result.taskId}（${result.ok ? '完成' : '失败'}）
摘要：${result.summary}
${output}`
  })

  return `你是 Boss Agent。本轮真实研究已经结束，请向用户做最终汇报。

用户目标：
${host.snapshot.prompt}

工作区：
${host.snapshot.workspace}

外部只读引用：
${externalRefs(host)}

研究路线：${plan.summary}

执行计划：
${taskLines}

子任务结果：
${resultBlocks.join('\n\n') || '（没有成功执行的子任务）'}

独立检查结果：
${debugResult ? `${debugResult.agent.name}：${debugResult.summary}\n${clampText(debugResult.output, MAX_CONTEXT_OUTPUT)}` : '未执行独立检查。'}

攻坚结果：
${hardResult ? `${hardResult.agent.name}：${hardResult.summary}\n${clampText(hardResult.output, MAX_CONTEXT_OUTPUT)}` : '未启用攻坚 Agent。'}

请输出中文 Markdown 报告，结构如下：
## 结论
## 关键发现与已完成
## 产出与位置（文件路径）
## 风险、失败与未完成
## 建议下一步

要求：只依据真实执行结果；失败、跳过和未验证的内容必须明确说明；不要编造文件路径或实验数据。`
}

function teacherPrompt(
  host: RunHost,
  plan: RealPlan,
  results: TaskResult[],
  finalText: string,
  hardTriggered: boolean,
): string {
  const taskLines = plan.tasks
    .map((task) => `- ${task.agent.name}：${task.task}`)
    .join('\n')
  const resultLines = results
    .map(
      (result) =>
        `- ${result.agent.name}（${result.ok ? '完成' : '失败'}）：${result.summary}`,
    )
    .join('\n')

  return `你是教师 Agent。请把本轮研究翻译成完全没有技术背景的读者也能听懂的内容。

用户目标：${host.snapshot.prompt}
工作区：${host.snapshot.workspace}
外部只读引用：${host.refs.length} 个
实际任务：
${taskLines || '- 无'}
执行结果：
${resultLines || '- 无'}
是否启用攻坚：${hardTriggered ? '是' : '否'}
最终报告摘要：
${clampText(finalText, 6000)}

只输出一个 JSON 对象，不要 markdown 代码块，不要额外解释：
{
  "title": "这一套系统到底怎么运转",
  "intro": "两句话概括这次研究做了什么",
  "mermaid": "flowchart TB\\n  ...",
  "sections": [
    { "heading": "一句话说清", "body": "..." }
  ],
  "glossary": [
    { "term": "Agent", "meaning": "..." }
  ]
}

要求：
- sections 写 5 到 7 节，必须解释：目标怎么被拆解、工作区是什么、为什么用多个 Agent、实际发生了什么、用户看到的三个区域、下一步怎么用。
- 使用生活化比喻，避免术语；确需术语时在 glossary 中解释。
- mermaid 使用 flowchart TB，不超过 12 个节点，包含 Boss、实际参与的子代理、工作区和外部引用，语法必须能在 Mermaid v11 渲染。`
}

function parsePlan(raw: string, agents: AgentConfig[]): RealPlan | null {
  const data = extractJsonObject(raw) as
    | { summary?: unknown; tasks?: unknown; needsHard?: unknown }
    | null
  if (!data || !Array.isArray(data.tasks)) return null

  const tasks: PlanTask[] = []
  const usedIds = new Set<string>()

  data.tasks.slice(0, MAX_TASKS).forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const record = item as Record<string, unknown>
    const key = typeof record.agent === 'string' ? record.agent : ''
    const agent =
      agents.find((candidate) => candidate.id === key && candidate.enabled) ??
      agents.find(
        (candidate) => candidate.role === key && candidate.enabled,
      )
    if (!agent || agent.role === 'boss' || agent.role === 'teacher') return

    const task = typeof record.task === 'string' ? record.task.trim() : ''
    if (!task) return

    let id =
      typeof record.id === 'string' && record.id.trim()
        ? record.id.trim().slice(0, 40)
        : `t${index + 1}`
    if (usedIds.has(id)) id = `t${index + 1}`
    usedIds.add(id)

    const deps = Array.isArray(record.dependsOn)
      ? record.dependsOn.filter(
          (dep): dep is string => typeof dep === 'string',
        )
      : []

    tasks.push({
      id,
      agent,
      task: task.slice(0, 3000),
      dependsOn: deps,
    })
  })

  if (tasks.length === 0) return null

  const ids = new Set(tasks.map((task) => task.id))
  for (const task of tasks) {
    task.dependsOn = task.dependsOn.filter(
      (dep) => ids.has(dep) && dep !== task.id,
    )
  }

  return {
    summary:
      typeof data.summary === 'string' && data.summary.trim()
        ? data.summary.trim().slice(0, 500)
        : '按需拆解并执行研究任务。',
    tasks,
    needsHard: data.needsHard === true,
  }
}

function fallbackPlan(host: RunHost, reason: string): RealPlan {
  host.log(`Boss 计划不可用（${reason}），使用默认计划。`, 'warn')
  const pick = (role: AgentConfig['role']) =>
    host.agents.find((agent) => agent.role === role && agent.enabled)

  const tasks: PlanTask[] = []
  const search = pick('search')
  const backend = pick('backend')
  const frontend = pick('frontend')
  const debug = pick('debug')
  const prompt = host.snapshot.prompt

  if (search) {
    tasks.push({
      id: 't1',
      agent: search,
      task: `检索与「${subject(prompt, 60)}」相关的论文、官方文档、开源实现和已知坑点，给出带出处的可复用结论。`,
      dependsOn: [],
    })
  }

  const needsBuild = /代码|实现|开发|系统|平台|工具|脚本|原型|网页|界面|前端|后端|架构|实验/.test(
    prompt,
  )

  if (needsBuild && backend) {
    tasks.push({
      id: 't2',
      agent: backend,
      task: '在工作区内实现可运行的最小方案或实验脚本，说明数据、接口与验证方式。',
      dependsOn: search ? ['t1'] : [],
    })
  }

  if (needsBuild && frontend) {
    tasks.push({
      id: 't3',
      agent: frontend,
      task: '在工作区内实现或改进用户可见的界面与交互，保证与现有代码一致。',
      dependsOn: backend ? ['t2'] : search ? ['t1'] : [],
    })
  }

  if (debug) {
    tasks.push({
      id: 't4',
      agent: debug,
      task: '检查本轮产物与工作区改动：错误、边界条件、安全风险和遗漏，按严重程度给出结论。',
      dependsOn: tasks.map((task) => task.id),
    })
  }

  if (tasks.length === 0) {
    const fallbackAgent = host.agents.find(
      (agent) =>
        agent.enabled &&
        agent.role !== 'boss' &&
        agent.role !== 'teacher',
    )
    if (fallbackAgent) {
      tasks.push({
        id: 't1',
        agent: fallbackAgent,
        task: `基于工作区现状，围绕「${subject(prompt, 60)}」给出可执行的研究结论与下一步计划。`,
        dependsOn: [],
      })
    }
  }

  return {
    summary: 'Boss 计划解析失败，平台按默认角色顺序执行。',
    tasks,
    needsHard: looksHard(prompt, host.refs.map((ref) => ref.name)),
  }
}

function formatPlan(host: RunHost, plan: RealPlan): string {
  const taskLines = plan.tasks
    .map(
      (task, index) =>
        `${index + 1}. **${task.agent.name}** — ${task.task}${task.dependsOn.length ? `（依赖 ${task.dependsOn.join('、')}）` : ''}`,
    )
    .join('\n')
  const refCount = host.refs.length
  return `## 研究简报

**目标**：${subject(host.snapshot.prompt, 140)}

**工作区**：\`${host.snapshot.workspace}\`
**外部引用**：${refCount} 个${refCount > 0 ? '（只读挂载在 .auto/refs）' : ''}
**执行路线**：${plan.summary}

**任务拆解**
${taskLines || '（无可用子任务）'}

${plan.needsHard ? '> 任务被判定为高难度，将在检查后视情况启用攻坚 Agent。\n\n' : ''}`
}

async function runHarness(
  host: RunHost,
  agent: AgentConfig,
  prompt: string,
  title: string,
  onText?: (delta: string) => void,
  sessionId?: string,
): Promise<HarnessRunResult> {
  if (agent.harness !== 'opencode') {
    host.log(
      `${agent.name} 配置的 harness 是 ${agent.harness}，真实模式目前只接入 opencode，本次仍使用 opencode。`,
      'warn',
    )
  }
  return runOpencode({
    prompt,
    cwd: host.snapshot.workspace,
    model: modelFor(agent),
    title: `${agent.name} · ${title}`,
    sessionId,
    signal: host.signal,
    onText,
  })
}

async function runAgentCall(
  host: RunHost,
  agent: AgentConfig,
  taskId: string,
  taskLabel: string,
  prompt: string,
  parentId: string | null,
): Promise<TaskResult> {
  const call = addCall(host, agent, parentId, taskLabel)
  patchCall(host, call, { status: 'running', startedAt: nowIso() })

  let result: HarnessRunResult
  try {
    result = await runHarness(host, agent, prompt, taskId, (delta) => {
      if (host.snapshot.status !== 'running') return
      const current = call.output?.length ?? 0
      if (current >= MAX_CALL_OUTPUT) return
      host.emit({
        type: 'call.delta',
        at: nowIso(),
        id: call.id,
        text: delta.slice(0, MAX_CALL_OUTPUT - current),
      })
    })
  } catch (error) {
    result = {
      text: '',
      tokens: 0,
      costUsd: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: 0,
      error: error instanceof Error ? error.message : String(error),
      exitCode: null,
    }
  }

  if (host.snapshot.status !== 'running') {
    return {
      taskId,
      agent,
      callId: call.id,
      ok: false,
      output: call.output ?? '',
      summary: '已取消',
      tokens: result.tokens,
      costUsd: result.costUsd,
      toolCalls: result.toolCalls,
      error: '已取消',
    }
  }

  const ok = !result.error
  const output = clampText(
    `${result.text}${result.error ? `\n\n[harness error]\n${result.error}` : ''}`,
    MAX_CALL_OUTPUT,
  )
  const summary = ok
    ? summarize(result.text)
    : result.error ?? 'harness 执行失败'

  patchCall(host, call, {
    status: ok ? 'done' : 'error',
    endedAt: nowIso(),
    tokens: result.tokens,
    costUsd: result.costUsd,
    toolCalls: result.toolCalls,
    summary,
    output,
  })

  if (!ok) {
    host.log(`${agent.name} 执行失败：${result.error}`, 'warn')
  }

  return {
    taskId,
    agent,
    callId: call.id,
    ok,
    output: result.text,
    summary,
    tokens: result.tokens,
    costUsd: result.costUsd,
    toolCalls: result.toolCalls,
    error: result.error,
  }
}

async function runRealTask(
  host: RunHost,
  agent: AgentConfig,
  taskId: string,
  task: string,
  deps: TaskResult[],
  parentId: string | null,
): Promise<TaskResult> {
  return runAgentCall(
    host,
    agent,
    taskId,
    task,
    subagentPrompt(host, agent, task, deps),
    parentId,
  )
}

async function executePlan(
  host: RunHost,
  plan: RealPlan,
): Promise<TaskResult[]> {
  const pending = [...plan.tasks]
  const results = new Map<string, TaskResult>()

  while (pending.length > 0 && host.snapshot.status === 'running') {
    for (const task of [...pending]) {
      const failedDep = task.dependsOn.find((dep) => {
        const result = results.get(dep)
        return result !== undefined && !result.ok
      })
      if (failedDep) {
        pending.splice(pending.indexOf(task), 1)
        host.log(
          `任务 ${task.id}（${task.agent.name}）因依赖 ${failedDep} 失败而跳过。`,
          'warn',
        )
      }
    }

    if (pending.length === 0) break

    const ready = pending.filter((task) =>
      task.dependsOn.every((dep) => results.get(dep)?.ok),
    )
    if (ready.length === 0) {
      host.log('任务计划存在循环依赖或全部被阻塞，停止执行剩余任务。', 'warn')
      break
    }

    const batch = ready.slice(0, 3)
    for (const task of batch) {
      pending.splice(pending.indexOf(task), 1)
    }

    const batchResults = await Promise.all(
      batch.map((task) => {
        const deps = task.dependsOn
          .map((dep) => results.get(dep))
          .filter((result): result is TaskResult => Boolean(result))
        const parentId = deps.find((result) => result.callId)?.callId ?? host.bossCall.id
        return runRealTask(
          host,
          task.agent,
          task.id,
          task.task,
          deps,
          parentId,
        )
      }),
    )

    for (const result of batchResults) {
      results.set(result.taskId, result)
    }
  }

  return [...results.values()]
}

async function planWithBoss(
  host: RunHost,
  usage: Usage,
): Promise<RealPlan | null> {
  const boss =
    host.agents.find((agent) => agent.role === 'boss') ?? host.agents[0]
  if (!boss) return null

  const existingSession = host.bossSessionId
  let result = await runHarness(
    host,
    boss,
    existingSession
      ? continuationPlanPrompt(host)
      : planPrompt(host, host.threadMemory),
    '规划',
    undefined,
    existingSession ?? undefined,
  )

  if (
    result.error &&
    existingSession &&
    isSessionMissing(result.error) &&
    host.snapshot.status === 'running'
  ) {
    host.log(
      `上次 Boss 会话不可用（${result.error}），自动新开会话。`,
      'warn',
    )
    addUsage(usage, result)
    syncBossUsage(host, usage)
    host.bossSessionId = null
    host.snapshot.bossSessionId = undefined
    result = await runHarness(
      host,
      boss,
      planPrompt(host, host.threadMemory),
      '规划（新会话）',
    )
  }

  if (host.snapshot.status !== 'running') return null

  addUsage(usage, result)
  syncBossUsage(host, usage)
  logCacheUsage(host, 'Boss 规划', result)

  if (result.sessionID) {
    const isNew = !host.bossSessionId
    host.bossSessionId = result.sessionID
    host.snapshot.bossSessionId = result.sessionID
    host.log(
      `${isNew ? 'Boss 新开会话' : 'Boss 续用会话'}：${result.sessionID}`,
    )
  }

  if (result.error) {
    host.log(`Boss 规划失败：${result.error}`, 'error')
    host.emitBoss(`## 无法启动真实研究

opencode harness 返回错误：

\`\`\`
${result.error}
\`\`\`

可能原因：

- 当前模型不可用。\`${modelFor(boss)}\` 在部分地区会受到限制。
- opencode 未登录、网络不可达，或模型名称写错。
- 工作区路径不存在或没有访问权限。

请在左侧「子代理编排」里把模型换成可用的 opencode 模型（例如 \`opencode/deepseek-v4.1-flash-free\` 或 \`opencode-go/deepseek-v4.1-flash\`）后重试。
`)
    return null
  }

  const plan = parsePlan(result.text, host.agents)
  if (!plan) {
    const fallback = fallbackPlan(host, 'JSON 解析失败')
    host.emitBoss(formatPlan(host, fallback))
    return fallback
  }

  host.log(
    `Boss 规划完成：${plan.tasks.length} 个任务${plan.needsHard ? '，标记为高难度' : ''}。`,
  )
  host.emitBoss(formatPlan(host, plan))
  return plan
}

async function runDebug(
  host: RunHost,
  debug: AgentConfig,
  results: TaskResult[],
): Promise<TaskResult> {
  const task =
    '检查本轮工作区产物与改动（可用 git status/diff、读文件和只读命令），按严重程度列出错误、边界条件、安全风险与遗漏，并给出可执行的修复建议。'
  return runRealTask(host, debug, 'debug-final', task, results, host.bossCall.id)
}

async function runHard(
  host: RunHost,
  hard: AgentConfig,
  results: TaskResult[],
  parentId: string | null,
): Promise<TaskResult> {
  const failures = results
    .filter((result) => !result.ok)
    .map((result) => `- ${result.agent.name}（${result.taskId}）：${result.error ?? result.summary}`)
    .join('\n')
  const task = `本轮研究遇到了需要重新建模的难点${failures ? `：\n${failures}` : ''}。
请重新审视问题假设与失败原因，提出并执行可落地的突破方案。若能在工作区内直接修复或验证，就完成它并说明改动；否则给出明确的下一步实验。`
  return runRealTask(host, hard, 'hard-final', task, results, parentId)
}

async function finalReport(
  host: RunHost,
  usage: Usage,
  plan: RealPlan,
  results: TaskResult[],
  debugResult: TaskResult | null,
  hardResult: TaskResult | null,
): Promise<{ text: string; ok: boolean }> {
  const boss =
    host.agents.find((agent) => agent.role === 'boss') ?? host.agents[0]
  if (!boss) {
    return { text: '', ok: false }
  }

  let streamed = false
  const existingSession = host.bossSessionId
  let result = await runHarness(
    host,
    boss,
    finalPrompt(host, plan, results, debugResult, hardResult),
    '最终汇报',
    (delta) => {
      streamed = true
      host.emitBoss(delta)
    },
    existingSession ?? undefined,
  )

  if (
    result.error &&
    existingSession &&
    isSessionMissing(result.error) &&
    host.snapshot.status === 'running'
  ) {
    host.log(
      `Boss 会话在最终汇报前失效（${result.error}），自动用新会话重试。`,
      'warn',
    )
    addUsage(usage, result)
    syncBossUsage(host, usage)
    host.bossSessionId = null
    host.snapshot.bossSessionId = undefined
    streamed = false
    result = await runHarness(
      host,
      boss,
      finalPrompt(host, plan, results, debugResult, hardResult),
      '最终汇报（新会话）',
      (delta) => {
        streamed = true
        host.emitBoss(delta)
      },
    )
  }

  if (host.snapshot.status !== 'running') {
    return { text: result.text, ok: false }
  }

  addUsage(usage, result)
  syncBossUsage(host, usage)
  logCacheUsage(host, 'Boss 最终汇报', result)

  if (result.sessionID) {
    host.bossSessionId = result.sessionID
    host.snapshot.bossSessionId = result.sessionID
  }

  if (result.error) {
    host.log(`Boss 最终汇报失败：${result.error}`, 'error')
    const fallback = `## 研究执行完成，但最终汇报失败

已执行的子任务：

${results
  .map(
    (item) =>
      `- **${item.agent.name}**（${item.ok ? '完成' : '失败'}）：${item.summary}`,
  )
  .join('\n') || '- 无'}

> harness 错误：${result.error}

请检查模型与网络后在左侧 Agent 设置中调整，或查看调用链中各子代理的原始输出。
`
    if (!streamed) host.emitBoss(fallback)
    else host.emitBoss(`\n\n> 汇报中断：${result.error}\n`)
    return { text: fallback, ok: false }
  }

  if (!streamed && result.text) host.emitBoss(result.text)
  patchCall(host, host.bossCall, {
    output: clampText(result.text, MAX_CALL_OUTPUT),
  })
  return { text: result.text, ok: true }
}

function parseTeacherBrief(raw: string): TeacherBrief | null {
  const data = extractJsonObject(raw) as
    | {
        title?: unknown
        intro?: unknown
        mermaid?: unknown
        sections?: unknown
        glossary?: unknown
      }
    | null
  if (!data) return null
  if (typeof data.title !== 'string' || typeof data.intro !== 'string') {
    return null
  }

  const mermaid =
    typeof data.mermaid === 'string'
      ? data.mermaid
          .replace(/```(?:mermaid)?/gi, '')
          .replace(/```/g, '')
          .trim()
      : ''
  if (!/^(flowchart|graph)\b/.test(mermaid)) return null

  const sections = Array.isArray(data.sections)
    ? data.sections
        .filter(
          (item): item is { heading: string; body: string } =>
            Boolean(item) &&
            typeof item === 'object' &&
            typeof (item as Record<string, unknown>).heading === 'string' &&
            typeof (item as Record<string, unknown>).body === 'string',
        )
        .map((item) => ({
          heading: item.heading.slice(0, 120),
          body: item.body.slice(0, 3000),
        }))
        .slice(0, 8)
    : []
  if (sections.length < 3) return null

  const glossary = Array.isArray(data.glossary)
    ? data.glossary
        .filter(
          (item): item is { term: string; meaning: string } =>
            Boolean(item) &&
            typeof item === 'object' &&
            typeof (item as Record<string, unknown>).term === 'string' &&
            typeof (item as Record<string, unknown>).meaning === 'string',
        )
        .map((item) => ({
          term: item.term.slice(0, 60),
          meaning: item.meaning.slice(0, 300),
        }))
        .slice(0, 12)
    : []

  return {
    title: data.title.slice(0, 120),
    intro: data.intro.slice(0, 1000),
    mermaid,
    sections,
    glossary,
  }
}

async function runTeacher(
  host: RunHost,
  plan: RealPlan,
  results: TaskResult[],
  finalText: string,
  hardTriggered: boolean,
): Promise<void> {
  const teacher = host.agents.find(
    (agent) => agent.role === 'teacher' && agent.enabled,
  )
  if (!teacher) {
    host.log('教师 Agent 未启用，跳过通俗讲解。', 'warn')
    return
  }

  const result = await runAgentCall(
    host,
    teacher,
    'teacher',
    '把项目架构与本次运行翻译成零基础读者能懂的解释',
    teacherPrompt(host, plan, results, finalText, hardTriggered),
    host.bossCall.id,
  )

  const parsed = result.ok ? parseTeacherBrief(result.output) : null
  if (parsed) {
    host.snapshot.teacher = parsed
    host.emit({ type: 'teacher.ready', at: nowIso(), brief: parsed })
    if (result.callId) {
      const call = host.snapshot.calls.find((item) => item.id === result.callId)
      if (call) {
        patchCall(host, call, {
          summary: `已生成架构图与 ${parsed.sections.length} 节通俗讲解。`,
        })
      }
    }
    return
  }

  host.log('教师 Agent 输出无法解析，使用结构化兜底讲解。', 'warn')
  const brief = buildTeacherBrief(
    host.agents,
    host.snapshot.prompt,
    [
      ...host.refs.map((ref) => ref.name),
      ...host.workspaceFiles.slice(0, 12).map((file) => file.path),
    ],
    host.snapshot.calls,
    hardTriggered,
  )
  host.snapshot.teacher = brief
  host.emit({ type: 'teacher.ready', at: nowIso(), brief })
}

function emitCostFooter(host: RunHost): void {
  const tokens = host.snapshot.calls.reduce(
    (sum, call) => sum + (call.tokens ?? 0),
    0,
  )
  const cost = host.snapshot.calls.reduce(
    (sum, call) => sum + (call.costUsd ?? 0),
    0,
  )
  host.emitBoss(`\n\n---\n\n**本轮真实开销**：约 ${tokens.toLocaleString('zh-CN')} tokens / $${cost.toFixed(4)}

> 真实模式：内容由 opencode harness 生成，调用链、耗时与费用来自真实事件。外部引用以只读方式挂载在 \`.auto/refs\`。
`)
}

export async function realScenario(host: RunHost): Promise<void> {
  const boss =
    host.agents.find((agent) => agent.role === 'boss') ?? host.agents[0]
  if (!boss) {
    host.finish('error', '没有可用的 Boss Agent。')
    return
  }

  const usage: Usage = { tokens: 0, costUsd: 0 }
  host.log(
    `真实模式启动：opencode harness · 工作区 ${host.snapshot.workspace} · 模型 ${modelFor(boss)} · 线程模式 ${host.threadMode}${host.bossSessionId ? ` · 会话 ${host.bossSessionId}` : ''}`,
  )
  if (host.threadNotice) {
    host.emitBoss(`> ${host.threadNotice}\n\n`)
  }

  const plan = await planWithBoss(host, usage)
  if (host.snapshot.status !== 'running') return
  if (!plan) {
    host.finish('error', '真实 harness 规划失败，请检查模型与网络。')
    return
  }

  const results = await executePlan(host, plan)
  if (host.snapshot.status !== 'running') return

  const debug = host.agents.find(
    (agent) => agent.role === 'debug' && agent.enabled,
  )
  let debugResult: TaskResult | null = null
  if (debug && !results.some((result) => result.agent.role === 'debug')) {
    debugResult = await runDebug(host, debug, results)
    results.push(debugResult)
  }
  if (host.snapshot.status !== 'running') return

  const hard = host.agents.find(
    (agent) => agent.role === 'hard' && agent.enabled,
  )
  const hasFailures = results.some((result) => !result.ok)
  const hardTriggered =
    plan.needsHard ||
    hasFailures ||
    looksHard(host.snapshot.prompt, host.refs.map((ref) => ref.name))

  let hardResult: TaskResult | null = null
  if (hard && hardTriggered) {
    host.log('攻坚 Agent 已启用。', 'warn')
    hardResult = await runHard(
      host,
      hard,
      results,
      debugResult?.callId ?? host.bossCall.id,
    )
    results.push(hardResult)
  }
  if (host.snapshot.status !== 'running') return

  const final = await finalReport(
    host,
    usage,
    plan,
    results,
    debugResult,
    hardResult,
  )
  if (host.snapshot.status !== 'running') return

  if (final.ok && host.bossSessionId) {
    const memory = buildMemory(host, plan, results, final.text)
    try {
      await host.saveThread(host.bossSessionId, memory)
      host.log(
        `Boss 线程已保存：${host.bossSessionId}（记忆 ${memory.length} 字）`,
      )
    } catch (error) {
      host.log(
        `Boss 线程保存失败：${error instanceof Error ? error.message : String(error)}`,
        'warn',
      )
    }
  }

  await runTeacher(host, plan, results, final.text, hardTriggered)
  if (host.snapshot.status !== 'running') return

  emitCostFooter(host)

  const failed = results.filter((result) => !result.ok).length
  const summary = final.ok
    ? `真实研究完成：${results.length - failed} 个子任务成功${failed > 0 ? `，${failed} 个失败` : ''}。`
    : '真实研究结束，但最终汇报未能正常生成。'

  host.finish(final.ok ? 'done' : 'error', summary)
}
