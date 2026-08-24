import { createPortal } from 'react-dom'

export default function Modal({ visible, title, children, footer, onClose, width = '720px' }) {
  if (!visible) return null

  return createPortal(
    <div className="modal-backdrop-custom" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="modal-panel" style={{ width: `min(${width}, calc(100vw - 36px))` }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header-custom flex items-center justify-between gap-4 px-5 py-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button className="btn btn-sm btn-outline" type="button" onClick={onClose} aria-label="关闭">
            <i className="bi bi-x-lg" />
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
