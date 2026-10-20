import {
  Activity,
  ChevronDown,
  Cpu,
  FolderOpen,
  RotateCcw,
  Sparkles,
  Terminal,
} from 'lucide-react'
import type { HarnessStatus, WorkspaceInfo } from '../../shared/types'
import type { LiveStatus, RunState } from '../hooks/useRun'
import { formatCost, formatTokens } from '../lib/format'

const STATUS: Record<
  LiveStatus,
  { label: string; dot: string; className: string }
> = {
  idle: {
    label: '待命',
    dot: 'bg-slate-500',
    className: 'border-line bg-ink-800/60 text-slate-400',
  },
  starting: {
    label: '启动中',
    dot: 'bg-amber-300 animate-pulse-soft',
    className: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  },
  running: {
    label: '研究中',
    dot: 'bg-accent animate-pulse-soft',
    className: 'border-accent/40 bg-accent/10 text-accent',
  },
  done: {
    label: '已完成',
    dot: 'bg-teal-300',
    className: 'border-teal-400/30 bg-teal-400/10 text-teal-200',
  },
  cancelled: {
    label: '已取消',
    dot: 'bg-slate-400',
    className: 'border-line bg-ink-800/60 text-slate-400',
  },
  error: {
    label: '异常',
    dot: 'bg-rose-400',
    className: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
  },
}

interface TopBarProps {
  run: RunState
  agentCount: number
  refCount: number
  workspace: WorkspaceInfo
  harness: HarnessStatus | null
  onOpenWorkspace: () => void
  onReset: () => void
}

export function TopBar({
  run,
  agentCount,
  refCount,
  workspace,
  harness,
  onOpenWorkspace,
  onReset,
}: TopBarProps) {
  const status = STATUS[run.status]
  const tokens = run.calls.reduce((sum, call) => sum + (call.tokens ?? 0), 0)
  const cost = run.calls.reduce((sum, call) => sum + (call.costUsd ?? 0), 0)
  const busy = run.status === 'running' || run.status === 'starting'
  const runMode = run.mode ?? 'real'

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line/60 px-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/10">
          <Sparkles size={15} className="text-accent" />
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_2px_rgba(200,255,77,0.55)]" />
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[14px] font-bold tracking-[0.16em] text-white">
              AUTO
            </span>
            <span className="hidden text-[11px] text-slate-500 sm:inline">
              / 自动科研台
            </span>
          </div>
          <p className="truncate text-[10px] text-slate-600">
            Boss Agent 编排 · opencode harness · 实时汇报
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenWorkspace}
          disabled={busy}
          title={`${workspace.path}${workspace.writable ? '' : '（只读）'}`}
          className="ml-1 flex min-w-0 items-center gap-1.5 rounded-lg border border-line bg-ink-900/70 px-2 py-1.5 text-[10px] text-slate-400 transition hover:border-accent/30 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <FolderOpen size={11} className="shrink-0 text-accent/70" />
          <span className="max-w-[120px] truncate lg:max-w-[180px]">
            {workspace.name}
          </span>
          <span className="hidden font-mono text-[8px] text-slate-600 xl:inline">
            WORKSPACE
          </span>
          <ChevronDown size={10} className="shrink-0 text-slate-600" />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="hidden items-center gap-1.5 lg:flex">
          <span className="chip">
            <Cpu size={10} /> {agentCount} agents
          </span>
          <span className="chip">
            <Activity size={10} /> {refCount} refs
          </span>
          <span
            className={`chip ${
              harness?.available
                ? 'border-teal-400/20 text-teal-300/80'
                : 'border-rose-400/20 text-rose-300/80'
            }`}
            title={
              harness?.available
                ? `opencode ${harness.version ?? ''}`
                : harness?.error ?? '未检测到 opencode'
            }
          >
            <Terminal size={9} />
            {harness?.available ? 'OPENCODE' : 'NO HARNESS'}
          </span>
          <span
            className={`chip ${
              runMode === 'real'
                ? 'border-accent/25 text-accent/80'
                : 'border-amber-400/25 text-amber-300/80'
            }`}
          >
            {runMode === 'real' ? 'REAL' : 'MOCK'}
          </span>
        </div>

        {run.calls.length > 0 && (
          <div className="hidden items-center gap-2 rounded-full border border-line/70 bg-ink-900/70 px-2.5 py-1 font-mono text-[10px] text-slate-500 md:flex">
            <span>{formatTokens(tokens)} tok</span>
            <span className="h-2.5 w-px bg-line" />
            <span>{formatCost(cost)}</span>
          </div>
        )}

        <div
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${status.className}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </div>

        <button
          type="button"
          onClick={onReset}
          disabled={busy}
          title={busy ? '研究进行中，先取消再新建' : '清空右侧面板'}
          className="icon-btn"
        >
          <RotateCcw size={14} />
        </button>
      </div>
    </header>
  )
}
