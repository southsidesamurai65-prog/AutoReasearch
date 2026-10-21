import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { RunSnapshot, RunSummary } from '../shared/types'
import { RUNS_DIR } from './paths'

const MAX_HISTORY_RUNS = 200

const history = new Map<string, RunSnapshot>()

function cloneSnapshot(snapshot: RunSnapshot): RunSnapshot {
  return {
    ...snapshot,
    calls: snapshot.calls.map((call) => ({ ...call })),
    events: [],
  }
}

export function summarizeRun(snapshot: RunSnapshot): RunSummary {
  const tokens = snapshot.calls.reduce(
    (sum, call) => sum + (call.tokens ?? 0),
    0,
  )
  const costUsd = snapshot.calls.reduce(
    (sum, call) => sum + (call.costUsd ?? 0),
    0,
  )
  return {
    id: snapshot.id,
    prompt: snapshot.prompt,
    mode: snapshot.mode,
    workspace: snapshot.workspace,
    threadMode: snapshot.threadMode,
    status: snapshot.status,
    startedAt: snapshot.startedAt,
    endedAt: snapshot.endedAt,
    summary: snapshot.summary,
    tokens,
    costUsd: Number(costUsd.toFixed(6)),
    callCount: snapshot.calls.length,
    checkpoint: snapshot.checkpoint,
  }
}

async function pruneHistory(): Promise<void> {
  let entries: string[]
  try {
    entries = await fs.readdir(RUNS_DIR)
  } catch {
    return
  }

  const files = entries.filter((name) => name.endsWith('.json'))
  if (files.length <= MAX_HISTORY_RUNS) return

  const stats = await Promise.all(
    files.map(async (name) => {
      const file = path.join(RUNS_DIR, name)
      try {
        const stat = await fs.stat(file)
        return { file, mtime: stat.mtimeMs }
      } catch {
        return { file, mtime: 0 }
      }
    }),
  )
  stats.sort((a, b) => b.mtime - a.mtime)
  const keep = new Set(
    stats
      .slice(0, MAX_HISTORY_RUNS)
      .map((item) => path.basename(item.file, '.json')),
  )

  for (const id of history.keys()) {
    if (!keep.has(id)) history.delete(id)
  }

  for (const item of stats.slice(MAX_HISTORY_RUNS)) {
    try {
      await fs.unlink(item.file)
    } catch {
      // best effort
    }
  }
}

export async function loadRunHistory(): Promise<void> {
  await fs.mkdir(RUNS_DIR, { recursive: true })
  let entries: string[]
  try {
    entries = await fs.readdir(RUNS_DIR)
  } catch {
    return
  }

  history.clear()
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    try {
      const raw = await fs.readFile(path.join(RUNS_DIR, name), 'utf8')
      const snapshot = JSON.parse(raw) as RunSnapshot
      if (!snapshot?.id || !Array.isArray(snapshot.calls)) continue
      history.set(snapshot.id, snapshot)
    } catch {
      // a corrupt history file must not break startup
    }
  }

  await pruneHistory()
}

export async function saveRunHistory(snapshot: RunSnapshot): Promise<void> {
  const stored = cloneSnapshot(snapshot)
  history.set(stored.id, stored)
  await fs.mkdir(RUNS_DIR, { recursive: true })
  const file = path.join(RUNS_DIR, `${stored.id}.json`)
  const temp = `${file}.tmp`
  await fs.writeFile(temp, JSON.stringify(stored, null, 2), 'utf8')
  await fs.rename(temp, file)
  await pruneHistory()
}

export function getHistoricalRun(id: string): RunSnapshot | undefined {
  const snapshot = history.get(id)
  return snapshot ? cloneSnapshot(snapshot) : undefined
}

export function listHistoricalRuns(): RunSummary[] {
  return [...history.values()]
    .map(summarizeRun)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export async function deleteHistoricalRun(id: string): Promise<boolean> {
  const existed = history.delete(id)
  try {
    await fs.unlink(path.join(RUNS_DIR, `${id}.json`))
  } catch {
    // already removed
  }
  return existed
}
