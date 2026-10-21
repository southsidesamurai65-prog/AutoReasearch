import { useCallback, useEffect, useState } from 'react'
import {
  Eye,
  GitCompare,
  History,
  Loader2,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import type {
  RunSnapshot,
  RunStatus,
  RunSummary,
  WorkspaceDiff,
} from '../../shared/types'
import { api } from '../lib/api'
import { formatCost, formatTokens } from '../lib/format'
import { Modal } from './Modal'

const STATUS_TEXT: Record<RunStatus, string> = {
  running: '进行中',
  done: '已完成',
  error: '失败',
  cancelled: '已取消',
}

const STATUS_TONE: Record<RunStatus, string> = {
  running: 'border-accent/30 bg-accent/10 text-accent',
  done: 'border-song-400/25 bg-song-400/8 text-song-300',
  error: 'border-yan-400/25 bg-yan-400/8 text-yan-300',
  cancelled: 'border-line bg-ink-850 text-mo-500',
}

interface RunHistoryDialogProps {
  onClose: () => void
  onLoad: (runId: string) => Promise<void>
  onWorkspaceChanged: () => void
}

export function RunHistoryDialog({
  onClose,
  onLoad,
  onWorkspaceChanged,
}: RunHistoryDialogProps) {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null)
  const [diff, setDiff] = useState<WorkspaceDiff | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selected = runs.find((run) => run.id === selectedId) ?? null

  const refresh = useCallback(async () => {
    const list = await api.listRuns()
    setRuns(list)
    setSelectedId((previous) => {
      if (previous && list.some((run) => run.id === previous)) return previous
      return list[0]?.id ?? null
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .listRuns()
      .then((list) => {
        if (cancelled) return
        setRuns(list)
        setSelectedId(list[0]?.id ?? null)
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setError(
          loadError instanceof Error ? loadError.message : '读取历史失败',
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setSnapshot(null)
      setDiff(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setError(null)
    setDiff(null)
    api
      .getRun(selectedId)
      .then((next) => {
        if (!cancelled) setSnapshot(next)
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setError(
          loadError instanceof Error ? loadError.message : '读取运行详情失败',
        )
        setSnapshot(null)
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const loadRun = async (runId: string) => {
    setBusy('load')
    setError(null)
    try {
      await onLoad(runId)
      onClose()
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : '载入运行失败',
      )
    } finally {
      setBusy(null)
    }
  }

  const loadDiff = async () => {
    if (!selectedId) return
    setBusy('diff')
    setError(null)
    try {
      setDiff(await api.getRunDiff(selectedId))
    } catch (diffError) {
      setError(
        diffError instanceof Error ? diffError.message : '读取改动失败',
      )
    } finally {
      setBusy(null)
    }
  }

  const rollback = async () => {
    if (!selectedId || !selected) return
    const confirmed = window.confirm(
      `确定把工作区回滚到这次运行开始前吗？\n\n${selected.workspace}\n\n运行中新建且不在快照里的文件会被删除。`,
    )
    if (!confirmed) return

    setBusy('rollback')
    setError(null)
    try {
      const result = await api.rollbackRun(selectedId)
      setDiff(null)
      onWorkspaceChanged()
      window.alert(
        result.removed.length > 0
          ? `已回滚，删除 ${result.removed.length} 个运行期间新增文件。`
          : '已回滚到运行前快照。',
      )
    } catch (rollbackError) {
      setError(
        rollbackError instanceof Error
          ? rollbackError.message
          : '回滚失败',
      )
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!selectedId) return
    const confirmed = window.confirm(
      '确定删除这条运行记录吗？只删除历史记录，不会改动工作区。',
    )
    if (!confirmed) return

    setBusy('delete')
    setError(null)
    try {
      await api.deleteRun(selectedId)
      await refresh()
      setSnapshot(null)
      setDiff(null)
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : '删除失败',
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      title="运行历史"
      subtitle="持久化报告、调用链与工作区快照"
      icon={<History size={16} className="text-accent" />}
      onClose={onClose}
      wide
    >
      <div className="grid min-h-[420px] gap-3 md:grid-cols-[230px_minmax(0,1fr)]">
        <div className="scroll-thin max-h-[60vh] space-y-1 overflow-y-auto border-r border-line/60 pr-2">
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-mo-500">
              <Loader2 size={12} className="animate-spin" /> 读取历史…
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
              <History size={18} className="text-mo-400" />
              <p className="text-[11px] text-mo-500">还没有运行记录</p>
              <p className="text-[10px] leading-4 text-mo-400">
                完成一次真实或 Mock 研究后，会自动保存到这里。
              </p>
            </div>
          ) : (
            runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => setSelectedId(run.id)}
                className={`w-full rounded-md border px-2.5 py-2 text-left transition ${
                  selectedId === run.id
                    ? 'border-accent/40 bg-accent/[0.06]'
                    : 'border-transparent hover:border-line hover:bg-ink-850/70'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`rounded border px-1 py-px font-mono text-[8px] ${STATUS_TONE[run.status]}`}
                  >
                    {STATUS_TEXT[run.status]}
                  </span>
                  <span className="font-mono text-[8.5px] text-mo-400">
                    {run.mode.toUpperCase()}
                  </span>
                  <span className="ml-auto font-mono text-[8.5px] text-mo-400">
                    {formatCost(run.costUsd)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[10.5px] leading-4 text-mo-700">
                  {run.prompt}
                </p>
                <p className="mt-1 truncate font-mono text-[8.5px] text-mo-400">
                  {new Date(run.startedAt).toLocaleString('zh-CN')}
                </p>
              </button>
            ))
          )}
        </div>

        <div className="min-w-0">
          {!selected ? (
            <div className="flex h-full min-h-[300px] items-center justify-center text-[11px] text-mo-500">
              选择一条记录查看详情
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-[13px] font-semibold leading-5 text-mo-950">
                    {selected.summary || selected.prompt}
                  </h3>
                  <p className="mt-0.5 text-[10.5px] leading-4 text-mo-500">
                    {selected.prompt}
                  </p>
                </div>
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${STATUS_TONE[selected.status]}`}
                >
                  {STATUS_TEXT[selected.status]}
                </span>
              </div>

              <div className="grid gap-2 text-[10px] text-mo-500 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="开始" value={new Date(selected.startedAt).toLocaleString('zh-CN')} />
                <Stat
                  label="耗时"
                  value={
                    selected.endedAt
                      ? `${Math.max(0, Math.round((new Date(selected.endedAt).getTime() - new Date(selected.startedAt).getTime()) / 1000))}s`
                      : '—'
                  }
                />
                <Stat label="Token" value={formatTokens(selected.tokens)} />
                <Stat label="费用" value={formatCost(selected.costUsd)} />
              </div>

              <div className="rounded-md border border-line/60 bg-ink-850/40 px-2.5 py-2 font-mono text-[9px] leading-5 text-mo-500">
                <p className="truncate" title={selected.workspace}>
                  工作区：{selected.workspace}
                </p>
                <p>
                  调用节点：{selected.callCount} · 线程：
                  {selected.threadMode === 'continue' ? '续聊' : '新开'} ·
                  快照：{selected.checkpoint ? '有' : '无'}
                </p>
              </div>

              {snapshot?.bossReport && (
                <details className="rounded-md border border-line/60 bg-ink-950/40 px-2.5 py-2">
                  <summary className="cursor-pointer text-[10px] text-mo-500">
                    Boss 报告预览（{snapshot.bossReport.length.toLocaleString('zh-CN')} 字符）
                  </summary>
                  <pre className="scroll-thin mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[9px] leading-4 text-mo-600">
                    {snapshot.bossReport.slice(0, 8000)}
                  </pre>
                </details>
              )}

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => void loadRun(selected.id)}
                  disabled={
                    selected.status === 'running' || busy !== null
                  }
                  className="btn btn-ghost h-7 px-2.5 text-[10.5px]"
                >
                  {busy === 'load' ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <Eye size={10} />
                  )}
                  载入右侧
                </button>
                <button
                  type="button"
                  onClick={() => void loadDiff()}
                  disabled={!selected.checkpoint || busy !== null}
                  className="btn btn-ghost h-7 px-2.5 text-[10.5px]"
                >
                  {busy === 'diff' ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <GitCompare size={10} />
                  )}
                  查看改动
                </button>
                <button
                  type="button"
                  onClick={() => void rollback()}
                  disabled={
                    !selected.checkpoint ||
                    selected.status === 'running' ||
                    busy !== null
                  }
                  className="btn btn-danger h-7 px-2.5 text-[10.5px]"
                >
                  {busy === 'rollback' ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <RotateCcw size={10} />
                  )}
                  回滚工作区
                </button>
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={selected.status === 'running' || busy !== null}
                  className="btn btn-ghost h-7 px-2.5 text-[10.5px]"
                >
                  {busy === 'delete' ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <Trash2 size={10} />
                  )}
                  删除记录
                </button>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-yan-500/25 bg-yan-500/5 px-2.5 py-2 text-[10.5px] leading-4 text-yan-300">
                  <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                  {error}
                </div>
              )}

              {diff && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[10px] text-mo-500">
                    <GitCompare size={11} className="text-accent/70" />
                    相对运行前快照的改动
                    {diff.truncated && (
                      <span className="text-yan-300">（已截断）</span>
                    )}
                  </div>
                  <pre className="scroll-thin max-h-40 overflow-auto rounded-md border border-line/60 bg-ink-950/60 p-2 font-mono text-[9px] leading-4 text-mo-600">
                    {diff.stat || '没有已跟踪文件的差异'}
                  </pre>
                  <pre className="scroll-thin max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line/60 bg-ink-950/70 p-2 font-mono text-[9px] leading-4 text-mo-600">
                    {diff.diff || '没有已跟踪文件的差异'}
                  </pre>
                  {diff.status && (
                    <pre className="scroll-thin max-h-32 overflow-auto rounded-md border border-line/60 bg-ink-950/50 p-2 font-mono text-[9px] leading-4 text-mo-500">
                      {diff.status}
                    </pre>
                  )}
                </div>
              )}

              {detailLoading && (
                <p className="flex items-center gap-1.5 font-mono text-[9px] text-mo-400">
                  <Loader2 size={10} className="animate-spin" /> 读取详情…
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line/50 bg-ink-950/40 px-2 py-1.5">
      <p className="font-kai text-[8.5px] tracking-[0.16em] text-mo-400">
        {label}
      </p>
      <p className="mt-0.5 truncate font-mono text-[9.5px] text-mo-600">
        {value}
      </p>
    </div>
  )
}
