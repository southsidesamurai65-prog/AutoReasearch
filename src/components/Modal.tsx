import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ModalProps {
  title: string
  subtitle?: string
  icon?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}

export function Modal({
  title,
  subtitle,
  icon,
  onClose,
  children,
  footer,
  wide,
}: ModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={`animate-rise flex max-h-[86vh] w-full flex-col overflow-hidden rounded-xl border border-line bg-ink-900 shadow-2xl ${
          wide ? 'max-w-5xl' : 'max-w-3xl'
        }`}
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line/80 px-4 py-3">
          {icon}
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold text-white">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 truncate text-[10px] text-slate-500">
                {subtitle}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="icon-btn">
            <X size={14} />
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-line/80 bg-ink-950/40 px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
