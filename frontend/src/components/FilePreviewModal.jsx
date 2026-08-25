import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { fileType, fileUrl } from '../utils/user'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'audio[controls]',
  'video[controls]',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function downloadName(file = '', type = 'file') {
  const cleaned = String(file).split(/[\\/]/).pop()
    .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_/i, '')
    .replace(/^\d{10,}_/, '')
    .trim()
  if (cleaned) return cleaned
  return type === 'image' ? '校园动态图片.webp' : '校园动态附件'
}

function downloadUrl(source, name) {
  if (!source) return ''
  if (/^(blob:|data:)/i.test(source)) return source
  try {
    const url = new URL(source, window.location.href)
    url.searchParams.set('download', '1')
    url.searchParams.set('name', name)
    return url.toString()
  } catch {
    return source
  }
}

export default function FilePreviewModal({ files = [], index = 0, visible, onClose, onIndexChange }) {
  const total = files.length
  const safeIndex = Math.min(Math.max(Number(index) || 0, 0), Math.max(total - 1, 0))
  const file = files[safeIndex]
  const type = fileType(file)
  const source = file ? fileUrl(file) : ''
  const dialogRef = useRef(null)
  const closeButtonRef = useRef(null)
  const moreButtonRef = useRef(null)
  const menuRef = useRef(null)
  const pointerStartRef = useRef(null)
  const hideTimerRef = useRef(null)
  const indexRef = useRef(safeIndex)
  const totalRef = useRef(total)
  const onIndexChangeRef = useRef(onIndexChange)
  const onCloseRef = useRef(onClose)
  const menuOpenRef = useRef(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [mediaStatus, setMediaStatus] = useState('loading')
  const [retryKey, setRetryKey] = useState(0)

  indexRef.current = safeIndex
  totalRef.current = total
  onIndexChangeRef.current = onIndexChange
  onCloseRef.current = onClose
  menuOpenRef.current = menuOpen

  const go = (step) => {
    const nextIndex = Math.min(Math.max(indexRef.current + step, 0), totalRef.current - 1)
    if (nextIndex === indexRef.current || nextIndex < 0) return
    onIndexChangeRef.current?.(nextIndex)
  }

  const revealControls = () => {
    setControlsVisible(true)
    window.clearTimeout(hideTimerRef.current)
    if (!menuOpen) {
      hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2800)
    }
  }

  useEffect(() => {
    if (!visible) return undefined

    setControlsVisible(true)
    setMenuOpen(false)
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2800)
    return () => window.clearTimeout(hideTimerRef.current)
  }, [visible, safeIndex])

  useEffect(() => {
    setMediaStatus(type === 'image' || type === 'video' ? 'loading' : 'ready')
    setRetryKey(0)
  }, [file, type, visible])

  useEffect(() => {
    if (!visible) return undefined

    const restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const bodyOverflow = document.body.style.overflow
    const bodyPaddingRight = document.body.style.paddingRight
    const lightboxRoot = dialogRef.current?.closest('.media-lightbox')
    const inertSiblings = Array.from(document.body.children)
      .filter((element) => element !== lightboxRoot)
      .map((element) => ({ element, wasInert: element.inert === true }))
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth)

    if (scrollbarWidth > 0) {
      const currentPadding = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0
      document.body.style.paddingRight = `${currentPadding + scrollbarWidth}px`
    }
    document.body.style.overflow = 'hidden'
    inertSiblings.forEach(({ element }) => { element.inert = true })

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (menuOpenRef.current) {
          setMenuOpen(false)
          setControlsVisible(true)
          requestAnimationFrame(() => moreButtonRef.current?.focus({ preventScroll: true }))
          return
        }
        onCloseRef.current?.()
        return
      }

      const isMediaControl = event.target instanceof Element && event.target.closest('video, audio')
      if (!menuOpenRef.current && !isMediaControl && event.key === 'ArrowLeft') {
        event.preventDefault()
        go(-1)
        revealControls()
        return
      }
      if (!menuOpenRef.current && !isMediaControl && event.key === 'ArrowRight') {
        event.preventDefault()
        go(1)
        revealControls()
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter((element) => element.getClientRects().length > 0)
      if (!focusable.length) {
        event.preventDefault()
        dialogRef.current.focus({ preventScroll: true })
        return
      }
      const currentIndex = focusable.indexOf(document.activeElement)
      if (event.shiftKey && currentIndex <= 0) {
        event.preventDefault()
        focusable[focusable.length - 1].focus({ preventScroll: true })
      } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
        event.preventDefault()
        focusable[0].focus({ preventScroll: true })
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    requestAnimationFrame(() => closeButtonRef.current?.focus({ preventScroll: true }))

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      document.body.style.overflow = bodyOverflow
      document.body.style.paddingRight = bodyPaddingRight
      inertSiblings.forEach(({ element, wasInert }) => { element.inert = wasInert })
      restoreTarget?.focus?.({ preventScroll: true })
    }
  }, [visible])

  useEffect(() => {
    if (!menuOpen) return
    requestAnimationFrame(() => menuRef.current?.querySelector('a, button:not([disabled])')?.focus({ preventScroll: true }))
  }, [menuOpen])

  useEffect(() => {
    if (!visible || total < 2) return

    ;[safeIndex - 1, safeIndex + 1].forEach((nextIndex) => {
      const nextFile = files[nextIndex]
      if (!nextFile || fileType(nextFile) !== 'image') return
      const preload = new Image()
      preload.src = fileUrl(nextFile)
    })
  }, [files, safeIndex, total, visible])

  if (!visible) return null

  const attachmentName = downloadName(file, type)
  const downloadSource = downloadUrl(source, attachmentName)

  const handlePointerDown = (event) => {
    if (event.button !== 0 || event.target.closest('button, a, video, audio, iframe')) return
    pointerStartRef.current = { x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dialogRef.current?.focus({ preventScroll: true })
  }

  const handlePointerUp = (event) => {
    const start = pointerStartRef.current
    pointerStartRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (!start) return

    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    if (Math.abs(deltaX) > 54 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      go(deltaX < 0 ? 1 : -1)
      revealControls()
      return
    }

    setControlsVisible((current) => !current)
    setMenuOpen(false)
  }

  return createPortal(
    <div
      className={`media-lightbox ${controlsVisible || menuOpen ? 'is-controls-visible' : ''}`}
      onMouseMove={revealControls}
    >
      <div
        ref={dialogRef}
        className="media-lightbox-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={type === 'image' ? '图片预览' : '媒体预览'}
        tabIndex={-1}
      >
        <header className="media-lightbox-topbar">
          <button
            ref={closeButtonRef}
            className="media-lightbox-icon"
            type="button"
            onClick={onClose}
            aria-label="关闭预览"
          >
            <i className="bi bi-arrow-left" aria-hidden="true" />
          </button>

          <span className="media-lightbox-counter" aria-live="polite">
            {total ? `${safeIndex + 1} / ${total}` : '0 / 0'}
          </span>

          <div className="media-lightbox-more">
            <button
              ref={moreButtonRef}
              className="media-lightbox-icon"
              type="button"
              aria-label="更多图片操作"
              aria-expanded={menuOpen}
              onClick={() => {
                setMenuOpen((current) => !current)
                setControlsVisible(true)
              }}
            >
              <i className="bi bi-three-dots" aria-hidden="true" />
            </button>
            {menuOpen && source ? (
              <div ref={menuRef} className="media-lightbox-menu" aria-label="媒体操作">
                <a href={downloadSource} download={attachmentName} onClick={() => setMenuOpen(false)}>
                  <i className="bi bi-download" aria-hidden="true" />
                  {type === 'image' ? '保存图片' : '保存附件'}
                </a>
                <a href={source} target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}>
                  <i className="bi bi-box-arrow-up-right" aria-hidden="true" />
                  在新窗口打开
                </a>
              </div>
            ) : null}
          </div>
        </header>

        <div
          className={`media-lightbox-stage is-${type}`}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => { pointerStartRef.current = null }}
        >
          {(type === 'image' || type === 'video') && mediaStatus === 'loading' ? (
            <span className="media-lightbox-loading" role="status" aria-label="媒体加载中">
              <span className="spinner" />
            </span>
          ) : null}
          {type === 'image' && source ? (
            <img
              key={`${file}-${retryKey}`}
              className={`media-lightbox-image ${mediaStatus === 'error' ? 'is-error' : ''}`}
              src={source}
              alt={`第 ${safeIndex + 1} 张图片`}
              draggable="false"
              onLoad={() => setMediaStatus('ready')}
              onError={() => setMediaStatus('error')}
            />
          ) : null}
          {type === 'video' && source ? (
            <video
              key={`${file}-${retryKey}`}
              className={`media-lightbox-video ${mediaStatus === 'error' ? 'is-error' : ''}`}
              controls
              autoPlay
              playsInline
              preload="metadata"
              src={source}
              onLoadedMetadata={() => setMediaStatus('ready')}
              onError={() => setMediaStatus('error')}
            />
          ) : null}
          {(type === 'image' || type === 'video') && mediaStatus === 'error' ? (
            <div className="media-lightbox-attachment" role="alert">
              <i className="bi bi-file-earmark" aria-hidden="true" />
              <p>媒体加载失败</p>
              <span>可以重新加载，或在新窗口中打开。</span>
              <div className="media-lightbox-attachment-actions">
                <button
                  className="media-lightbox-download"
                  type="button"
                  onClick={() => {
                    setMediaStatus('loading')
                    setRetryKey((current) => current + 1)
                  }}
                >
                  重新加载
                </button>
                <a className="media-lightbox-secondary-action" href={source} target="_blank" rel="noreferrer">新窗口打开</a>
              </div>
            </div>
          ) : null}
          {type === 'audio' && source ? (
            <div className="media-lightbox-attachment">
              <i className="bi bi-music-note-beamed" aria-hidden="true" />
              <p>音频附件</p>
              <audio controls src={source} />
            </div>
          ) : null}
          {type === 'pdf' && source ? (
            <div className="media-lightbox-attachment">
              <i className="bi bi-file-earmark" aria-hidden="true" />
              <p>PDF 附件</p>
              <span>为保证跨域安全，请在新窗口查看。</span>
              <div className="media-lightbox-attachment-actions">
                <a className="media-lightbox-download" href={source} target="_blank" rel="noreferrer">打开 PDF</a>
                <a className="media-lightbox-secondary-action" href={downloadSource} download={attachmentName}>保存文件</a>
              </div>
            </div>
          ) : null}
          {(!file || type === 'file') ? (
            <div className="media-lightbox-attachment">
              <i className="bi bi-file-earmark" aria-hidden="true" />
              <p>{file ? '此附件无法直接预览' : '未选择文件'}</p>
              {source ? <a className="media-lightbox-download" href={downloadSource} download={attachmentName}>保存附件</a> : null}
            </div>
          ) : null}
        </div>

        {total > 1 ? (
          <>
            <button
              className="media-lightbox-nav is-previous"
              type="button"
              onClick={() => { go(-1); revealControls() }}
              disabled={safeIndex === 0}
              aria-label="上一张"
            >
              <i className="bi bi-chevron-left" aria-hidden="true" />
            </button>
            <button
              className="media-lightbox-nav is-next"
              type="button"
              onClick={() => { go(1); revealControls() }}
              disabled={safeIndex === total - 1}
              aria-label="下一张"
            >
              <i className="bi bi-chevron-right" aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
