import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CallNode,
  RunEvent,
  RunMode,
  RunStatus,
  TeacherBrief,
  ThreadMode,
} from '../../shared/types'
import { api } from '../lib/api'

export type LiveStatus = 'idle' | 'starting' | RunStatus

export interface RunState {
  status: LiveStatus
  runId: string | null
  prompt: string
  files: string[]
  mode: RunMode | null
  workspace?: string
  calls: CallNode[]
  report: string
  teacher: TeacherBrief | null
  startedAt?: string
  endedAt?: string
  summary?: string
  error: string | null
}

const idleState: RunState = {
  status: 'idle',
  runId: null,
  prompt: '',
  files: [],
  mode: null,
  calls: [],
  report: '',
  teacher: null,
  error: null,
}

export function useRun() {
  const [state, setState] = useState<RunState>(idleState)
  const sourceRef = useRef<EventSource | null>(null)

  const closeSource = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
  }, [])

  useEffect(() => closeSource, [closeSource])

  const applyEvent = useCallback((event: RunEvent) => {
    setState((previous) => {
      switch (event.type) {
        case 'run.started':
          return {
            ...previous,
            status: 'running',
            prompt: event.prompt,
            files: event.files,
            mode: event.mode,
            workspace: event.workspace,
            startedAt: event.at,
          }
        case 'boss.delta':
          return { ...previous, report: previous.report + event.text }
        case 'call.started': {
          if (previous.calls.some((call) => call.id === event.call.id)) {
            return previous
          }
          return { ...previous, calls: [...previous.calls, event.call] }
        }
        case 'call.updated':
          return {
            ...previous,
            calls: previous.calls.map((call) =>
              call.id === event.id ? { ...call, ...event.patch } : call,
            ),
          }
        case 'call.delta':
          return {
            ...previous,
            calls: previous.calls.map((call) =>
              call.id === event.id
                ? { ...call, output: `${call.output ?? ''}${event.text}` }
                : call,
            ),
          }
        case 'teacher.ready':
          return { ...previous, teacher: event.brief }
        case 'run.finished':
          return {
            ...previous,
            status: event.status,
            endedAt: event.at,
            summary: event.summary,
          }
        default:
          return previous
      }
    })
  }, [])

  const start = useCallback(
    async (prompt: string, mode: RunMode, threadMode: ThreadMode) => {
      const trimmed = prompt.trim()
      if (!trimmed) return

      closeSource()
      setState({
        ...idleState,
        status: 'starting',
        prompt: trimmed,
        mode,
      })

      try {
        const { runId } = await api.startRun(trimmed, mode, threadMode)
        setState((previous) => ({ ...previous, status: 'running', runId }))

        const source = new EventSource(`/api/runs/${runId}/events`)
        sourceRef.current = source

        source.onmessage = (message) => {
          let event: RunEvent
          try {
            event = JSON.parse(message.data) as RunEvent
          } catch {
            return
          }
          applyEvent(event)
          if (event.type === 'run.finished') {
            source.close()
            if (sourceRef.current === source) sourceRef.current = null
          }
        }

        source.onerror = () => {
          source.close()
          if (sourceRef.current === source) sourceRef.current = null
          setState((previous) =>
            previous.status === 'running'
              ? {
                  ...previous,
                  status: 'error',
                  error: '实时连接中断，请重新发起研究。',
                }
              : previous,
          )
        }
      } catch (error) {
        setState({
          ...idleState,
          error: error instanceof Error ? error.message : '启动失败',
        })
      }
    },
    [applyEvent, closeSource],
  )

  const cancel = useCallback(async () => {
    if (!state.runId) return
    try {
      await api.cancelRun(state.runId)
    } catch {
      // the stream will report the terminal state
    }
  }, [state.runId])

  const reset = useCallback(() => {
    closeSource()
    setState(idleState)
  }, [closeSource])

  return { state, start, cancel, reset }
}
