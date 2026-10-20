import { useEffect, useState } from 'react'
import {
  ChevronUp,
  Eye,
  EyeOff,
  FileText,
  Folder,
  Home,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import type { FsListing } from '../../shared/types'
import { api } from '../lib/api'
import { formatBytes } from '../lib/format'

interface FsBrowserProps {
  mode: 'directory' | 'file'
  initialPath?: string
  quickPaths?: { label: string; path: string }[]
  onPathChange?: (path: string) => void
  onFileSelect?: (path: string | null) => void
}

export function FsBrowser({
  mode,
  initialPath,
  quickPaths = [],
  onPathChange,
  onFileSelect,
}: FsBrowserProps) {
  const [listing, setListing] = useState<FsListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)

  const load = async (target?: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.listDirectory(target)
      setListing(result)
      setSelectedFile(null)
      onFileSelect?.(null)
      onPathChange?.(result.path)
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : '无法读取目录',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(initialPath)
  }, [initialPath])

  const entries =
    listing?.entries.filter((entry) => {
      if (mode === 'directory' && entry.type !== 'directory') return false
      if (!showHidden && entry.name.startsWith('.')) return false
      return true
    }) ?? []

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line/70 bg-ink-950/40">
      <div className="flex items-center gap-1.5 border-b border-line/60 px-2 py-1.5">
        <button
          type="button"
          onClick={() => void load(listing?.parent ?? undefined)}
          disabled={!listing?.parent || loading}
          className="icon-btn disabled:opacity-30"
          title="上一级"
        >
          <ChevronUp size={13} />
        </button>
        <button
          type="button"
          onClick={() => void load(undefined)}
          disabled={loading}
          className="icon-btn"
          title="主目录"
        >
          <Home size={12} />
        </button>
        <button
          type="button"
          onClick={() => void load(listing?.path)}
          disabled={loading}
          className="icon-btn"
          title="刷新"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          onClick={() => setShowHidden((value) => !value)}
          className={`icon-btn ${showHidden ? 'text-accent' : ''}`}
          title={showHidden ? '隐藏隐藏文件' : '显示隐藏文件'}
        >
          {showHidden ? <EyeOff size={11} /> : <Eye size={11} />}
        </button>

        <span
          className="min-w-0 flex-1 truncate rounded bg-ink-900/70 px-2 py-1 font-mono text-[9.5px] text-slate-500"
          title={listing?.path}
        >
          {listing?.path ?? '加载中…'}
        </span>

        {quickPaths.map((quick) => (
          <button
            key={quick.path}
            type="button"
            onClick={() => void load(quick.path)}
            className="shrink-0 rounded border border-line/70 px-1.5 py-1 text-[9px] text-slate-500 transition hover:border-accent/40 hover:text-accent"
            title={quick.path}
          >
            {quick.label}
          </button>
        ))}
      </div>

      <div className="scroll-thin min-h-[220px] flex-1 overflow-y-auto p-1.5">
        {loading ? (
          <div className="flex h-full min-h-[200px] items-center justify-center gap-2 text-[10.5px] text-slate-500">
            <Loader2 size={13} className="animate-spin" />
            读取目录…
          </div>
        ) : error ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 px-4 text-center">
            <TriangleAlert size={15} className="text-amber-300" />
            <p className="text-[10.5px] text-amber-200/80">{error}</p>
            <p className="text-[9.5px] text-slate-600">
              可以直接在上方输入框里填写完整路径。
            </p>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-1 text-slate-600">
            <Folder size={16} />
            <p className="text-[10.5px]">
              {mode === 'directory'
                ? '这个目录下没有子目录'
                : '这个目录是空的'}
            </p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {entries.map((entry) => {
              const isSelected = selectedFile === entry.path
              const isDirectory = entry.type === 'directory'
              return (
                <li key={entry.path}>
                  <button
                    type="button"
                    onClick={() => {
                      if (isDirectory) {
                        void load(entry.path)
                      } else {
                        setSelectedFile(entry.path)
                        onFileSelect?.(entry.path)
                      }
                    }}
                    className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition ${
                      isSelected
                        ? 'border-accent/40 bg-accent/[0.07]'
                        : 'border-transparent hover:border-line hover:bg-ink-850/80'
                    }`}
                  >
                    {isDirectory ? (
                      <Folder
                        size={13}
                        className="shrink-0 text-amber-300/80"
                      />
                    ) : (
                      <FileText
                        size={13}
                        className="shrink-0 text-sky-300/70"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">
                      {entry.name}
                    </span>
                    {isDirectory ? (
                      <span className="font-mono text-[8.5px] text-slate-700">
                        DIR
                      </span>
                    ) : (
                      <span className="font-mono text-[8.5px] text-slate-600">
                        {entry.size !== undefined
                          ? formatBytes(entry.size)
                          : entry.ext?.toUpperCase()}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
