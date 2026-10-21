import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  WorkspaceCheckpoint,
  WorkspaceDiff,
} from '../shared/types'

const execFileAsync = promisify(execFile)
const MAX_DIFF_CHARS = 220_000

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'AUTO research',
  GIT_AUTHOR_EMAIL: 'auto@localhost',
  GIT_COMMITTER_NAME: 'AUTO research',
  GIT_COMMITTER_EMAIL: 'auto@localhost',
}

async function git(
  args: string[],
  cwd: string,
  allowFailure = false,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      env: GIT_ENV,
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    })
    return stdout.trim()
  } catch (error) {
    if (allowFailure) return ''
    throw error
  }
}

async function isGitWorkspace(cwd: string): Promise<boolean> {
  const result = await git(
    ['rev-parse', '--is-inside-work-tree'],
    cwd,
    true,
  )
  return result === 'true'
}

export async function createWorkspaceCheckpoint(
  workspace: string,
  runId: string,
): Promise<WorkspaceCheckpoint | null> {
  if (!(await isGitWorkspace(workspace))) return null

  const head = await git(['rev-parse', 'HEAD'], workspace, true)
  if (!head) return null

  let commit = head
  try {
    await git(
      ['add', '-A', '--ignore-errors', '--', '.'],
      workspace,
    )
    const stash = await git(
      ['stash', 'create', `auto pre-run ${runId}`],
      workspace,
      true,
    )
    if (stash) commit = stash
    const ref = `refs/auto/checkpoints/${runId}`
    await git(['update-ref', ref, commit], workspace)
    return {
      ref,
      commit,
      createdAt: new Date().toISOString(),
    }
  } finally {
    await git(['reset'], workspace, true).catch(() => '')
  }
}

export async function getWorkspaceDiff(
  workspace: string,
  checkpoint: WorkspaceCheckpoint,
): Promise<WorkspaceDiff> {
  if (!(await isGitWorkspace(workspace))) {
    throw Object.assign(new Error('工作区不是 git 仓库'), { statusCode: 400 })
  }

  const stat = await git(
    ['diff', '--stat', checkpoint.commit, '--', '.', ':(exclude).auto'],
    workspace,
    true,
  )
  const status = await git(
    ['status', '--short', '--untracked-files=all'],
    workspace,
    true,
  )
  let diff = await git(
    [
      'diff',
      '--no-color',
      '--unified=3',
      checkpoint.commit,
      '--',
      '.',
      ':(exclude).auto',
    ],
    workspace,
    true,
  )
  const truncated = diff.length > MAX_DIFF_CHARS
  if (truncated) diff = diff.slice(0, MAX_DIFF_CHARS)

  return {
    checkpoint,
    stat,
    diff,
    status,
    truncated,
  }
}

export async function restoreWorkspaceCheckpoint(
  workspace: string,
  checkpoint: WorkspaceCheckpoint,
): Promise<{ removed: string[] }> {
  if (!(await isGitWorkspace(workspace))) {
    throw Object.assign(new Error('工作区不是 git 仓库'), { statusCode: 400 })
  }

  const tree = new Set(
    (await git(
      ['ls-tree', '-r', '--name-only', checkpoint.commit],
      workspace,
    ))
      .split('\n')
      .filter(Boolean),
  )

  await git(
    ['checkout', checkpoint.commit, '--', '.', ':(exclude).auto'],
    workspace,
  )

  const untracked = (
    await git(
      ['ls-files', '--others', '--exclude-standard'],
      workspace,
      true,
    )
  )
    .split('\n')
    .filter(Boolean)

  const removed: string[] = []
  for (const relative of untracked) {
    if (relative === '.auto' || relative.startsWith('.auto/')) continue
    if (tree.has(relative)) continue
    try {
      await fs.rm(path.join(workspace, relative), {
        recursive: true,
        force: true,
      })
      removed.push(relative)
    } catch {
      // best-effort; report what was removed
    }
  }

  await git(['reset'], workspace, true)
  return { removed }
}
