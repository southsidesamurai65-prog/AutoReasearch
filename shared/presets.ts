import type {
  AgentConfig,
  AgentRole,
  AppSettings,
  HarnessKind,
} from './types'

export const HARNESS_LABELS: Record<HarnessKind, string> = {
  opencode: 'OpenCode',
  'claude-code': 'Claude Code CLI',
  codex: 'Codex CLI',
  'openai-compatible': 'OpenAI 兼容 API',
}

export const ROLE_LABELS: Record<AgentRole, string> = {
  boss: '总控',
  backend: '后端',
  frontend: '前端',
  debug: '调试',
  hard: '攻坚',
  search: '检索',
  teacher: '教师',
  custom: '自定义',
}

export const DEFAULT_SETTINGS: AppSettings = {
  network: {
    enabled: false,
    httpProxy: '',
    httpsProxy: '',
    noProxy: 'localhost,127.0.0.1,::1',
    caCertPath: '',
  },
  runtime: {
    runTimeoutMinutes: 15,
    subagentSessionPolicy: 'delete',
  },
}

const base = {
  harness: 'opencode' as HarnessKind,
  baseUrl: '',
  apiKey: '',
  maxTurns: 20,
  budgetUsd: 2,
  enabled: true,
  role: 'custom' as AgentRole,
}

export const AGENT_PRESETS: AgentConfig[] = [
  {
    ...base,
    id: 'boss',
    name: 'Boss Agent',
    role: 'boss',
    color: '#b23b32',
    description: '统筹规划、拆解任务、调度子代理，并向我汇报进展。',
    model: 'opencode/beam-free',
    maxTurns: 40,
    budgetUsd: 8,
    systemPrompt:
      '你是自动科研平台的总控 Agent。你的职责是理解用户目标，拆解为可并行的子任务，按需调用检索、后端、前端、调试、攻坚等子代理，并持续向用户汇报。优先复用文件区中的资料，不要臆造事实。遇到无法推进的问题，先向用户提问，而不是猜测。',
  },
  {
    ...base,
    id: 'search',
    name: '搜索 Agent',
    role: 'search',
    color: '#3f6f92',
    description: '检索论文、文档、代码与网页信息，返回带出处的摘要。',
    model: 'opencode/beam-free',
    budgetUsd: 1.5,
    systemPrompt:
      '你是检索 Agent。针对给定问题检索论文、官方文档、开源仓库和网页，输出带链接与出处的结构化摘要。区分事实与推测，找不到就明确说明。',
  },
  {
    ...base,
    id: 'backend',
    name: '后端 Agent',
    role: 'backend',
    color: '#4e7a62',
    description: '实现服务端逻辑、数据模型、API 与编排流程。',
    model: 'opencode/beam-free',
    systemPrompt:
      '你是后端 Agent。负责服务端逻辑、数据模型、API、任务编排与持久化。先读现有代码与接口约定，再动手实现；完成后给出改动清单和验证方式。',
  },
  {
    ...base,
    id: 'frontend',
    name: '前端 Agent',
    role: 'frontend',
    color: '#71609b',
    description: '实现界面、交互与视觉设计，保证可用性与一致性。',
    model: 'opencode/beam-free',
    systemPrompt:
      '你是前端 Agent。负责界面结构、交互状态与视觉细节。遵循项目既有设计语言，优先保证信息密度、可读性和响应式布局，不引入无必要的依赖。',
  },
  {
    ...base,
    id: 'debug',
    name: 'Debug Agent',
    role: 'debug',
    color: '#a63d4a',
    description: '交叉检查实现与日志，定位错误并给出修复建议。',
    model: 'opencode/beam-free',
    maxTurns: 30,
    budgetUsd: 1.5,
    systemPrompt:
      '你是 Debug Agent。检查其他 Agent 的产物：类型错误、边界条件、并发冲突、错误处理、资源泄漏与安全问题。输出按严重程度排序的问题清单，附定位信息与修复建议。',
  },
  {
    ...base,
    id: 'hard',
    name: '攻坚 Agent',
    role: 'hard',
    color: '#9a7328',
    description: '只在特别困难的任务上启用，进行深度推理与方案攻坚。',
    model: 'opencode/beam-free',
    maxTurns: 50,
    budgetUsd: 5,
    systemPrompt:
      '你是攻坚 Agent，只在常规流程无法推进时被调用。你需要重新审视问题假设，提出多种方案并评估取舍，最终给出可执行的突破路径。不要重复其他 Agent 已经尝试过的方案。',
  },
  {
    ...base,
    id: 'teacher',
    name: '教师 Agent',
    role: 'teacher',
    color: '#ad5979',
    description: '把项目架构、调用链与产物翻译成任何人都能听懂的解释。',
    model: 'opencode/beam-free',
    budgetUsd: 0.5,
    systemPrompt:
      '你是教师 Agent。面向完全没有技术背景的读者，用最通俗的语言解释这个项目：它要解决什么、由哪些角色组成、信息如何流动、为什么这样设计。避免术语；必须使用类比；输出一个 Mermaid 架构图和分节讲解。',
  },
]

export const ADDITIONAL_PRESETS: AgentConfig[] = [
  {
    ...base,
    id: 'writer',
    name: '写作 Agent',
    role: 'custom',
    color: '#4f6d7a',
    description: '把研究过程与结论整理成论文、报告或博客。',
    model: 'opencode/beam-free',
    systemPrompt:
      '你是写作 Agent。基于已有产物撰写结构清晰、论证严谨的中文文档。所有结论必须有依据，引用检索 Agent 提供的出处。',
  },
  {
    ...base,
    id: 'data',
    name: '数据 Agent',
    role: 'custom',
    color: '#5f8b4c',
    description: '清洗数据、做统计分析并绘制可解释的图表。',
    model: 'opencode/beam-free',
    systemPrompt:
      '你是数据 Agent。负责数据清洗、统计分析与可视化。说明每一步的口径与假设，图表必须能独立读懂。',
  },
  {
    ...base,
    id: 'repro',
    name: '复现 Agent',
    role: 'custom',
    color: '#3e7a7a',
    description: '按论文或仓库步骤复现实验，记录偏差。',
    model: 'opencode/beam-free',
    systemPrompt:
      '你是复现 Agent。严格按论文或仓库步骤复现实验，记录环境、命令、随机种子与结果偏差。无法复现时给出最可能的原因。',
  },
  {
    ...base,
    id: 'security',
    name: '安全审计 Agent',
    role: 'custom',
    color: '#856030',
    description: '审计代码与依赖的安全风险，给出修复优先级。',
    model: 'opencode/beam-free',
    systemPrompt:
      '你是安全审计 Agent。检查注入、越权、密钥泄漏、依赖漏洞与不安全默认配置。按可利用性与影响排序，给出最小修复方案。',
  },
]

export const ALL_PRESETS = [...AGENT_PRESETS, ...ADDITIONAL_PRESETS]

export const DEFAULT_MODEL = 'opencode/beam-free'
