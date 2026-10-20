import type {
  AgentConfig,
  CallNode,
  TeacherBrief,
} from '../shared/types'

export function buildTeacherBrief(
  agents: AgentConfig[],
  prompt: string,
  files: string[],
  calls: CallNode[],
  hardTriggered: boolean,
): TeacherBrief {
  const subject =
    prompt.length > 34 ? `${prompt.slice(0, 34)}…` : prompt || '这次研究'
  const label = (value: string) =>
    value.replace(/["<>\n\r]/g, '').trim() || 'Agent'

  const enabledRoles = new Set(
    agents.filter((agent) => agent.enabled).map((agent) => agent.role),
  )
  const boss = agents.find((agent) => agent.role === 'boss')
  const search = agents.find(
    (agent) => agent.role === 'search' && agent.enabled,
  )
  const backend = agents.find(
    (agent) => agent.role === 'backend' && agent.enabled,
  )
  const frontend = agents.find(
    (agent) => agent.role === 'frontend' && agent.enabled,
  )
  const debug = agents.find(
    (agent) => agent.role === 'debug' && agent.enabled,
  )
  const hard = agents.find((agent) => agent.role === 'hard' && agent.enabled)
  const teacher = agents.find(
    (agent) => agent.role === 'teacher' && agent.enabled,
  )
  const hasTeacher = Boolean(teacher)

  const lines: string[] = [
    'flowchart TB',
    '  U["你的研究目标"] --> B["Boss Agent<br/>统筹与调度"]',
  ]
  const styles: string[] = []

  const addNode = (
    agent: AgentConfig | undefined,
    nodeId: string,
    hint: string,
    from = 'B',
  ) => {
    if (!agent) return
    lines.push(`  ${from} --> ${nodeId}["${label(agent.name)}<br/>${hint}"]`)
    styles.push(
      `  style ${nodeId} fill:${agent.color},stroke:${agent.color},color:#0a0f15,stroke-width:1px`,
    )
  }

  if (boss) {
    styles.push(
      `  style B fill:${boss.color},stroke:${boss.color},color:#0a0f15,stroke-width:1px`,
    )
  }
  styles.push('  style U fill:#111923,stroke:#3a4a5e,color:#e6edf7')

  addNode(search, 'S', '查资料')
  addNode(backend, 'D', '搭逻辑')
  addNode(frontend, 'F', '做界面')

  if (debug) {
    const from =
      backend || frontend
        ? `${backend ? 'D' : ''}${backend && frontend ? ' & ' : ''}${frontend ? 'F' : ''}`
        : 'B'
    lines.push(`  ${from} --> X["${label(debug.name)}<br/>挑毛病"]`)
    styles.push(
      `  style X fill:${debug.color},stroke:${debug.color},color:#0a0f15,stroke-width:1px`,
    )
  }

  if (hard) {
    lines.push(
      `  ${debug ? 'X' : 'B'} --> H["${label(hard.name)}<br/>啃硬骨头"]`,
    )
    styles.push(
      `  style H fill:${hard.color},stroke:${hard.color},color:#0a0f15,stroke-width:1px`,
    )
  }

  lines.push('  A[("共享产物<br/>工作区 + 外部引用")]')
  if (backend) lines.push('  D --> A')
  if (frontend) lines.push('  F --> A')
  if (search) lines.push('  S --> A')
  if (hard) lines.push('  H --> A')
  if (!backend && !frontend && !search && !hard) lines.push('  B --> A')
  if (!hasTeacher) {
    lines.push('  A --> O["你现在看到的结果"]')
  } else {
    lines.push('  B --> T["教师 Agent<br/>翻译成人话"]')
    lines.push('  A --> T')
    lines.push('  T --> O["你现在看到的图解"]')
    styles.push(
      `  style T fill:${teacher?.color ?? '#f472b6'},stroke:${teacher?.color ?? '#f472b6'},color:#0a0f15,stroke-width:1px`,
    )
  }
  styles.push('  style A fill:#0d131b,stroke:#3a4a5e,color:#c8ff4d')
  styles.push('  style O fill:#111923,stroke:#3a4a5e,color:#e6edf7')

  const fileLine =
    files.length > 0
      ? `这次文件区里有 ${files.length} 份材料（${files.slice(0, 3).join('、')}${files.length > 3 ? ' 等' : ''}），工作区文件由 harness 直接读取，外部引用以只读方式挂载。`
      : '这次工作区里没有额外的参考文件，Agent 会依靠自身检索和工作区现状来推进。'

  const sections = [
    {
      heading: '一句话说清',
      body: `把它想成一家小型研究所：你是委托人，Boss Agent 是所长，其他 Agent 是不同科室的研究员。你说出「${subject}」，所长负责拆活、派活、验收，教师 Agent 最后用大白话把整个过程讲给你听。`,
    },
    {
      heading: '你的目标去哪儿了',
      body: `${fileLine} 所长先把目标拆成检索、实现、检查几块，再让对应的研究员并行开工。每个人只干自己擅长的事，做完把成果放进同一个共享工作台，最后由 Debug Agent 交叉检查，必要时再请攻坚 Agent 出马。`,
    },
    {
      heading: '为什么不让一个 Agent 全干',
      body: '如果让一个人既查文献、又写代码、又做界面、还做测试，他的注意力会被切得很碎，而且容易自己夸自己。拆成多个角色后，每个 Agent 的上下文更干净，检查者也不是作者本人，错误更容易被发现；互不依赖的任务还能同时进行，整体更快。',
    },
    {
      heading: '左边三个区域在干什么',
      body: '顶栏先选定工作区，相当于确定研究所的办公地点；文件寄存区里有工作区文件和外部只读引用；Prompt 输入区就是你对所长说的话；子代理设置区相当于人员档案：每个人用什么模型、走哪个 harness、额外叮嘱什么，都可以单独改。',
    },
    {
      heading: '右边三个区域在干什么',
      body: '最上面是调用链，记录所长到底派了谁、谁先谁后、花了多少 token；中间是所长汇报，你会看到它边干边说的过程；最下面就是我这里：用图和比喻把架构讲清楚。三块内容都来自同一条实时事件流，所以你能看着任务一步步发生。',
    },
    {
      heading: '这次实际发生了什么',
      body: `本次共产生 ${calls.length} 个调用节点，触发了 ${calls.filter((call) => call.status === 'done').length} 个子任务。${hardTriggered ? '任务难度较高，攻坚 Agent 被启用，对卡点做了重新建模。' : '常规流程足够应付，攻坚 Agent 这次没有出场。'} 你可以对照上面的调用链，看到每一次委派和它的耗时。`,
    },
    {
      heading: '你可以怎么继续用',
      body: '想更省成本，就把简单任务的模型换成小模型；想更稳，就保留 Debug Agent 并给它更严格的检查清单；遇到反复失败的硬问题，再打开攻坚 Agent。工作区里的背景材料越完整，子代理就越少靠猜。',
    },
  ]

  const activeRoles = [
    enabledRoles.has('search') ? '检索' : '',
    enabledRoles.has('backend') ? '后端' : '',
    enabledRoles.has('frontend') ? '前端' : '',
    enabledRoles.has('debug') ? '调试' : '',
    enabledRoles.has('hard') ? '攻坚' : '',
    enabledRoles.has('teacher') ? '教师' : '',
  ].filter(Boolean)

  return {
    title: '这一套系统到底怎么运转',
    intro: `你刚才让 ${subject} 跑了一轮。下面这张图就是整个研究所的组织结构，当前启用的角色有：${activeRoles.join('、') || '仅 Boss'}。`,
    mermaid: [...lines, ...styles].join('\n'),
    sections,
    glossary: [
      {
        term: 'Agent',
        meaning: '一个被设定了角色和工具的 AI 员工，不是普通聊天窗口。',
      },
      {
        term: 'Harness',
        meaning: 'Agent 的「工作台」，决定它能用哪些工具、怎么执行任务。',
      },
      {
        term: '工作区',
        meaning: 'Agent 的办公地点，里面的文件可以被直接读写。',
      },
      {
        term: '上下文',
        meaning: 'Agent 当前能看到的资料，像摊在桌上的文件。',
      },
      {
        term: '调用链',
        meaning: '谁把任务派给了谁、先后顺序和耗时，像公司的工单流转记录。',
      },
      {
        term: '实时流',
        meaning: '结果不是等全部做完才出现，而是一边做一边推给你看。',
      },
    ],
  }
}
