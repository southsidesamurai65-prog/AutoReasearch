import { useState } from 'react'
import {
  CheckCircle2,
  Gauge,
  Loader2,
  Save,
  ShieldCheck,
  Timer,
  TriangleAlert,
  Wifi,
} from 'lucide-react'
import type {
  AppSettings,
  SubagentSessionPolicy,
} from '../../shared/types'
import { api, type ModelTestResult, type SettingsPatch } from '../lib/api'
import { Modal } from './Modal'

interface SettingsDialogProps {
  settings: AppSettings
  bossModel: string
  onClose: () => void
  onSaved: (settings: AppSettings) => void
}

export function SettingsDialog({
  settings,
  bossModel,
  onClose,
  onSaved,
}: SettingsDialogProps) {
  const [draft, setDraft] = useState<AppSettings>(() => ({
    network: { ...settings.network },
    runtime: { ...settings.runtime },
  }))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<ModelTestResult | null>(null)

  const patch = (next: SettingsPatch) => {
    setDraft((previous) => ({
      network: { ...previous.network, ...next.network },
      runtime: { ...previous.runtime, ...next.runtime },
    }))
  }

  const save = async (): Promise<AppSettings> => {
    const saved = await api.updateSettings({
      network: draft.network,
      runtime: draft.runtime,
    })
    onSaved(saved)
    return saved
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await save()
      onClose()
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : '保存设置失败',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setError(null)
    setTestResult(null)
    try {
      await save()
      setTestResult(await api.testModel(bossModel))
    } catch (testError) {
      setError(
        testError instanceof Error ? testError.message : '模型测试失败',
      )
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal
      title="运行设置"
      subtitle="网络代理、超时与子代理会话策略"
      icon={<Gauge size={16} className="text-accent" />}
      onClose={onClose}
      wide
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={saving || testing}
            className="btn btn-ghost h-8 px-3 text-[11.5px]"
          >
            {testing ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <ShieldCheck size={11} />
            )}
            保存并测试 Boss 模型
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost h-8 px-3 text-[11.5px]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || testing}
              className="btn btn-primary h-8 px-3.5 text-[11.5px]"
            >
              {saving ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Save size={11} />
              )}
              保存设置
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Wifi size={14} className="text-accent/80" />
            <h3 className="text-[12.5px] font-semibold text-mo-900">
              网络代理
            </h3>
            <button
              type="button"
              role="switch"
              aria-checked={draft.network.enabled}
              onClick={() =>
                patch({ network: { enabled: !draft.network.enabled } })
              }
              className={`ml-auto relative h-5 w-9 rounded-full border transition ${
                draft.network.enabled
                  ? 'border-accent/50 bg-accent/25'
                  : 'border-line bg-ink-950'
              }`}
            >
              <span
                className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
                  draft.network.enabled
                    ? 'left-[18px] bg-accent'
                    : 'left-0.5 bg-mo-300'
                }`}
              />
            </button>
            <span className="w-8 font-mono text-[9px] text-mo-500">
              {draft.network.enabled ? 'ON' : 'OFF'}
            </span>
          </div>

          <p className="rounded-md border border-line/60 bg-ink-850/50 px-2.5 py-2 text-[10px] leading-4 text-mo-500">
            代理只作用于 opencode 子进程；`NO_PROXY` 必须保留本机地址。
            代理密码会随本地配置文件保存，不会出现在运行日志里。
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="HTTP_PROXY">
              <input
                value={draft.network.httpProxy}
                onChange={(event) =>
                  patch({ network: { httpProxy: event.target.value } })
                }
                placeholder="http://127.0.0.1:7890"
                className="field font-mono"
                disabled={!draft.network.enabled}
              />
            </Field>
            <Field label="HTTPS_PROXY">
              <input
                value={draft.network.httpsProxy}
                onChange={(event) =>
                  patch({ network: { httpsProxy: event.target.value } })
                }
                placeholder="http://127.0.0.1:7890"
                className="field font-mono"
                disabled={!draft.network.enabled}
              />
            </Field>
            <Field label="NO_PROXY">
              <input
                value={draft.network.noProxy}
                onChange={(event) =>
                  patch({ network: { noProxy: event.target.value } })
                }
                placeholder="localhost,127.0.0.1,::1"
                className="field font-mono"
                disabled={!draft.network.enabled}
              />
            </Field>
            <Field label="自定义 CA 证书路径（可选）">
              <input
                value={draft.network.caCertPath}
                onChange={(event) =>
                  patch({ network: { caCertPath: event.target.value } })
                }
                placeholder="/path/to/ca.pem"
                className="field font-mono"
                disabled={!draft.network.enabled}
              />
            </Field>
          </div>
        </section>

        <section className="space-y-3 border-t border-line/60 pt-4">
          <div className="flex items-center gap-2">
            <Timer size={14} className="text-accent/80" />
            <h3 className="text-[12.5px] font-semibold text-mo-900">
              运行限制
            </h3>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="单次调用超时（分钟）">
              <input
                type="number"
                min={1}
                max={180}
                value={draft.runtime.runTimeoutMinutes}
                onChange={(event) =>
                  patch({
                    runtime: {
                      runTimeoutMinutes:
                        Number(event.target.value) ||
                        draft.runtime.runTimeoutMinutes,
                    },
                  })
                }
                className="field"
              />
            </Field>
            <Field label="子代理会话">
              <select
                value={draft.runtime.subagentSessionPolicy}
                onChange={(event) =>
                  patch({
                    runtime: {
                      subagentSessionPolicy: event.target
                        .value as SubagentSessionPolicy,
                    },
                  })
                }
                className="field"
              >
                <option value="delete">完成后清理（推荐）</option>
                <option value="keep">保留会话</option>
              </select>
            </Field>
          </div>

          <p className="text-[10px] leading-4 text-mo-400">
            子代理的 `maxTurns` 和 `budgetUsd` 已在 harness 层强制生效；
            当前 Boss 模型：<span className="font-mono text-mo-600">{bossModel}</span>
          </p>
        </section>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-yan-500/25 bg-yan-500/5 px-2.5 py-2 text-[10.5px] leading-4 text-yan-300">
            <TriangleAlert size={12} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {testResult && (
          <div
            className={`rounded-md border px-2.5 py-2 text-[10.5px] leading-4 ${
              testResult.ok
                ? 'border-song-400/25 bg-song-400/5 text-song-300'
                : 'border-yan-500/25 bg-yan-500/5 text-yan-300'
            }`}
          >
            <p className="flex items-center gap-1.5 font-medium">
              {testResult.ok ? (
                <CheckCircle2 size={12} />
              ) : (
                <TriangleAlert size={12} />
              )}
              {testResult.ok ? '模型连通' : '模型不可用'} ·{' '}
              {testResult.latencyMs.toLocaleString('zh-CN')}ms ·{' '}
              {testResult.tokens} tok · ${testResult.costUsd.toFixed(6)}
            </p>
            <p className="mt-1 break-words font-mono text-[10px] opacity-80">
              {testResult.error || testResult.text || '(空响应)'}
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  )
}
