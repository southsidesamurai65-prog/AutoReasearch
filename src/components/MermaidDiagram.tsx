import { useEffect, useId, useState } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
import mermaid from 'mermaid'

let initialised = false

function ensureInitialised() {
  if (initialised) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'loose',
    fontFamily:
      '"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif',
    themeVariables: {
      background: '#f7f2e3',
      primaryColor: '#ece3cd',
      primaryTextColor: '#2b2617',
      primaryBorderColor: '#8a7a5f',
      lineColor: '#6d6349',
      secondaryColor: '#f2ebd8',
      tertiaryColor: '#e8dfc9',
      fontSize: '13px',
    },
    flowchart: {
      curve: 'basis',
      padding: 10,
      nodeSpacing: 26,
      rankSpacing: 34,
      htmlLabels: true,
    },
  })
  initialised = true
}

export function MermaidDiagram({ chart }: { chart: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ensureInitialised()
    setSvg('')
    setError(null)

    mermaid
      .render(`mermaid-${id}-${Date.now()}`, chart)
      .then((result) => {
        if (!cancelled) setSvg(result.svg)
      })
      .catch((renderError: unknown) => {
        if (!cancelled) {
          setError(
            renderError instanceof Error
              ? renderError.message
              : '图表渲染失败',
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [chart, id])

  if (error) {
    return (
      <div className="rounded-lg border border-ni-500/20 bg-ni-500/5 p-2.5">
        <p className="mb-1.5 flex items-center gap-1 text-[10px] text-ni-300">
          <TriangleAlert size={10} /> 图表渲染失败，已保留源码
        </p>
        <pre className="scroll-thin overflow-x-auto font-mono text-[9.5px] leading-4 text-mo-500">
          {chart}
        </pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 rounded-lg border border-line/60 bg-ink-950/40 text-[10.5px] text-mo-500">
        <Loader2 size={13} className="animate-spin" />
        正在绘制架构图…
      </div>
    )
  }

  return (
    <div
      className="mermaid-wrap scroll-thin overflow-x-auto rounded-lg border border-line/60 bg-ink-950/50 p-2.5"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
