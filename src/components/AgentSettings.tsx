import { useEffect, useState } from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  KeyRound,
  Loader2,
  Plus,
  Save,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import type {
  HarnessKind,
  HarnessStatus,
  PublicAgentConfig,
} from '../../shared/types'
import { ALL_PRESETS, HARNESS_LABELS, ROLE_LABELS } from '../../shared/presets'
import type { AgentPatch } from '../lib/api'

interface AgentSettingsProps {
  agents: PublicAgentConfig[]
  harness: HarnessStatus | null
  onAdd: (presetId?: string) => Promise<void>
  onSave: (id: string, patch: AgentPatch) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export function AgentSettings({
  agents,
  harness,
  onAdd,
  onSave,
  onDelete,
}: AgentSettingsProps) {
  const [showAdd, setShowAdd] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const add = async (presetId?: string) => {
    setAdding(presetId ?? 'custom')
    setError(null)
    try {
      await onAdd(presetId)
      setShowAdd(false)
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : '添加失败')
    } finally {
      setAdding(null)
    }
  }

  return (
    <section className="panel min-h-[460px] flex-1 lg:min-h-[520px]">
      <div className="panel-head">
        <div className="panel-title">
          <Users size={14} className="text-mo-600" />
          子代理编排
          <span className="chip">{agents.length}</span>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd((value) => !value)}
          className="flex items-center gap-1 rounded-md border border-line bg-ink-800/60 px-2 py-1 text-[10.5px] text-mo-600 transition hover:border-accent/40 hover:text-accent"
        >
          {showAdd ? <X size={10} /> : <Plus size={10} />}
          {showAdd ? '收起' : '添加'}
        </button>
      </div>

      {showAdd && (
        <div className="animate-rise border-b border-line/70 bg-ink-950/50 px-2 py-2">
          <p className="panel-kicker mb-1.5 px-1">选择角色模板</p>
          <div className="scroll-thin max-h-52 space-y-1 overflow-y-auto pr-1">
            {ALL_PRESETS.filter((preset) => preset.role !== 'boss').map(
              (preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => void add(preset.id)}
                  disabled={adding !== null}
                  className="flex w-full items-center gap-2 rounded-md border border-transparent px-1.5 py-1.5 text-left transition hover:border-line hover:bg-ink-850/80 disabled:opacity-50"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: preset.color }}
                  />
                  <span className="text-[11.5px] text-mo-800">
                    {preset.name}
                  </span>
                  <span className="chip">
                    {ROLE_LABELS[preset.role]}
                  </span>
                  <span className="ml-auto truncate font-mono text-[9px] text-mo-400">
                    {adding === preset.id ? '添加中…' : HARNESS_LABELS[preset.harness]}
                  </span>
                </button>
              ),
            )}
            <button
              type="button"
              onClick={() => void add(undefined)}
              disabled={adding !== null}
              className="flex w-full items-center gap-2 rounded-md border border-dashed border-line px-1.5 py-1.5 text-[11px] text-mo-500 transition hover:border-accent/40 hover:text-mo-700 disabled:opacity-50"
            >
              <Plus size={11} />
              {adding === 'custom' ? '添加中…' : '空白自定义 Agent'}
            </button>
          </div>
          {error && (
            <p className="mt-1 px-1 text-[10px] text-yan-300">{error}</p>
          )}
        </div>
      )}

      <div className="scroll-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            harness={harness}
            onSave={onSave}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  )
}

interface Draft {
  name: string
  description: string
  harness: HarnessKind
  model: string
  baseUrl: string
  maxTurns: string
  budgetUsd: string
  systemPrompt: string
}

function toDraft(agent: PublicAgentConfig): Draft {
  return {
    name: agent.name,
    description: agent.description,
    harness: agent.harness,
    model: agent.model,
    baseUrl: agent.baseUrl,
    maxTurns: String(agent.maxTurns),
    budgetUsd: String(agent.budgetUsd),
    systemPrompt: agent.systemPrompt,
  }
}

function harnessHint(
  harness: HarnessKind,
  status: HarnessStatus | null,
): string {
  switch (harness) {
    case 'opencode':
      return '使用本机 opencode 与登录态；模型填 provider/model。'
    case 'claude-code': {
      const runtime = status?.runtimes?.['claude-code']
      return runtime?.available
        ? `Claude Code ${runtime.version ?? ''} 已就绪；模型可填 haiku / sonnet / 完整模型名。`
        : `未检测到可用的 Claude Code${runtime?.error ? `：${runtime.error}` : '，请先安装并登录 claude'}。`
    }
    case 'codex': {
      const runtime = status?.runtimes?.codex
      return runtime?.available
        ? `Codex ${runtime.version ?? ''} 已就绪；模型可留空使用 CLI 默认，或填 gpt-5.x。Codex 不支持费用硬上限，预算仅作统计。`
        : `未检测到可用的 Codex${runtime?.error ? `：${runtime.error}` : '，请先安装并登录 codex'}。`
    }
    case 'openai-compatible':
      return '直连 OpenAI 兼容 API 暂未接入，请使用 opencode、Claude Code 或 Codex。'
  }
}

function AgentCard({
  agent,
  harness,
  onSave,
  onDelete,
}: {
  agent: PublicAgentConfig
  harness: HarnessStatus | null
  onSave: (id: string, patch: AgentPatch) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => toDraft(agent))
  const [apiKey, setApiKey] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!dirty) {
      setDraft(toDraft(agent))
      setApiKey('')
    }
  }, [agent, dirty])

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }))
    setDirty(true)
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    const patch: AgentPatch = {
      name: draft.name.trim() || agent.name,
      description: draft.description,
      harness: draft.harness,
      model: draft.model.trim(),
      baseUrl: draft.baseUrl.trim(),
      systemPrompt: draft.systemPrompt,
      maxTurns: Math.max(1, Math.round(Number(draft.maxTurns) || agent.maxTurns)),
      budgetUsd: Math.max(0, Number(draft.budgetUsd) || 0),
    }
    if (apiKey.trim()) patch.apiKey = apiKey.trim()

    try {
      await onSave(agent.id, patch)
      setDirty(false)
      setSaved(true)
      setApiKey('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async () => {
    setError(null)
    try {
      await onSave(agent.id, { enabled: !agent.enabled })
      setSaved(true)
    } catch (toggleError) {
      setError(
        toggleError instanceof Error ? toggleError.message : '切换失败',
      )
    }
  }

  const clearKey = async () => {
    setError(null)
    try {
      await onSave(agent.id, { clearKey: true })
      setApiKey('')
      setSaved(true)
    } catch (clearError) {
      setError(
        clearError instanceof Error ? clearError.message : '清除失败',
      )
    }
  }

  const remove = async () => {
    if (!window.confirm(`确定删除「${agent.name}」吗？`)) return
    try {
      await onDelete(agent.id)
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : '删除失败',
      )
    }
  }

  const badgeStyle = {
    color: agent.color,
    borderColor: `${agent.color}44`,
    backgroundColor: `${agent.color}12`,
  }

  return (
    <article
      className={`rounded-lg border bg-ink-850/60 transition ${
        open ? 'border-line' : 'border-line/50 hover:border-line'
      } ${agent.enabled ? '' : 'opacity-60'}`}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{
              background: agent.color,
              boxShadow: `0 0 0 2.5px ${agent.color}22, 0 1px 2px -1px ${agent.color}88`,
            }}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[11.5px] font-medium text-mo-900">
                {agent.name}
              </span>
              <span
                className="shrink-0 rounded border px-1 py-px font-mono text-[8.5px]"
                style={badgeStyle}
              >
                {ROLE_LABELS[agent.role]}
              </span>
            </span>
            <span className="mt-0.5 block truncate font-mono text-[9px] text-mo-400">
              {HARNESS_LABELS[agent.harness]} ·{' '}
              {agent.model ||
                (agent.harness === 'opencode' ? '未设模型' : 'CLI 默认')}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => void toggle()}
          role="switch"
          aria-checked={agent.enabled}
          title={agent.enabled ? '停用该代理' : '启用该代理'}
          className={`relative h-4 w-7 shrink-0 rounded-full border transition ${
            agent.enabled
              ? 'border-accent/50 bg-accent/25'
              : 'border-line bg-ink-950'
          }`}
        >
          <span
            className={`absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all ${
              agent.enabled
                ? 'left-3 bg-accent'
                : 'left-0.5 bg-mo-300'
            }`}
          />
        </button>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="icon-btn"
        >
          <ChevronDown
            size={12}
            className={`transition ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {open && (
        <div className="animate-rise space-y-2 border-t border-line/60 px-2.5 pb-2.5 pt-2">
          <div>
            <label className="label">名称</label>
            <input
              value={draft.name}
              onChange={(event) => update('name', event.target.value)}
              className="field"
            />
          </div>

          <div className="grid grid-cols-[1.1fr_1fr] gap-1.5">
            <div>
              <label className="label">Harness</label>
              <select
                value={draft.harness}
                onChange={(event) =>
                  update('harness', event.target.value as HarnessKind)
                }
                className="field"
              >
                {(Object.keys(HARNESS_LABELS) as HarnessKind[]).map((key) => {
                  const runtime = harness?.runtimes?.[key]
                  const unavailable =
                    key === 'openai-compatible' ||
                    runtime?.available === false
                  return (
                    <option key={key} value={key} disabled={unavailable}>
                      {HARNESS_LABELS[key]}
                      {unavailable ? '（不可用）' : ''}
                    </option>
                  )
                })}
              </select>
            </div>
            <div>
              <label className="label">模型</label>
              <input
                value={draft.model}
                onChange={(event) => update('model', event.target.value)}
                className="field font-mono text-[11px]"
                placeholder={
                  draft.harness === 'opencode'
                    ? 'provider/model'
                    : draft.harness === 'claude-code'
                      ? 'haiku / sonnet / 完整模型名，留空用默认'
                      : 'gpt-5.x，留空用 CLI 默认'
                }
              />
            </div>
          </div>

          <p
            className={`text-[9.5px] leading-4 ${
              draft.harness === 'opencode'
                ? 'text-mo-400'
                : 'text-ni-300/70'
            }`}
          >
            {harnessHint(draft.harness, harness)}
          </p>

          <div>
            <label className="label">Base URL（预留）</label>
            <input
              value={draft.baseUrl}
              onChange={(event) => update('baseUrl', event.target.value)}
              className="field font-mono text-[11px]"
              placeholder="https://api.example.com/v1"
            />
          </div>

          <div>
            <label className="label flex items-center justify-between">
              <span className="flex items-center gap-1">
                <KeyRound size={10} /> API Key（预留）
              </span>
              {agent.hasKey && (
                <span className="font-mono text-[9px] text-song-300">
                  已保存
                </span>
              )}
            </label>
            <div className="flex gap-1.5">
              <input
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value)
                  setSaved(false)
                }}
                className="field font-mono text-[11px]"
                placeholder={
                  agent.hasKey ? '••••••••（留空不修改）' : 'sk-...'
                }
                autoComplete="off"
              />
              {agent.hasKey && (
                <button
                  type="button"
                  onClick={() => void clearKey()}
                  className="btn btn-ghost h-[30px] shrink-0 px-2 text-[9.5px]"
                >
                  清除
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="label">额外提示词</label>
            <textarea
              value={draft.systemPrompt}
              onChange={(event) => update('systemPrompt', event.target.value)}
              className="field scroll-thin min-h-[76px] resize-y text-[11px] leading-5"
              placeholder="这个代理的职责、边界、输出格式…"
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="label">最大轮次</label>
              <input
                type="number"
                min={1}
                max={200}
                value={draft.maxTurns}
                onChange={(event) => update('maxTurns', event.target.value)}
                className="field font-mono"
              />
            </div>
            <div>
              <label className="label">预算上限 (USD)</label>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={draft.budgetUsd}
                onChange={(event) => update('budgetUsd', event.target.value)}
                className="field font-mono"
              />
            </div>
          </div>

          {error && (
            <p className="rounded border border-yan-500/20 bg-yan-500/5 px-2 py-1 text-[10px] text-yan-300">
              {error}
            </p>
          )}

          <div className="flex items-center gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || (!dirty && !apiKey.trim())}
              className="btn btn-primary h-7 flex-1 px-2 text-[10.5px]"
            >
              {saving ? (
                <Loader2 size={10} className="animate-spin" />
              ) : saved && !dirty ? (
                <Check size={10} />
              ) : (
                <Save size={10} />
              )}
              {saving ? '保存中…' : saved && !dirty ? '已保存' : '保存配置'}
            </button>
            {agent.role !== 'boss' && (
              <button
                type="button"
                onClick={() => void remove()}
                className="btn btn-danger h-7 px-2 text-[10.5px]"
                title="删除代理"
              >
                <Trash2 size={10} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 font-mono text-[8.5px] text-mo-300">
            <Bot size={8} />
            {agent.id} · {agent.enabled ? 'ENABLED' : 'DISABLED'} ·{' '}
            {agent.maxTurns}T
          </div>
        </div>
      )}
    </article>
  )
}
