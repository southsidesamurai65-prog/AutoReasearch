import { useState } from 'react'
import {
  CornerDownLeft,
  History,
  Play,
  Plus,
  Sparkles,
  Square,
  Terminal,
  TriangleAlert,
} from 'lucide-react'
import type { RunMode, ThreadInfo, ThreadMode } from '../../shared/types'
import type { LiveStatus } from '../hooks/useRun'

const SAMPLES = [
  '阅读工作区资料，提炼三个值得做的研究方向并排序',
  '调研 LLM 辅助模糊测试提升代码覆盖率的方法，并给出困难场景下的性能优化方案',
  '检查当前工作区的实现，找出最影响可靠性的三个问题并给出修复方案',
]

interface PromptComposerProps {
  status: LiveStatus
  mode: RunMode
  threadMode: ThreadMode
  thread: ThreadInfo
  agentCount: number
  workspaceFileCount: number
  refCount: number
  harnessAvailable: boolean
  workspaceName: string
  error: string | null
  onModeChange: (mode: RunMode) => void
  onThreadModeChange: (mode: ThreadMode) => void
  onStart: (prompt: string) => void
  onCancel: () => void
}

export function PromptComposer({
  status,
  mode,
  threadMode,
  thread,
  agentCount,
  workspaceFileCount,
  refCount,
  harnessAvailable,
  workspaceName,
  error,
  onModeChange,
  onThreadModeChange,
  onStart,
  onCancel,
}: PromptComposerProps) {
  const [prompt, setPrompt] = useState('')
  const running = status === 'running'
  const starting = status === 'starting'
  const realReady = mode === 'mock' || harnessAvailable
  const canStart =
    prompt.trim().length > 0 && !running && !starting && realReady

  const submit = () => {
    if (canStart) onStart(prompt)
  }

  return (
    <section className="panel shrink-0">
      <div className="panel-head">
        <div className="panel-title">
          <Sparkles size={14} className="text-accent/80" />
          Prompt 输入区
        </div>
        <span className="panel-kicker">指令 → Boss Agent</span>
      </div>

      <div className="p-2.5">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
          placeholder={`告诉所长你想研究什么。工作区「${workspaceName}」会直接交给 harness…`}
          className="field scroll-thin min-h-[132px] max-h-[280px] resize-y bg-ink-950/60 text-[12.5px] leading-6"
          disabled={starting}
        />

        <div className="mt-2 flex flex-wrap gap-1">
          {SAMPLES.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => setPrompt(sample)}
              disabled={running || starting}
              className="max-w-full truncate rounded-full border border-line/80 bg-ink-850/70 px-2 py-1 text-[10px] text-mo-500 transition hover:border-mo-400 hover:text-mo-700 disabled:opacity-40"
            >
              {sample}
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-yan-500/20 bg-yan-500/5 px-2.5 py-2 text-[10.5px] leading-4 text-yan-300">
            <TriangleAlert size={12} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex shrink-0 rounded-md border border-line bg-ink-950/70 p-0.5">
              <ModeButton
                active={mode === 'real'}
                disabled={!harnessAvailable || running || starting}
                onClick={() => onModeChange('real')}
                icon={<Terminal size={9} />}
                label="真实"
                title={
                  harnessAvailable
                    ? '调用 opencode harness（--auto 自动批准工作区权限），使用当前工作区'
                    : '未检测到可用的 opencode harness'
                }
              />
              <ModeButton
                active={mode === 'mock'}
                disabled={running || starting}
                onClick={() => onModeChange('mock')}
                icon={<Sparkles size={9} />}
                label="Mock"
                title="使用模拟事件，不调用模型"
              />
            </div>
            {mode === 'real' && (
              <div className="flex shrink-0 rounded-md border border-line bg-ink-950/70 p-0.5">
                <ModeButton
                  active={threadMode === 'continue'}
                  disabled={running || starting}
                  onClick={() => onThreadModeChange('continue')}
                  icon={<History size={9} />}
                  label={
                    thread.active ? `续聊 ${thread.turns}` : '续聊'
                  }
                  title={
                    thread.active
                      ? `复用 Boss 会话（${thread.turns} 轮，${thread.model ?? '未知模型'}），可命中缓存`
                      : '暂无历史会话，本次会自动新开，并带入项目记忆'
                  }
                />
                <ModeButton
                  active={threadMode === 'new'}
                  disabled={running || starting}
                  onClick={() => onThreadModeChange('new')}
                  icon={<Plus size={9} />}
                  label="新开"
                  title={
                    thread.memoryChars > 0
                      ? '新开 Boss 线程，并带入项目记忆'
                      : '新开 Boss 线程'
                  }
                />
              </div>
            )}
          </div>

          {running ? (
            <button
              type="button"
              onClick={onCancel}
              className="btn btn-danger h-8 shrink-0 px-3 text-[11.5px]"
            >
              <Square size={10} fill="currentColor" />
              取消研究
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canStart}
              title={
                !harnessAvailable && mode === 'real'
                  ? 'opencode harness 不可用，请切换到 Mock 或检查安装'
                  : undefined
              }
              className="btn btn-primary h-8 shrink-0 px-3.5 text-[11.5px]"
            >
              <Play size={11} fill="currentColor" />
              {starting ? '启动中…' : '启动研究'}
            </button>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[8.5px] text-mo-300">
          <span className="truncate">
            {workspaceFileCount} 工作区 · {refCount} 引用 · {agentCount} 代理
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <CornerDownLeft size={9} /> Ctrl / ⌘ + Enter
          </span>
        </div>
      </div>
    </section>
  )
}

function ModeButton({
  active,
  disabled,
  onClick,
  icon,
  label,
  title,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[8.5px] transition disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? 'bg-accent/15 text-accent'
          : 'text-mo-400 hover:text-mo-600'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
