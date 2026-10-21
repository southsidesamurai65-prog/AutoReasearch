import {
  Activity,
  ChevronDown,
  Cpu,
  FolderOpen,
  RotateCcw,
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
    dot: 'bg-mo-400',
    className: 'border-mo-300/80 bg-ink-850/70 text-mo-500',
  },
  starting: {
    label: '启动中',
    dot: 'bg-ni-300 animate-pulse-soft',
    className: 'border-ni-300/40 bg-ni-300/10 text-ni-300',
  },
  running: {
    label: '研究中',
    dot: 'bg-accent animate-pulse-soft',
    className: 'border-accent/40 bg-accent/10 text-accent',
  },
  done: {
    label: '已完成',
    dot: 'bg-song-300',
    className: 'border-song-300/40 bg-song-300/10 text-song-300',
  },
  cancelled: {
    label: '已取消',
    dot: 'bg-mo-400',
    className: 'border-mo-300/80 bg-ink-850/70 text-mo-500',
  },
  error: {
    label: '异常',
    dot: 'bg-yan-300',
    className: 'border-yan-300/40 bg-yan-300/10 text-yan-300',
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
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[5px] border border-[#8f2f26] bg-gradient-to-b from-[#bc453c] to-[#a13329] shadow-seal">
          <span className="font-kai text-[17px] leading-none text-[#f8efe0]">
            研
          </span>
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[15px] font-semibold tracking-[0.28em] text-mo-950">
              自动科研台
            </span>
            <span className="hidden font-kai text-[10px] tracking-[0.2em] text-mo-400 sm:inline">
              格物 · 究理 · 自成文章
            </span>
          </div>
          <p className="truncate font-kai text-[10px] tracking-[0.08em] text-mo-400">
            Boss Agent 编排 · opencode harness · 实时报捷
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenWorkspace}
          disabled={busy}
          title={`${workspace.path}${workspace.writable ? '' : '（只读）'}`}
          className="ml-1 flex min-w-0 items-center gap-1.5 rounded-lg border border-line bg-ink-900/70 px-2 py-1.5 text-[10px] text-mo-600 transition hover:border-accent/30 hover:text-mo-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <FolderOpen size={11} className="shrink-0 text-accent/70" />
          <span className="max-w-[120px] truncate lg:max-w-[180px]">
            {workspace.name}
          </span>
          <span className="hidden font-kai text-[9px] tracking-[0.2em] text-mo-400 xl:inline">
            工作区
          </span>
          <ChevronDown size={10} className="shrink-0 text-mo-400" />
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
                ? 'border-song-400/20 text-song-300/80'
                : 'border-yan-400/20 text-yan-300/80'
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
                : 'border-ni-400/25 text-ni-300/80'
            }`}
          >
            {runMode === 'real' ? 'REAL' : 'MOCK'}
          </span>
        </div>

        {run.calls.length > 0 && (
          <div className="hidden items-center gap-2 rounded-full border border-line/70 bg-ink-900/70 px-2.5 py-1 font-mono text-[10px] text-mo-500 md:flex">
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
