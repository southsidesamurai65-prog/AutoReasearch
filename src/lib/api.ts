import type {
  AgentConfig,
  AppConfig,
  AppSettings,
  CreateRunResponse,
  FsListing,
  HarnessStatus,
  NetworkSettings,
  PublicAgentConfig,
  ReferenceItem,
  RunMode,
  RunSnapshot,
  RunSummary,
  RuntimeSettings,
  ThreadMode,
  WorkspaceDiff,
  WorkspaceFile,
  WorkspaceState,
} from '../../shared/types'

export type AgentPatch = Partial<
  Pick<
    AgentConfig,
    | 'name'
    | 'description'
    | 'systemPrompt'
    | 'harness'
    | 'model'
    | 'baseUrl'
    | 'maxTurns'
    | 'budgetUsd'
    | 'enabled'
    | 'color'
    | 'apiKey'
  >
> & { clearKey?: boolean }

export type SettingsPatch = {
  network?: Partial<NetworkSettings>
  runtime?: Partial<RuntimeSettings>
}

export interface ModelTestResult {
  ok: boolean
  model: string
  text: string
  error?: string
  latencyMs: number
  tokens: number
  costUsd: number
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string
    }
    throw new Error(body.error ?? `请求失败 (${response.status})`)
  }
  return (await response.json()) as T
}

export const api = {
  config(): Promise<AppConfig> {
    return request<AppConfig>('/api/config')
  },

  harnessStatus(): Promise<HarnessStatus> {
    return request<HarnessStatus>('/api/harness/status')
  },

  settings(): Promise<AppSettings> {
    return request<AppSettings>('/api/settings')
  },

  updateSettings(patch: SettingsPatch): Promise<AppSettings> {
    return request<AppSettings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  },

  testModel(model?: string): Promise<ModelTestResult> {
    return request<ModelTestResult>('/api/settings/test-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    })
  },

  workspace(): Promise<WorkspaceState> {
    return request<WorkspaceState>('/api/workspace')
  },

  openWorkspace(target: string): Promise<WorkspaceState> {
    return request<WorkspaceState>('/api/workspace/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: target }),
    })
  },

  async workspaceFiles(): Promise<WorkspaceFile[]> {
    const result = await request<{ files: WorkspaceFile[] }>(
      '/api/workspace/files',
    )
    return result.files
  },

  async references(): Promise<ReferenceItem[]> {
    const result = await request<{ references: ReferenceItem[] }>(
      '/api/workspace/references',
    )
    return result.references
  },

  addReference(target: string): Promise<ReferenceItem> {
    return request<ReferenceItem>('/api/workspace/references', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: target }),
    })
  },

  async uploadReference(file: File): Promise<ReferenceItem> {
    const form = new FormData()
    form.append('file', file)
    return request<ReferenceItem>('/api/workspace/references/upload', {
      method: 'POST',
      body: form,
    })
  },

  async uploadReferences(files: File[]): Promise<ReferenceItem[]> {
    const uploaded: ReferenceItem[] = []
    for (const file of files) {
      uploaded.push(await api.uploadReference(file))
    }
    return uploaded
  },

  deleteReference(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(
      `/api/workspace/references/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    )
  },

  listDirectory(target?: string): Promise<FsListing> {
    const query = target ? `?path=${encodeURIComponent(target)}` : ''
    return request<FsListing>(`/api/fs/list${query}`)
  },

  createDirectory(parent: string, name: string): Promise<{ path: string }> {
    return request<{ path: string }>('/api/fs/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent, name }),
    })
  },

  addAgent(input: {
    presetId?: string
    name?: string
  }): Promise<PublicAgentConfig> {
    return request<PublicAgentConfig>('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  },

  updateAgent(id: string, patch: AgentPatch): Promise<PublicAgentConfig> {
    return request<PublicAgentConfig>(`/api/agents/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  },

  deleteAgent(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/api/agents/${id}`, { method: 'DELETE' })
  },

  startRun(
    prompt: string,
    mode: RunMode,
    threadMode: ThreadMode,
  ): Promise<CreateRunResponse> {
    return request<CreateRunResponse>('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, mode, threadMode }),
    })
  },

  getRun(id: string): Promise<RunSnapshot> {
    return request<RunSnapshot>(`/api/runs/${id}`)
  },

  async listRuns(): Promise<RunSummary[]> {
    const result = await request<{ runs: RunSummary[] }>('/api/runs')
    return result.runs
  },

  deleteRun(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/api/runs/${id}`, { method: 'DELETE' })
  },

  getRunDiff(id: string): Promise<WorkspaceDiff> {
    return request<WorkspaceDiff>(`/api/runs/${id}/diff`)
  },

  rollbackRun(id: string): Promise<{ ok: boolean; removed: string[] }> {
    return request<{ ok: boolean; removed: string[] }>(
      `/api/runs/${id}/rollback`,
      { method: 'POST' },
    )
  },

  cancelRun(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/api/runs/${id}/cancel`, {
      method: 'POST',
    })
  },
}
