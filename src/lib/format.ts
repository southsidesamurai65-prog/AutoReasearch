import type { CallNode } from '../../shared/types'

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`
  return `${(tokens / 1000).toFixed(1)}k`
}

export function formatCost(cost: number): string {
  if (cost === 0) return '$0'
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toFixed(2)}`
}

export function formatDuration(call: CallNode): string {
  if (call.status === 'running') return '进行中'
  if (call.status === 'queued') return '排队'
  if (!call.startedAt) return '—'
  const end = call.endedAt ? Date.parse(call.endedAt) : Date.now()
  const start = Date.parse(call.startedAt)
  const seconds = Math.max(0, (end - start) / 1000)
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
  return `${seconds.toFixed(1)}s`
}

export function fileKind(ext: string): 'code' | 'text' | 'image' | 'data' {
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
  if (['json', 'csv', 'tsv', 'yaml', 'yml', 'toml', 'xml'].includes(ext)) {
    return 'data'
  }
  if (
    [
      'ts',
      'tsx',
      'js',
      'jsx',
      'py',
      'rs',
      'go',
      'c',
      'cc',
      'cpp',
      'h',
      'java',
      'sh',
      'sql',
      'css',
      'html',
    ].includes(ext)
  ) {
    return 'code'
  }
  return 'text'
}
