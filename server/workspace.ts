import { constants, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { nanoid } from 'nanoid'
import type {
  FsEntry,
  FsListing,
  RecentWorkspace,
  ReferenceItem,
  WorkspaceFile,
  WorkspaceInfo,
  WorkspaceState,
} from '../shared/types'
import { DATA_DIR, DEFAULT_WORKSPACE, STATE_PATH } from './paths'

const AUTO_DIR = '.auto'
const REFS_DIR = '.auto/refs'
const LINKED_DIR = '.auto/refs/linked'
const UPLOAD_DIR = '.auto/refs/uploads'
const MAX_RECENT = 8
const MAX_WORKSPACE_FILES = 400

const IGNORED_DIRS = new Set([
  '.git',
  '.auto',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  '.cache',
  'coverage',
  '.idea',
  '.vscode',
  '.mypy_cache',
  '.pytest_cache',
])

export interface StoredThread {
  sessionId: string
  model: string
  turns: number
  lastUsedAt: string
  memory: string
}

interface StoredState {
  active: string
  recent: RecentWorkspace[]
  references: Record<string, ReferenceItem[]>
  threads: Record<string, StoredThread>
}

export const MAX_THREAD_TURNS = 8

let state: StoredState | null = null

function fail(message: string, status = 400): never {
  const error = new Error(message) as Error & { statusCode?: number }
  error.statusCode = status
  throw error
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    const stat = await fs.stat(target)
    return stat.isDirectory()
  } catch {
    return false
  }
}

async function persist(): Promise<void> {
  if (!state) return
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8')
}

function expandPath(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) fail('路径不能为空', 400)
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }
  return path.resolve(trimmed)
}

async function canonicalDirectory(raw: string): Promise<string> {
  const resolved = expandPath(raw)
  if (!(await exists(resolved))) fail('目录不存在', 404)
  const canonical = await fs.realpath(resolved)
  if (!(await isDirectory(canonical))) fail('该路径不是目录', 400)
  return canonical
}

async function workspaceInfo(target: string): Promise<WorkspaceInfo> {
  let writable = true
  try {
    await fs.access(target, constants.W_OK)
  } catch {
    writable = false
  }
  return {
    path: target,
    name: path.basename(target) || target,
    writable,
    isGit: await exists(path.join(target, '.git')),
  }
}

async function ensureGitExclude(workspace: string): Promise<void> {
  const gitDir = path.join(workspace, '.git')
  if (!(await isDirectory(gitDir))) return
  try {
    const infoDir = path.join(gitDir, 'info')
    await fs.mkdir(infoDir, { recursive: true })
    const excludePath = path.join(infoDir, 'exclude')
    let content = ''
    try {
      content = await fs.readFile(excludePath, 'utf8')
    } catch {
      content = ''
    }
    if (!content.split(/\r?\n/).includes('.auto/')) {
      const suffix = content.endsWith('\n') || content.length === 0 ? '' : '\n'
      await fs.writeFile(
        excludePath,
        `${content}${suffix}# AUTO research platform\n.auto/\n`,
        'utf8',
      )
    }
  } catch {
    // git metadata is best-effort
  }
}

async function ensureAutoDirs(workspace: string): Promise<void> {
  await fs.mkdir(path.join(workspace, LINKED_DIR), { recursive: true })
  await fs.mkdir(path.join(workspace, UPLOAD_DIR), { recursive: true })
  const ignorePath = path.join(workspace, AUTO_DIR, '.gitignore')
  try {
    await fs.writeFile(ignorePath, '*\n', 'utf8')
  } catch {
    // best-effort
  }
  await ensureGitExclude(workspace)
}

function activePath(): string {
  if (!state) throw new Error('workspace store not initialised')
  return state.active
}

export async function ensureWorkspaceStore(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.mkdir(DEFAULT_WORKSPACE, { recursive: true })

  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as StoredState
    if (!parsed.active || !Array.isArray(parsed.recent)) {
      throw new Error('invalid state')
    }
    state = {
      active: parsed.active,
      recent: parsed.recent.slice(0, MAX_RECENT),
      references: parsed.references ?? {},
      threads: parsed.threads ?? {},
    }
  } catch {
    state = {
      active: DEFAULT_WORKSPACE,
      recent: [],
      references: {},
      threads: {},
    }
  }

  if (!(await isDirectory(state.active))) {
    state.active = DEFAULT_WORKSPACE
  }

  await ensureAutoDirs(state.active)
  await persist()
}

function threadInfoFor(target: string): WorkspaceState['thread'] {
  const thread = state?.threads[target]
  return {
    active: Boolean(thread?.sessionId),
    turns: thread?.turns ?? 0,
    model: thread?.model ?? null,
    lastUsedAt: thread?.lastUsedAt ?? null,
    memoryChars: thread?.memory.length ?? 0,
  }
}

export function getBossThread(target = activePath()): StoredThread | null {
  return state?.threads[target] ?? null
}

export async function recordBossThread(
  target: string,
  data: { sessionId: string; model: string; memory: string },
): Promise<void> {
  if (!state) return
  const previous = state.threads[target]
  state.threads[target] = {
    sessionId: data.sessionId,
    model: data.model,
    turns:
      previous?.sessionId === data.sessionId ? previous.turns + 1 : 1,
    lastUsedAt: new Date().toISOString(),
    memory: data.memory || previous?.memory || '',
  }
  await persist()
}

export async function getWorkspaceState(): Promise<WorkspaceState> {
  const target = activePath()
  return {
    workspace: await workspaceInfo(target),
    recent: [...(state?.recent ?? [])],
    thread: threadInfoFor(target),
  }
}

export function getActiveWorkspacePath(): string {
  return activePath()
}

export async function openWorkspace(raw: string): Promise<WorkspaceState> {
  if (!state) throw new Error('workspace store not initialised')
  const canonical = await canonicalDirectory(raw)
  state.active = canonical

  const entry: RecentWorkspace = {
    path: canonical,
    name: path.basename(canonical) || canonical,
    lastOpened: new Date().toISOString(),
  }
  state.recent = [
    entry,
    ...state.recent.filter((item) => item.path !== canonical),
  ].slice(0, MAX_RECENT)

  await ensureAutoDirs(canonical)
  await persist()
  return getWorkspaceState()
}

export async function listWorkspaceFiles(): Promise<WorkspaceFile[]> {
  const root = activePath()
  const files: WorkspaceFile[] = []
  const queue: { abs: string; rel: string; depth: number }[] = [
    { abs: root, rel: '', depth: 0 },
  ]

  while (queue.length > 0 && files.length < MAX_WORKSPACE_FILES) {
    const current = queue.shift()
    if (!current) break

    let entries
    try {
      entries = await fs.readdir(current.abs, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (files.length >= MAX_WORKSPACE_FILES) break
      const rel = current.rel
        ? `${current.rel}/${entry.name}`
        : entry.name

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue
        }
        if (current.depth < 5) {
          queue.push({
            abs: path.join(current.abs, entry.name),
            rel,
            depth: current.depth + 1,
          })
        }
        continue
      }

      if (!entry.isFile()) continue
      if (IGNORED_DIRS.has(entry.name)) continue

      try {
        const stat = await fs.stat(path.join(current.abs, entry.name))
        files.push({
          path: rel,
          name: entry.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          ext: path.extname(entry.name).slice(1).toLowerCase(),
        })
      } catch {
        // unreadable files are skipped
      }
    }
  }

  return files.sort((a, b) => a.path.localeCompare(b.path))
}

function toPosix(relative: string): string {
  return relative.split(path.sep).join('/')
}

async function refreshReferences(): Promise<ReferenceItem[]> {
  if (!state) return []
  const refs = state.references[state.active] ?? []
  const items: ReferenceItem[] = []

  for (const ref of refs) {
    const materialized = path.join(state.active, ref.workspacePath)
    const checkPath = ref.mode === 'linked' ? ref.sourcePath : materialized
    const present = await exists(checkPath)
    let size = ref.size
    if (present) {
      try {
        size = (await fs.stat(checkPath)).size
      } catch {
        // keep the stored size
      }
    }
    items.push({ ...ref, size, exists: present })
  }

  return items
}

export async function listReferences(): Promise<ReferenceItem[]> {
  return refreshReferences()
}

async function syncLinkedReferences(): Promise<void> {
  if (!state) return
  const workspace = state.active
  const linkedDir = path.join(workspace, LINKED_DIR)
  await ensureAutoDirs(workspace)

  try {
    const entries = await fs.readdir(linkedDir, { withFileTypes: true })
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.isDirectory()) return
        try {
          await fs.unlink(path.join(linkedDir, entry.name))
        } catch {
          // stale links are best-effort
        }
      }),
    )
  } catch {
    // directory was just created
  }

  const refs = state.references[workspace] ?? []
  for (const ref of refs) {
    if (ref.mode !== 'linked') continue
    if (!(await exists(ref.sourcePath))) continue
    const target = path.join(workspace, ref.workspacePath)
    try {
      await fs.symlink(ref.sourcePath, target)
    } catch {
      // a bad link should not break the whole run
    }
  }
}

function safeFileName(raw: string): string {
  const base = path.basename(raw).normalize('NFC')
  const cleaned = base
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  if (!cleaned || cleaned === '.' || cleaned === '..') return `file-${nanoid(6)}`
  return cleaned
}

async function uniqueUploadName(name: string): Promise<string> {
  const workspace = activePath()
  const directory = path.join(workspace, UPLOAD_DIR)
  const parsed = path.parse(name)
  let candidate = name
  let index = 1
  for (;;) {
    if (!(await exists(path.join(directory, candidate)))) return candidate
    candidate = `${parsed.name} (${index})${parsed.ext}`
    index += 1
  }
}

export async function addLinkedReference(raw: string): Promise<ReferenceItem> {
  if (!state) throw new Error('workspace store not initialised')
  const resolved = expandPath(raw)
  if (!(await exists(resolved))) fail('文件不存在', 404)
  const canonical = await fs.realpath(resolved)
  const stat = await fs.stat(canonical)
  if (!stat.isFile()) fail('目前只支持引用单个文件', 400)

  const existing = state.references[state.active] ?? []
  if (existing.some((ref) => ref.mode === 'linked' && ref.sourcePath === canonical)) {
    fail('该文件已在外部引用中', 409)
  }

  const id = `ref_${nanoid(7)}`
  const ref: ReferenceItem = {
    id,
    name: path.basename(canonical),
    sourcePath: canonical,
    workspacePath: toPosix(
      path.join(LINKED_DIR, `${id}-${safeFileName(path.basename(canonical))}`),
    ),
    mode: 'linked',
    size: stat.size,
    addedAt: new Date().toISOString(),
    exists: true,
  }

  state.references[state.active] = [...existing, ref]
  await persist()
  await syncLinkedReferences()
  return ref
}

export async function addUploadedReference(
  rawName: string,
  buffer: Buffer,
): Promise<ReferenceItem> {
  if (!state) throw new Error('workspace store not initialised')
  const workspace = state.active
  const uploadDir = path.join(workspace, UPLOAD_DIR)
  await fs.mkdir(uploadDir, { recursive: true })

  const originalName = safeFileName(rawName)
  const storedName = await uniqueUploadName(originalName)
  const absolute = path.join(uploadDir, storedName)
  await fs.writeFile(absolute, buffer)

  const ref: ReferenceItem = {
    id: `ref_${nanoid(7)}`,
    name: originalName,
    sourcePath: absolute,
    workspacePath: toPosix(path.join(UPLOAD_DIR, storedName)),
    mode: 'uploaded',
    size: buffer.byteLength,
    addedAt: new Date().toISOString(),
    exists: true,
  }

  state.references[workspace] = [
    ...(state.references[workspace] ?? []),
    ref,
  ]
  await persist()
  return ref
}

export async function removeReference(id: string): Promise<boolean> {
  if (!state) return false
  const workspace = state.active
  const refs = state.references[workspace] ?? []
  const target = refs.find((ref) => ref.id === id)
  if (!target) return false

  const refsRoot = path.join(workspace, REFS_DIR)
  const materialized = path.join(workspace, target.workspacePath)
  const relative = path.relative(refsRoot, materialized)
  const inside =
    relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)

  if (inside) {
    try {
      await fs.unlink(materialized)
    } catch {
      // already gone
    }
  }

  state.references[workspace] = refs.filter((ref) => ref.id !== id)
  await persist()
  await syncLinkedReferences()
  return true
}

export async function prepareReferencesForRun(): Promise<ReferenceItem[]> {
  await syncLinkedReferences()
  return refreshReferences()
}

export async function listDirectory(raw?: string): Promise<FsListing> {
  const target = raw?.trim()
    ? await canonicalDirectory(raw)
    : await fs.realpath(os.homedir())

  const entries: FsEntry[] = []
  let dirents
  try {
    dirents = await fs.readdir(target, { withFileTypes: true })
  } catch {
    fail('无法读取该目录', 403)
  }

  for (const entry of dirents.slice(0, 400)) {
    const full = path.join(target, entry.name)
    let type: 'file' | 'directory' = entry.isDirectory() ? 'directory' : 'file'
    let size: number | undefined
    try {
      if (entry.isSymbolicLink()) {
        const stat = await fs.stat(full)
        type = stat.isDirectory() ? 'directory' : 'file'
        if (stat.isFile()) size = stat.size
      } else if (entry.isFile()) {
        size = (await fs.stat(full)).size
      }
    } catch {
      continue
    }
    entries.push({
      name: entry.name,
      path: full,
      type,
      size,
      ext: type === 'file' ? path.extname(entry.name).slice(1).toLowerCase() : undefined,
    })
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const parent = path.dirname(target)
  return {
    path: target,
    parent: parent === target ? null : parent,
    entries,
  }
}

export async function createDirectory(
  parentRaw: string,
  name: string,
): Promise<string> {
  const parent = await canonicalDirectory(parentRaw)
  const clean = name.trim().replace(/[\\/:*?"<>|]/g, '-')
  if (!clean || clean === '.' || clean === '..') fail('目录名无效', 400)
  const target = path.join(parent, clean)
  if (await exists(target)) fail('同名目录已存在', 409)
  await fs.mkdir(target)
  return target
}
