import { useRef, useState } from 'react'
import {
  FileCode2,
  FileImage,
  FileJson,
  FileLock2,
  FileText,
  FolderGit2,
  FolderOpen,
  Loader2,
  LockKeyhole,
  Paperclip,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  UploadCloud,
} from 'lucide-react'
import type {
  ReferenceItem,
  WorkspaceFile,
  WorkspaceInfo,
} from '../../shared/types'
import { fileKind, formatBytes } from '../lib/format'

interface FileVaultProps {
  workspace: WorkspaceInfo
  files: WorkspaceFile[]
  references: ReferenceItem[]
  locked: boolean
  onRefreshFiles: () => Promise<void>
  onAddReference: () => void
  onUploadReferences: (files: File[]) => Promise<void>
  onRemoveReference: (id: string) => Promise<void>
  onOpenWorkspace: () => void
}

export function FileVault({
  workspace,
  files,
  references,
  locked,
  onRefreshFiles,
  onAddReference,
  onUploadReferences,
  onRemoveReference,
  onOpenWorkspace,
}: FileVaultProps) {
  const [tab, setTab] = useState<'workspace' | 'references'>('workspace')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = async (incoming: File[]) => {
    if (incoming.length === 0 || locked) return
    setBusy(true)
    setError(null)
    setTab('references')
    try {
      await onUploadReferences(incoming)
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : '上传失败',
      )
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    setError(null)
    try {
      await onRefreshFiles()
    } catch (refreshError) {
      setError(
        refreshError instanceof Error ? refreshError.message : '刷新失败',
      )
    } finally {
      setRefreshing(false)
    }
  }

  const removeRef = async (id: string) => {
    if (locked) return
    setError(null)
    try {
      await onRemoveReference(id)
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : '删除失败',
      )
    }
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setDragging(false)
    void upload(Array.from(event.dataTransfer.files))
  }

  return (
    <section className="panel shrink-0">
      <div className="panel-head">
        <div className="panel-title">
          <Paperclip size={14} className="text-mo-600" />
          文件寄存区
        </div>
        <button
          type="button"
          onClick={onOpenWorkspace}
          disabled={locked}
          className="flex min-w-0 items-center gap-1.5 rounded-md border border-line/70 bg-ink-800/50 px-1.5 py-1 text-[9.5px] text-mo-500 transition hover:border-accent/30 hover:text-mo-700 disabled:cursor-not-allowed disabled:opacity-40"
          title={workspace.path}
        >
          <FolderOpen size={10} className="shrink-0 text-accent/70" />
          <span className="max-w-[130px] truncate">{workspace.name}</span>
          {workspace.isGit && <FolderGit2 size={9} className="shrink-0" />}
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-line/60 px-2">
        <TabButton
          active={tab === 'workspace'}
          onClick={() => setTab('workspace')}
          label="工作区"
          count={files.length}
        />
        <TabButton
          active={tab === 'references'}
          onClick={() => setTab('references')}
          label="外部引用"
          count={references.length}
          accent
        />
        <span className="ml-auto flex items-center gap-1 font-mono text-[8.5px] text-accent/60">
          <span className="h-1 w-1 rounded-full bg-accent" />
          HARNESS 直读
        </span>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (locked) {
            event.preventDefault()
            setDragging(false)
            return
          }
          handleDrop(event)
        }}
        className={`relative flex min-h-[160px] flex-col transition ${
          dragging ? 'bg-accent/[0.06]' : ''
        }`}
      >
        {tab === 'workspace' ? (
          <>
            <div className="flex items-center gap-1.5 px-2 pt-1.5">
              <p
                className="min-w-0 flex-1 truncate font-mono text-[8.5px] text-mo-400"
                title={workspace.path}
              >
                {workspace.path}
              </p>
              <span className="chip">可读写</span>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={refreshing}
                className="icon-btn"
                title="刷新工作区文件"
              >
                <RefreshCw
                  size={10}
                  className={refreshing ? 'animate-spin' : ''}
                />
              </button>
            </div>

            {files.length > 0 ? (
              <ul className="scroll-thin min-h-[150px] max-h-[320px] space-y-0.5 overflow-y-auto p-1.5">
                {files.map((file) => (
                  <WorkspaceFileRow key={file.path} file={file} />
                ))}
              </ul>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-4 py-4 text-center">
                <FolderOpen size={16} className="text-mo-400" />
                <p className="text-[10.5px] text-mo-500">工作区还是空的</p>
                <p className="text-[9.5px] leading-4 text-mo-400">
                  Agent 会直接在这里读写文件；也可以换一个有资料的项目目录。
                </p>
                <button
                  type="button"
                  onClick={onOpenWorkspace}
                  className="mt-0.5 rounded-md border border-line px-2 py-1 text-[9.5px] text-mo-600 transition hover:border-accent/40 hover:text-accent"
                >
                  选择工作区
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5 px-2 pt-1.5">
              <p className="min-w-0 flex-1 truncate text-[9px] text-mo-400">
                只读挂载到 .auto/refs，原文件不复制
              </p>
              <button
                type="button"
                onClick={onAddReference}
                disabled={locked}
                className="flex items-center gap-1 rounded-md border border-line px-1.5 py-1 text-[9.5px] text-mo-600 transition hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={9} /> 路径
              </button>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy || locked}
                className="flex items-center gap-1 rounded-md border border-line px-1.5 py-1 text-[9.5px] text-mo-600 transition hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? (
                  <Loader2 size={9} className="animate-spin" />
                ) : (
                  <UploadCloud size={9} />
                )}
                上传
              </button>
            </div>

            {references.length > 0 ? (
              <ul className="scroll-thin min-h-[150px] max-h-[320px] space-y-0.5 overflow-y-auto p-1.5">
                {references.map((reference) => (
                  <ReferenceRow
                    key={reference.id}
                    reference={reference}
                    locked={locked}
                    onRemove={() => void removeRef(reference.id)}
                  />
                ))}
              </ul>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-4 py-4 text-center">
                <FileLock2 size={16} className="text-mo-400" />
                <p className="text-[10.5px] text-mo-500">
                  还没有外部引用
                </p>
                <p className="text-[9.5px] leading-4 text-mo-400">
                  指向工作区外的论文、笔记或数据；只读，不会改动原文件。
                </p>
              </div>
            )}
          </>
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-lg border border-accent/60 bg-ink-900/95 font-kai text-[11px] tracking-[0.2em] text-accent">
            松手移入 .auto/refs/uploads
          </div>
        )}
      </div>

      {error && (
        <p className="flex items-center gap-1.5 border-t border-yan-500/20 bg-yan-500/5 px-3 py-1.5 text-[10px] text-yan-300">
          <TriangleAlert size={10} /> {error}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        disabled={locked}
        className="hidden"
        onChange={(event) => void upload(Array.from(event.target.files ?? []))}
      />
    </section>
  )
}

function TabButton({
  active,
  onClick,
  label,
  count,
  accent,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  accent?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-1 px-2 py-2 text-[10.5px] transition ${
        active
          ? accent
            ? 'text-dai-300'
            : 'text-mo-800'
          : 'text-mo-400 hover:text-mo-600'
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1 font-mono text-[8.5px] ${
          active ? 'bg-ink-700 text-mo-700' : 'bg-ink-850 text-mo-400'
        }`}
      >
        {count}
      </span>
      {active && (
        <span
          className={`absolute inset-x-1 bottom-0 h-px ${
            accent ? 'bg-dai-400/70' : 'bg-accent/70'
          }`}
        />
      )}
    </button>
  )
}

function WorkspaceFileRow({ file }: { file: WorkspaceFile }) {
  const kind = fileKind(file.ext)
  const Icon =
    kind === 'code'
      ? FileCode2
      : kind === 'image'
        ? FileImage
        : kind === 'data'
          ? FileJson
          : FileText

  const tone =
    kind === 'code'
      ? 'text-song-300'
      : kind === 'image'
        ? 'text-lian-300'
        : kind === 'data'
          ? 'text-ni-300'
          : 'text-dai-300'

  const slash = file.path.lastIndexOf('/')
  const directory = slash >= 0 ? file.path.slice(0, slash + 1) : ''

  return (
    <li className="flex items-center gap-2 rounded-md px-1.5 py-1.5 transition hover:bg-ink-850/70">
      <Icon size={12} className={`shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10.5px] text-mo-700" title={file.path}>
          {directory && (
            <span className="text-mo-400">{directory}</span>
          )}
          {file.name}
        </p>
      </div>
      <span className="shrink-0 font-mono text-[8.5px] text-mo-400">
        {formatBytes(file.size)}
      </span>
    </li>
  )
}

function ReferenceRow({
  reference,
  locked,
  onRemove,
}: {
  reference: ReferenceItem
  locked: boolean
  onRemove: () => void
}) {
  return (
    <li
      className={`group flex items-center gap-2 rounded-md px-1.5 py-1.5 transition hover:bg-ink-850/70 ${
        reference.exists ? '' : 'opacity-70'
      }`}
    >
      <FileLock2
        size={12}
        className={`shrink-0 ${
          reference.exists ? 'text-dai-300/80' : 'text-yan-300/80'
        }`}
      />
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-[10.5px] text-mo-700"
          title={reference.sourcePath}
        >
          {reference.name}
        </p>
        <p className="flex items-center gap-1.5 font-mono text-[8.5px] text-mo-400">
          <span
            className={
              reference.exists ? 'text-dai-300/50' : 'text-yan-300/80'
            }
          >
            {reference.exists
              ? reference.mode === 'linked'
                ? '只读链接'
                : '已复制'
              : '源文件失效'}
          </span>
          <span>·</span>
          <span>{formatBytes(reference.size)}</span>
        </p>
      </div>
      <LockKeyhole size={9} className="shrink-0 text-mo-300" />
      <button
        type="button"
        onClick={onRemove}
        disabled={locked}
        className="icon-btn opacity-0 group-hover:opacity-100 disabled:opacity-0"
        title="移除引用（不会删除原文件）"
      >
        <Trash2 size={11} />
      </button>
    </li>
  )
}
