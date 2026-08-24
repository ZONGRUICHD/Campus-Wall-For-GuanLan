import { createPortal } from 'react-dom'
import { useEffect, useId, useRef } from 'react'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

const openModals = []
let bodyScrollLocks = 0
let previousBodyOverflow = ''

const lockBodyScroll = () => {
  if (bodyScrollLocks === 0) previousBodyOverflow = document.body.style.overflow
  bodyScrollLocks += 1
  document.body.style.overflow = 'hidden'
}

const unlockBodyScroll = () => {
  bodyScrollLocks = Math.max(0, bodyScrollLocks - 1)
  if (bodyScrollLocks === 0) document.body.style.overflow = previousBodyOverflow
}

const focusableElements = (container) => Array.from(container.querySelectorAll(focusableSelector))
  .filter((element) => element.getAttribute('aria-hidden') !== 'true' && !element.closest('[hidden]'))

export default function Modal({ visible, title, children, footer, onClose, width = '720px' }) {
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  onCloseRef.current = onClose

  useEffect(() => {
    if (!visible) return undefined

    const token = {}
    const previouslyFocused = document.activeElement
    const panel = panelRef.current
    openModals.push(token)
    lockBodyScroll()

    const handleKeyDown = (event) => {
      if (openModals[openModals.length - 1] !== token) return

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab' || !panel) return

      const elements = focusableElements(panel)
      if (!elements.length) {
        event.preventDefault()
        panel.focus()
        return
      }

      const first = elements[0]
      const last = elements[elements.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    const elements = panel ? focusableElements(panel) : []
    ;(elements[0] || panel)?.focus()

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const wasTopModal = openModals[openModals.length - 1] === token
      const index = openModals.lastIndexOf(token)
      if (index !== -1) openModals.splice(index, 1)
      unlockBodyScroll()
      if (wasTopModal && previouslyFocused?.isConnected && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [visible])

  if (!visible) return null

  return createPortal(
    <div className="modal-backdrop-custom" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCloseRef.current?.()
    }}>
      <div
        ref={panelRef}
        className="modal-panel"
        style={{ width: `min(${width}, calc(100vw - 36px))` }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-header-custom flex items-center justify-between gap-4 px-5 py-4">
          <h3 id={titleId} className="text-lg font-bold">{title}</h3>
          <button className="btn btn-sm btn-outline" type="button" onClick={onClose} aria-label="关闭">
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body-scroll px-5 py-4">{children}</div>
        {footer ? (
          <div className="modal-footer-custom flex justify-end gap-2 px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
