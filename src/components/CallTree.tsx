import { useState } from 'react'
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Loader2,
  Network,
  Wrench,
  XCircle,
} from 'lucide-react'
import type { CallNode, CallStatus } from '../../shared/types'
import { ROLE_LABELS } from '../../shared/presets'
import {
  formatCost,
  formatDuration,
  formatTokens,
} from '../lib/format'

interface CallTreeProps {
  calls: CallNode[]
  active: boolean
}

const STATUS_TEXT: Record<CallStatus, string> = {
  queued: '排队',
  running: '进行中',
  done: '完成',
  error: '失败',
  cancelled: '取消',
}

const STATUS_TONE: Record<CallStatus, string> = {
  queued: 'text-mo-500',
  running: 'text-accent',
  done: 'text-song-300',
  error: 'text-yan-300',
  cancelled: 'text-mo-500',
}

function StatusIcon({ status, color }: { status: CallStatus; color: string }) {
  if (status === 'running') {
    return (
      <Loader2
        size={12}
        className="animate-spin text-accent"
        style={{ color }}
      />
    )
  }
  if (status === 'done') {
    return <CheckCircle2 size={12} style={{ color }} />
  }
  if (status === 'error') {
    return <XCircle size={12} className="text-yan-400" />
  }
  if (status === 'cancelled') {
    return <Ban size={11} className="text-mo-500" />
  }
  return <CircleDashed size={12} className="text-mo-400" />
}

export function CallTree({ calls, active }: CallTreeProps) {
  const children = new Map<string | null, CallNode[]>()
  for (const call of calls) {
    const key = call.parentId
    const list = children.get(key)
    if (list) list.push(call)
    else children.set(key, [call])
  }

  const roots = children.get(null) ?? []
  const tokens = calls.reduce((sum, call) => sum + (call.tokens ?? 0), 0)
  const cost = calls.reduce((sum, call) => sum + (call.costUsd ?? 0), 0)
  const running = calls.filter((call) => call.status === 'running').length

  return (
    <section className="panel h-[clamp(340px,44vh,560px)] shrink-0">
      <div className="panel-head">
        <div className="panel-title">
          <Network size={14} className="text-mo-600" />
          调用链
          <span className="chip">{calls.length}</span>
          {active && running > 0 && (
            <span className="flex items-center gap-1 font-mono text-[9px] text-accent/80">
              <span className="h-1 w-1 animate-pulse-soft rounded-full bg-accent" />
              LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono text-[9px] text-mo-400">
          {running > 0 && (
            <span className="text-accent/70">{running} running</span>
          )}
          <span>{formatTokens(tokens)} tok</span>
          <span className="h-2.5 w-px bg-line" />
          <span>{formatCost(cost)}</span>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2.5">
        {calls.length === 0 ? (
          <div className="flex h-full min-h-[110px] flex-col items-center justify-center gap-2 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-line/70 bg-ink-850/60">
              <Network size={15} className="text-mo-400" />
            </div>
            <p className="text-[11px] text-mo-500">调用链会在这里生长</p>
            <p className="max-w-[260px] text-[10px] leading-4 text-mo-400">
              启动研究后，Boss 每次委派子代理都会生成一个节点，可查看任务、耗时与开销。
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {roots.map((root) => (
              <TreeItem
                key={root.id}
                node={root}
                childrenMap={children}
                depth={0}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function TreeItem({
  node,
  childrenMap,
  depth,
}: {
  node: CallNode
  childrenMap: Map<string | null, CallNode[]>
  depth: number
}) {
  const kids = childrenMap.get(node.id) ?? []
  const [open, setOpen] = useState(false)

  return (
    <div className={depth > 0 ? 'border-l border-line/50 pl-2.5' : ''}>
      <div
        className={`group rounded-lg border px-2.5 py-1.5 transition ${
          node.status === 'running'
            ? 'border-accent/25 bg-accent/[0.035]'
            : 'border-line/50 bg-ink-850/50 hover:border-line'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <StatusIcon status={node.status} color={node.color} />
          <span className="truncate text-[11.5px] font-medium text-mo-900">
            {node.agentName}
          </span>
          <span
            className="rounded border px-1 py-px font-mono text-[8.5px]"
            style={{
              color: node.color,
              borderColor: `${node.color}33`,
              backgroundColor: `${node.color}0f`,
            }}
          >
            {ROLE_LABELS[node.role]}
          </span>
          {node.toolCalls !== undefined && node.toolCalls > 0 && (
            <span
              className="flex items-center gap-0.5 font-mono text-[8px] text-mo-400"
              title={`${node.toolCalls} 次工具调用`}
            >
              <Wrench size={8} />
              {node.toolCalls}
            </span>
          )}
          <span
            className={`ml-auto font-mono text-[8.5px] ${STATUS_TONE[node.status]}`}
          >
            {STATUS_TEXT[node.status]}
          </span>
          {node.output && (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="icon-btn h-5 w-5"
              title={open ? '收起代理输出' : '查看代理输出'}
            >
              <ChevronDown
                size={11}
                className={`transition ${open ? 'rotate-180' : ''}`}
              />
            </button>
          )}
        </div>

        <p
          className="mt-0.5 truncate text-[10px] text-mo-500"
          title={node.task}
        >
          {node.task}
        </p>

        {node.summary && (
          <p className="mt-0.5 line-clamp-1 text-[9.5px] text-mo-400">
            ↳ {node.summary}
          </p>
        )}

        <div className="mt-1 flex items-center gap-2.5 font-mono text-[8.5px] text-mo-300">
          <span>{formatDuration(node)}</span>
          {node.tokens !== undefined && <span>{node.tokens} tok</span>}
          {node.costUsd !== undefined && (
            <span>{formatCost(node.costUsd)}</span>
          )}
          {node.output && !open && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="ml-auto text-[8px] text-mo-400 transition hover:text-accent"
            >
              展开输出
            </button>
          )}
        </div>

        {open && node.output && (
          <pre className="scroll-thin mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line/60 bg-ink-950/70 p-2 font-mono text-[9px] leading-4 text-mo-600">
            {node.output}
          </pre>
        )}
      </div>

      {kids.length > 0 && (
        <div className="ml-1.5 mt-1 space-y-1">
          {kids.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              childrenMap={childrenMap}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}
