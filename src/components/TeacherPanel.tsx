import { useEffect, useRef } from 'react'
import {
  BookOpen,
  GraduationCap,
  Lightbulb,
  Workflow,
} from 'lucide-react'
import type { TeacherBrief } from '../../shared/types'
import type { LiveStatus } from '../hooks/useRun'
import { MermaidDiagram } from './MermaidDiagram'

interface TeacherPanelProps {
  brief: TeacherBrief | null
  status: LiveStatus
  hasTeacher: boolean
}

export function TeacherPanel({
  brief,
  status,
  hasTeacher,
}: TeacherPanelProps) {
  const running = status === 'running' || status === 'starting'
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [brief?.title])

  return (
    <section className="panel h-[clamp(500px,66vh,860px)] shrink-0">
      <div className="panel-head">
        <div className="panel-title">
          <GraduationCap size={14} className="text-fen-300" />
          教师 Agent
          <span className="chip border-fen-400/20 text-fen-300/80">
            零基础图解
          </span>
        </div>
        <span className="panel-kicker">
          {brief ? '讲义已备' : running ? '正在备课' : '自动讲义'}
        </span>
      </div>

      <div
        ref={bodyRef}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3.5 py-3"
      >
        {brief ? (
          <div className="space-y-3.5">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-mo-950">
                {brief.title}
              </h2>
              <p className="mt-1 text-[11.5px] leading-5 text-mo-600">
                {brief.intro}
              </p>
            </div>

            <div>
              <p className="mb-1.5 flex items-center gap-1.5 font-kai text-[10px] tracking-[0.3em] text-mo-500">
                <Workflow size={10} /> 一张图看懂
              </p>
              <MermaidDiagram chart={brief.mermaid} />
            </div>

            <div className="space-y-3">
              {brief.sections.map((section, index) => (
                <div key={section.heading} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line bg-ink-850 font-mono text-[9px] text-mo-500">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[12px] font-semibold text-mo-900">
                      {section.heading}
                    </h3>
                    <p className="mt-0.5 text-[11px] leading-[1.75] text-mo-600">
                      {section.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-line/60 bg-ink-850/40 p-2.5">
              <p className="mb-2 flex items-center gap-1.5 font-kai text-[10px] tracking-[0.3em] text-mo-500">
                <BookOpen size={10} /> 术语小抄
              </p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {brief.glossary.map((item) => (
                  <div
                    key={item.term}
                    className="rounded-md border border-line/50 bg-ink-950/40 px-2 py-1.5"
                  >
                    <p className="font-mono text-[9.5px] text-accent/80">
                      {item.term}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-4 text-mo-500">
                      {item.meaning}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : running ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-fen-400/15 bg-fen-400/[0.04] px-2.5 py-2">
              <Lightbulb size={13} className="text-fen-300" />
              <p className="text-[10.5px] text-fen-200/80">
                教师 Agent 正在把架构翻译成人话…
              </p>
            </div>
            <div className="animate-pulse-soft space-y-2">
              <div className="h-3 w-2/3 rounded bg-ink-700/70" />
              <div className="h-3 w-full rounded bg-ink-700/50" />
              <div className="h-24 w-full rounded-lg border border-line/50 bg-ink-850/50" />
              <div className="h-3 w-5/6 rounded bg-ink-700/40" />
              <div className="h-3 w-3/4 rounded bg-ink-700/30" />
            </div>
          </div>
        ) : status === 'done' && !hasTeacher ? (
          <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-2 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-line/70 bg-ink-850/60">
              <GraduationCap size={15} className="text-mo-400" />
            </div>
            <p className="text-[11px] text-mo-500">教师 Agent 未启用</p>
            <p className="max-w-[290px] text-[10px] leading-4 text-mo-400">
              在左侧「子代理编排」里开启教师 Agent，下一次研究就会自动生成架构图与通俗讲解。
            </p>
          </div>
        ) : (
          <div className="flex h-full min-h-[150px] flex-col items-center justify-center gap-2 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-line/70 bg-ink-850/60">
              <GraduationCap size={15} className="text-mo-400" />
            </div>
            <p className="text-[11px] text-mo-500">完成一次研究后，我来给你讲</p>
            <p className="max-w-[300px] text-[10px] leading-4 text-mo-400">
              这里会生成一张项目架构图，用比喻和日常语言解释每个 Agent 在干什么、信息怎么流动、为什么这样设计。
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
