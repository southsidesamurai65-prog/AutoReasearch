import { promises as fs } from 'node:fs'
import { nanoid } from 'nanoid'
import {
  AGENT_PRESETS,
  ALL_PRESETS,
  DEFAULT_MODEL,
  DEFAULT_SETTINGS,
} from '../shared/presets'
import type {
  AgentConfig,
  AppConfig,
  AppSettings,
  NetworkSettings,
  PublicAgentConfig,
  RuntimeSettings,
} from '../shared/types'
import { CONFIG_PATH, DATA_DIR } from './paths'

interface StoredConfig {
  projectName: string
  version?: number
  agents: AgentConfig[]
  settings: AppSettings
}

let config: StoredConfig | null = null

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    network: { ...settings.network },
    runtime: { ...settings.runtime },
  }
}

function normalizeSettings(raw?: Partial<AppSettings>): AppSettings {
  const network = raw?.network
  const runtime = raw?.runtime
  return {
    network: {
      enabled: network?.enabled === true,
      httpProxy: network?.httpProxy?.trim() ?? '',
      httpsProxy: network?.httpsProxy?.trim() ?? '',
      noProxy:
        network?.noProxy?.trim() || DEFAULT_SETTINGS.network.noProxy,
      caCertPath: network?.caCertPath?.trim() ?? '',
    },
    runtime: {
      runTimeoutMinutes:
        typeof runtime?.runTimeoutMinutes === 'number' &&
        Number.isFinite(runtime.runTimeoutMinutes)
          ? Math.min(180, Math.max(1, Math.round(runtime.runTimeoutMinutes)))
          : DEFAULT_SETTINGS.runtime.runTimeoutMinutes,
      subagentSessionPolicy:
        runtime?.subagentSessionPolicy === 'keep' ? 'keep' : 'delete',
    },
  }
}

function clonePreset(preset: AgentConfig): AgentConfig {
  return { ...preset }
}

async function persist(): Promise<void> {
  if (!config) return
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
}

export async function ensureStore(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw) as StoredConfig
    if (!Array.isArray(parsed.agents) || parsed.agents.length === 0) {
      throw new Error('invalid config')
    }
    config = {
      projectName: parsed.projectName || '未命名研究项目',
      version: parsed.version ?? 1,
      agents: parsed.agents,
      settings: normalizeSettings(parsed.settings),
    }
  } catch {
    config = {
      projectName: '未命名研究项目',
      version: 3,
      agents: AGENT_PRESETS.map(clonePreset),
      settings: cloneSettings(DEFAULT_SETTINGS),
    }
    await persist()
  }

  if ((config.version ?? 1) < 2) {
    for (const agent of config.agents) {
      agent.model = DEFAULT_MODEL
      agent.harness = 'opencode'
    }
    config.version = 2
    await persist()
  }

  if ((config.version ?? 1) < 3) {
    config.version = 3
    await persist()
  }
}

function requireConfig(): StoredConfig {
  if (!config) throw new Error('store not initialised')
  return config
}

export function getProjectName(): string {
  return requireConfig().projectName
}

export function getAgents(): AgentConfig[] {
  return requireConfig().agents
}

function toPublic(agent: AgentConfig): PublicAgentConfig {
  const { apiKey, ...rest } = agent
  return { ...rest, hasKey: apiKey.length > 0 }
}

export function getSettings(): AppSettings {
  return cloneSettings(requireConfig().settings)
}

export function getPublicConfig(workspace: string): AppConfig {
  const current = requireConfig()
  return {
    projectName: current.projectName,
    workspace,
    defaultModel: DEFAULT_MODEL,
    agents: current.agents.map(toPublic),
    settings: cloneSettings(current.settings),
  }
}

export async function updateSettings(
  patch: {
    network?: Partial<NetworkSettings>
    runtime?: Partial<RuntimeSettings>
  },
): Promise<AppSettings> {
  const current = requireConfig()
  current.settings = normalizeSettings({
    network: { ...current.settings.network, ...patch.network },
    runtime: { ...current.settings.runtime, ...patch.runtime },
  })
  await persist()
  return cloneSettings(current.settings)
}

export async function updateAgent(
  id: string,
  patch: Partial<AgentConfig> & { clearKey?: boolean },
): Promise<PublicAgentConfig | null> {
  const agent = requireConfig().agents.find((item) => item.id === id)
  if (!agent) return null

  const allowed: (keyof AgentConfig)[] = [
    'name',
    'description',
    'systemPrompt',
    'harness',
    'model',
    'baseUrl',
    'maxTurns',
    'budgetUsd',
    'enabled',
    'color',
  ]

  for (const key of allowed) {
    const value = patch[key]
    if (value !== undefined) {
      ;(agent as unknown as Record<string, unknown>)[key] = value
    }
  }

  if (agent.role === 'boss') agent.enabled = true
  if (patch.clearKey) agent.apiKey = ''
  else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
    agent.apiKey = patch.apiKey.trim()
  }

  await persist()
  return toPublic(agent)
}

export async function addAgent(input: {
  presetId?: string
  name?: string
}): Promise<PublicAgentConfig> {
  const current = requireConfig()
  const preset = ALL_PRESETS.find((item) => item.id === input.presetId)

  const agent: AgentConfig = preset
    ? {
        ...clonePreset(preset),
        id: `${preset.id}-${nanoid(5)}`,
        name: input.name?.trim() || preset.name,
        enabled: true,
        apiKey: '',
      }
    : {
        id: `custom-${nanoid(5)}`,
        name: input.name?.trim() || '自定义 Agent',
        role: 'custom',
        description: '空白自定义代理，按需补充职责与提示词。',
        systemPrompt: '',
        harness: 'opencode',
        model: DEFAULT_MODEL,
        baseUrl: '',
        apiKey: '',
        maxTurns: 20,
        budgetUsd: 2,
        enabled: true,
        color: '#94a3b8',
      }

  current.agents.push(agent)
  await persist()
  return toPublic(agent)
}

export async function deleteAgent(id: string): Promise<boolean> {
  const current = requireConfig()
  const index = current.agents.findIndex((item) => item.id === id)
  if (index < 0) return false
  if (current.agents[index].role === 'boss') return false

  current.agents.splice(index, 1)
  await persist()
  return true
}
