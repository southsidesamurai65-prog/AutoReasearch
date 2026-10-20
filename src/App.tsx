import { useCallback, useEffect, useState } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
import type {
  AppConfig,
  HarnessStatus,
  ReferenceItem,
  RunMode,
  ThreadMode,
  WorkspaceFile,
  WorkspaceState,
} from '../shared/types'
import { api, type AgentPatch } from './lib/api'
import { useRun } from './hooks/useRun'
import { TopBar } from './components/TopBar'
import { FileVault } from './components/FileVault'
import { PromptComposer } from './components/PromptComposer'
import { AgentSettings } from './components/AgentSettings'
import { CallTree } from './components/CallTree'
import { BossReport } from './components/BossReport'
import { TeacherPanel } from './components/TeacherPanel'
import { WorkspaceDialog } from './components/WorkspaceDialog'
import { ReferenceDialog } from './components/ReferenceDialog'

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState | null>(
    null,
  )
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([])
  const [references, setReferences] = useState<ReferenceItem[]>([])
  const [harness, setHarness] = useState<HarnessStatus | null>(null)
  const [mode, setMode] = useState<RunMode>('real')
  const [threadMode, setThreadMode] = useState<ThreadMode>('continue')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showWorkspace, setShowWorkspace] = useState(false)
  const [showReference, setShowReference] = useState(false)
  const { state: run, start, cancel, reset } = useRun()

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.config(),
      api.workspace(),
      api.workspaceFiles(),
      api.references(),
      api.harnessStatus(),
    ])
      .then(([nextConfig, nextWorkspace, nextFiles, nextRefs, nextHarness]) => {
        if (cancelled) return
        setConfig(nextConfig)
        setWorkspaceState(nextWorkspace)
        setWorkspaceFiles(nextFiles)
        setReferences(nextRefs)
        setHarness(nextHarness)
        if (!nextHarness.available) setMode('mock')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(
          error instanceof Error ? error.message : '无法连接后端服务',
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const refreshFiles = useCallback(async () => {
    setWorkspaceFiles(await api.workspaceFiles())
  }, [])

  const refreshReferences = useCallback(async () => {
    setReferences(await api.references())
  }, [])

  const refreshWorkspace = useCallback(async () => {
    const [nextWorkspace, nextFiles, nextRefs] = await Promise.all([
      api.workspace(),
      api.workspaceFiles(),
      api.references(),
    ])
    setWorkspaceState(nextWorkspace)
    setWorkspaceFiles(nextFiles)
    setReferences(nextRefs)
    setConfig((previous) =>
      previous ? { ...previous, workspace: nextWorkspace.workspace.path } : previous,
    )
  }, [])

  useEffect(() => {
    if (run.status === 'done' && run.runId) {
      void refreshWorkspace().catch(() => {})
    }
  }, [run.status, run.runId, refreshWorkspace])

  const uploadReferences = useCallback(
    async (incoming: File[]) => {
      try {
        await api.uploadReferences(incoming)
      } finally {
        await refreshReferences()
      }
    },
    [refreshReferences],
  )

  const addReference = useCallback(
    (reference: ReferenceItem) => {
      setReferences((previous) => [...previous, reference])
      void refreshReferences().catch(() => {})
    },
    [refreshReferences],
  )

  const deleteReference = useCallback(async (id: string) => {
    await api.deleteReference(id)
    setReferences((previous) =>
      previous.filter((reference) => reference.id !== id),
    )
  }, [])

  const saveAgent = useCallback(async (id: string, patch: AgentPatch) => {
    const updated = await api.updateAgent(id, patch)
    setConfig((previous) =>
      previous
        ? {
            ...previous,
            agents: previous.agents.map((agent) =>
              agent.id === id ? updated : agent,
            ),
          }
        : previous,
    )
  }, [])

  const addAgent = useCallback(async (presetId?: string) => {
    const created = await api.addAgent({ presetId })
    setConfig((previous) =>
      previous
        ? { ...previous, agents: [...previous.agents, created] }
        : previous,
    )
  }, [])

  const removeAgent = useCallback(async (id: string) => {
    await api.deleteAgent(id)
    setConfig((previous) =>
      previous
        ? {
            ...previous,
            agents: previous.agents.filter((agent) => agent.id !== id),
          }
        : previous,
    )
  }, [])

  const openedWorkspace = useCallback(
    (state: WorkspaceState) => {
      setWorkspaceState(state)
      setConfig((previous) =>
        previous ? { ...previous, workspace: state.workspace.path } : previous,
      )
      setThreadMode('continue')
      void refreshWorkspace().catch(() => {})
    },
    [refreshWorkspace],
  )

  const busy = run.status === 'running' || run.status === 'starting'
  const openWorkspaceDialog = useCallback(() => {
    if (busy) return
    setShowWorkspace(true)
  }, [busy])

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/30 bg-accent/10">
          <Loader2 size={17} className="animate-spin text-accent" />
        </div>
        <p className="font-mono text-[10px] tracking-[0.2em] text-slate-600">
          BOOTING AUTO RESEARCH CONSOLE
        </p>
      </div>
    )
  }

  if (loadError || !config || !workspaceState) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-rose-400/30 bg-rose-400/10">
          <TriangleAlert size={17} className="text-rose-300" />
        </div>
        <p className="text-[13px] text-slate-300">后端还没准备好</p>
        <p className="max-w-md text-[11px] leading-5 text-slate-500">
          {loadError ?? '配置为空'}。请确认{' '}
          <code className="text-accent">npm run dev</code> 已同时启动 server 与
          web。
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn btn-ghost h-8 px-3 text-[11px]"
        >
          重新加载
        </button>
      </div>
    )
  }

  const enabledAgents = config.agents.filter((agent) => agent.enabled).length
  const teacherEnabled = config.agents.some(
    (agent) => agent.role === 'teacher' && agent.enabled,
  )

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:min-h-0 lg:overflow-hidden">
      <TopBar
        run={run}
        agentCount={enabledAgents}
        refCount={references.length}
        workspace={workspaceState.workspace}
        harness={harness}
        onOpenWorkspace={openWorkspaceDialog}
        onReset={reset}
      />

      <main className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[396px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-3">
          <FileVault
            workspace={workspaceState.workspace}
            files={workspaceFiles}
            references={references}
            locked={busy}
            onRefreshFiles={refreshFiles}
            onAddReference={() => {
              if (!busy) setShowReference(true)
            }}
            onUploadReferences={uploadReferences}
            onRemoveReference={deleteReference}
            onOpenWorkspace={openWorkspaceDialog}
          />
          <PromptComposer
            status={run.status}
            mode={mode}
            threadMode={threadMode}
            thread={workspaceState.thread}
            agentCount={enabledAgents}
            workspaceFileCount={workspaceFiles.length}
            refCount={references.length}
            harnessAvailable={harness?.available ?? false}
            workspaceName={workspaceState.workspace.name}
            error={run.error}
            onModeChange={setMode}
            onThreadModeChange={setThreadMode}
            onStart={(prompt) => void start(prompt, mode, threadMode)}
            onCancel={() => void cancel()}
          />
          <AgentSettings
            agents={config.agents}
            onAdd={addAgent}
            onSave={saveAgent}
            onDelete={removeAgent}
          />
        </aside>

        <div className="grid min-h-0 gap-3 lg:grid-rows-[minmax(170px,0.82fr)_minmax(190px,1fr)_minmax(240px,1.25fr)]">
          <CallTree calls={run.calls} active={run.status === 'running'} />
          <BossReport report={run.report} status={run.status} />
          <TeacherPanel
            brief={run.teacher}
            status={run.status}
            hasTeacher={teacherEnabled}
          />
        </div>
      </main>

      {showWorkspace && (
        <WorkspaceDialog
          current={workspaceState}
          onClose={() => setShowWorkspace(false)}
          onOpened={openedWorkspace}
        />
      )}

      {showReference && (
        <ReferenceDialog
          workspacePath={workspaceState.workspace.path}
          onClose={() => setShowReference(false)}
          onAdded={addReference}
        />
      )}
    </div>
  )
}
