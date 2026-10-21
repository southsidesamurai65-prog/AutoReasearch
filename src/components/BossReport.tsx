import { useEffect, useRef, useState } from 'react'
import { MessageSquareText, Radio } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { LiveStatus } from '../hooks/useRun'

interface BossReportProps {
  report: string
  status: LiveStatus
}

export function BossReport({ report, status }: BossReportProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)
  const running = status === 'running' || status === 'starting'

  useEffect(() => {
    if (stick && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [report, stick])

  const handleScroll = () => {
    const element = bodyRef.current
    if (!element) return
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight
    setStick(distance < 64)
  }

  return (
    <section className="panel h-[clamp(430px,58vh,760px)] shrink-0">
      <div className="panel-head">
        <div className="panel-title">
          <MessageSquareText size={14} className="text-mo-600" />
          Boss 汇报
          {running && (
            <span className="flex items-center gap-1 font-mono text-[9px] text-accent/80">
              <span className="h-1 w-1 animate-pulse-soft rounded-full bg-accent" />
              STREAM
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 font-mono text-[9px] text-mo-400">
          <Radio size={9} />
          {report.length > 0
            ? `${report.length.toLocaleString('zh-CN')} chars`
            : '等待指令'}
        </div>
      </div>

      <div
        ref={bodyRef}
        onScroll={handleScroll}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3.5 py-3"
      >
        {report ? (
          <>
            <div className="md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {report}
              </ReactMarkdown>
            </div>
            {running && (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-blink rounded-sm bg-accent/80 align-middle" />
            )}
          </>
        ) : running ? (
          <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-3">
            <div className="flex gap-1.5">
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent/70"
                  style={{ animationDelay: `${index * 160}ms` }}
                />
              ))}
            </div>
            <p className="text-[11px] text-mo-500">
              Boss Agent 正在阅读目标与文件…
            </p>
          </div>
        ) : (
          <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-line/70 bg-ink-850/60">
              <MessageSquareText size={15} className="text-mo-400" />
            </div>
            <p className="text-[11px] text-mo-500">所长还没有开始工作</p>
            <p className="max-w-[300px] text-[10px] leading-4 text-mo-400">
              在左侧写下研究目标后启动。这里会实时显示 Boss 的拆解思路、阶段结论与最终汇报。
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
