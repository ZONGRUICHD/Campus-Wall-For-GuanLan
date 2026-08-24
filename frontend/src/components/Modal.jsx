import { createPortal } from 'react-dom'
import { useId, useLayoutEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'audio[controls]',
  'video[controls]',
  'iframe',
  'object',
  'embed',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

const modalStack = []
let bodyStyleBeforeModal = null

function getFocusableElements(container) {
  if (!container) return []

  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.closest('[inert]') || element.getAttribute('aria-hidden') === 'true') return false
    const style = window.getComputedStyle(element)
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
  })
}

function focusElement(element) {
  if (!element?.isConnected || typeof element.focus !== 'function') return false

  try {
    element.focus({ preventScroll: true })
  } catch {
    element.focus()
  }
  return document.activeElement === element
}

function focusDialog(dialog) {
  const focusableElements = getFocusableElements(dialog)
  const preferredElement = focusableElements.find((element) => element.hasAttribute('autofocus'))
  focusElement(preferredElement || focusableElements[0] || dialog)
}

function getTopModal() {
  return modalStack[modalStack.length - 1]
}

function registerModal(entry) {
  if (modalStack.length === 0) {
    const { body, documentElement } = document
    const scrollbarWidth = Math.max(0, window.innerWidth - documentElement.clientWidth)
    bodyStyleBeforeModal = {
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight
    }
    if (scrollbarWidth > 0) {
      const currentPadding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0
      body.style.paddingRight = `${currentPadding + scrollbarWidth}px`
    }
    body.style.overflow = 'hidden'
  }

  modalStack.push(entry)
}

function unregisterModal(entry) {
  const index = modalStack.indexOf(entry)
  if (index === -1) return

  const wasTopModal = index === modalStack.length - 1
  modalStack.splice(index, 1)

  // If a lower modal disappears first, preserve its restore target for dialogs above it.
  modalStack.forEach((openModal) => {
    if (entry.dialog?.contains(openModal.restoreTarget)) {
      openModal.restoreTarget = entry.restoreTarget
    }
  })

  if (modalStack.length === 0 && bodyStyleBeforeModal) {
    document.body.style.overflow = bodyStyleBeforeModal.overflow
    document.body.style.paddingRight = bodyStyleBeforeModal.paddingRight
    bodyStyleBeforeModal = null
  }

  if (!wasTopModal) return

  const nextModal = getTopModal()
  if (nextModal) {
    if (!nextModal.dialog?.contains(entry.restoreTarget) || !focusElement(entry.restoreTarget)) {
      focusDialog(nextModal.dialog)
    }
    return
  }

  focusElement(entry.restoreTarget)
}

export default function Modal({ visible, title, children, footer, onClose, width = '720px' }) {
  const titleId = useId()
  const panelRef = useRef(null)
  const modalIdRef = useRef(Symbol('modal'))
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    if (!visible || !panelRef.current) return undefined

    const activeElement = document.activeElement
    const entry = {
      id: modalIdRef.current,
      dialog: panelRef.current,
      restoreTarget: activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : null
    }

    registerModal(entry)
    focusDialog(entry.dialog)

    const handleKeyDown = (event) => {
      if (getTopModal() !== entry) return

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current?.()
        return
      }

      if (event.key !== 'Tab') return

      const focusableElements = getFocusableElements(entry.dialog)
      if (focusableElements.length === 0) {
        event.preventDefault()
        focusElement(entry.dialog)
        return
      }

      const activeIndex = focusableElements.indexOf(document.activeElement)
      const shouldWrapBackward = event.shiftKey && activeIndex <= 0
      const shouldWrapForward = !event.shiftKey && (
        activeIndex === -1 || activeIndex === focusableElements.length - 1
      )

      if (shouldWrapBackward || shouldWrapForward) {
        event.preventDefault()
        focusElement(shouldWrapBackward
          ? focusableElements[focusableElements.length - 1]
          : focusableElements[0])
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      unregisterModal(entry)
    }
  }, [visible])

  if (!visible) return null

  return createPortal(
    <div
      className="modal-backdrop-custom"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && getTopModal()?.id === modalIdRef.current) {
          onCloseRef.current?.()
        }
      }}
    >
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width: `min(${width}, calc(100vw - 36px))` }}
        onMouseDown={(event) => event.stopPropagation()}
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
