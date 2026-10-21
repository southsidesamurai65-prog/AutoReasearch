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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#3a3223]/45 p-4 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={`animate-rise flex max-h-[86vh] w-full flex-col overflow-hidden rounded-md border border-mo-300 bg-ink-900 shadow-panel ${
          wide ? 'max-w-5xl' : 'max-w-3xl'
        }`}
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b-[3px] border-double border-mo-400/40 px-4 py-3">
          {icon}
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold text-mo-950">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 truncate text-[10px] text-mo-500">
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
          <div className="shrink-0 border-t border-mo-300/70 bg-ink-850/70 px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
