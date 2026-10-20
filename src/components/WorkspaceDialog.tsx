import { useState } from 'react'
import {
  ArrowRight,
  Clock3,
  FolderGit2,
  FolderOpen,
  Loader2,
  TriangleAlert,
} from 'lucide-react'
import type { WorkspaceState } from '../../shared/types'
import { api } from '../lib/api'
import { Modal } from './Modal'
import { FsBrowser } from './FsBrowser'

interface WorkspaceDialogProps {
  current: WorkspaceState
  onClose: () => void
  onOpened: (state: WorkspaceState) => void
}

export function WorkspaceDialog({
  current,
  onClose,
  onOpened,
}: WorkspaceDialogProps) {
  const [path, setPath] = useState(current.workspace.path)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = async (target: string) => {
    if (!target.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const next = await api.openWorkspace(target.trim())
      onOpened(next)
      onClose()
    } catch (openError) {
      setError(
        openError instanceof Error ? openError.message : '无法打开工作区',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="选择工作区"
      subtitle="harness 会把这个目录作为 cwd，Agent 可以直接读写其中的文件"
      icon={
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/25 bg-accent/10">
          <FolderOpen size={15} className="text-accent" />
        </span>
      }
      onClose={onClose}
      wide
      footer={
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void open(path)
              }}
              className="field font-mono text-[11px]"
              placeholder="/home/you/project"
              autoFocus
            />
            <button
              type="button"
              onClick={() => void open(path)}
              disabled={busy || !path.trim()}
              className="btn btn-primary h-[34px] shrink-0 px-3 text-[11px]"
            >
              {busy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <ArrowRight size={12} />
              )}
              打开工作区
            </button>
          </div>
          {error && (
            <p className="flex items-center gap-1.5 text-[10px] text-rose-300">
              <TriangleAlert size={10} /> {error}
            </p>
          )}
        </div>
      }
    >
      <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="space-y-2">
          <div className="rounded-lg border border-line/70 bg-ink-950/40 p-2.5">
            <p className="panel-kicker mb-1.5">当前工作区</p>
            <p className="flex items-center gap-1.5 text-[11px] text-slate-200">
              <FolderGit2 size={12} className="text-accent/80" />
              <span className="truncate">{current.workspace.name}</span>
            </p>
            <p
              className="mt-0.5 truncate font-mono text-[9px] text-slate-600"
              title={current.workspace.path}
            >
              {current.workspace.path}
            </p>
            <div className="mt-1.5 flex gap-1">
              {current.workspace.isGit && <span className="chip">GIT</span>}
              <span className="chip">
                {current.workspace.writable ? '可写' : '只读'}
              </span>
            </div>
          </div>

          <p className="panel-kicker flex items-center gap-1 px-1 pt-1">
            <Clock3 size={9} /> 最近打开
          </p>
          <div className="scroll-thin max-h-[210px] space-y-1 overflow-y-auto pr-1">
            {current.recent.length === 0 ? (
              <p className="px-1 text-[10px] text-slate-600">
                还没有最近工作区
              </p>
            ) : (
              current.recent.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => {
                    setPath(item.path)
                    void open(item.path)
                  }}
                  disabled={busy}
                  className="w-full rounded-md border border-transparent px-2 py-1.5 text-left transition hover:border-line hover:bg-ink-850/70 disabled:opacity-50"
                  title={item.path}
                >
                  <p className="truncate text-[10.5px] text-slate-300">
                    {item.name}
                  </p>
                  <p className="truncate font-mono text-[8.5px] text-slate-600">
                    {item.path}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>

        <FsBrowser
          mode="directory"
          initialPath={current.workspace.path}
          onPathChange={setPath}
          quickPaths={[{ label: '当前', path: current.workspace.path }]}
        />
      </div>
    </Modal>
  )
}
