import { useState } from 'react'
import { ArrowRight, FileLock2, Loader2, TriangleAlert } from 'lucide-react'
import type { ReferenceItem } from '../../shared/types'
import { api } from '../lib/api'
import { Modal } from './Modal'
import { FsBrowser } from './FsBrowser'

interface ReferenceDialogProps {
  workspacePath: string
  onClose: () => void
  onAdded: (reference: ReferenceItem) => void
}

export function ReferenceDialog({
  workspacePath,
  onClose,
  onAdded,
}: ReferenceDialogProps) {
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = async () => {
    if (!path.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const reference = await api.addReference(path.trim())
      onAdded(reference)
      onClose()
    } catch (addError) {
      setError(
        addError instanceof Error ? addError.message : '无法添加引用',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="添加外部引用"
      subtitle="文件不会复制，只在工作区 .auto/refs 下建立只读链接"
      icon={
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-sky-400/25 bg-sky-400/10">
          <FileLock2 size={15} className="text-sky-300" />
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
                if (event.key === 'Enter') void add()
              }}
              className="field font-mono text-[11px]"
              placeholder="/home/you/Downloads/paper.pdf"
            />
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy || !path.trim()}
              className="btn btn-primary h-[34px] shrink-0 px-3 text-[11px]"
            >
              {busy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <ArrowRight size={12} />
              )}
              添加引用
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
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_210px]">
        <FsBrowser
          mode="file"
          onFileSelect={(selected) => {
            if (selected) setPath(selected)
          }}
        />

        <div className="space-y-2">
          <div className="rounded-lg border border-line/70 bg-ink-950/40 p-2.5">
            <p className="panel-kicker mb-1.5">引用规则</p>
            <ul className="space-y-1.5 text-[10px] leading-4 text-slate-500">
              <li>· 原文件不会被复制或上传。</li>
              <li>· 工作区里会出现一个只读链接。</li>
              <li>
                · harness 通过 <code className="text-accent/80">.auto/refs</code>{' '}
                读取它。
              </li>
              <li>· 原文件移动或删除后，引用会显示失效。</li>
            </ul>
          </div>
          <div className="rounded-lg border border-line/70 bg-ink-950/40 p-2.5">
            <p className="panel-kicker mb-1">工作区</p>
            <p
              className="break-all font-mono text-[9px] leading-4 text-slate-500"
              title={workspacePath}
            >
              {workspacePath}
            </p>
          </div>
        </div>
      </div>
    </Modal>
  )
}
