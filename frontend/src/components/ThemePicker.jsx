import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../contexts/ThemeContext.jsx'

export default function ThemePicker() {
  const [open, setOpen] = useState(false)
  const hostRef = useRef(null)
  const triggerRef = useRef(null)
  const { appearance, setAppearance, resolvedAppearance, palette, setPalette, appearanceOptions, paletteOptions } = useTheme()
  const appearanceLabel = appearanceOptions.find((option) => option.id === appearance)?.label || resolvedAppearance
  const paletteLabel = paletteOptions.find((option) => option.id === palette)?.label || palette

  const closeAndRestoreFocus = () => {
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!open) return undefined
    const closeOnOutside = (event) => {
      if (!hostRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        closeAndRestoreFocus()
      }
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div className="theme-picker" ref={hostRef}>
      <button
        ref={triggerRef}
        className="btn btn-sm btn-outline theme-picker-trigger"
        type="button"
        aria-label={`外观与主题：${appearanceLabel}，${paletteLabel}`}
        aria-expanded={open}
        aria-controls="theme-picker-panel"
        onClick={() => setOpen((current) => !current)}
        title="外观与主题"
      >
        <span className="theme-picker-trigger-swatch" aria-hidden="true" />
        <i className={`theme-icon bi ${resolvedAppearance === 'dark' ? 'bi-moon-stars-fill' : 'bi-sun-fill'}`} aria-hidden="true" />
      </button>

      {open ? (
        <section id="theme-picker-panel" className="theme-picker-panel" role="group" aria-label="外观与主题设置">
          <div className="theme-picker-heading">
            <div>
              <b>外观与主题</b>
              <span>只保存在当前设备</span>
            </div>
            <button className="theme-picker-close" type="button" onClick={closeAndRestoreFocus} aria-label="关闭主题设置">×</button>
          </div>

          <fieldset className="theme-picker-group">
            <legend>明暗模式</legend>
            <div className="theme-appearance-options">
              {appearanceOptions.map((option) => (
                <button
                  className={appearance === option.id ? 'is-selected' : ''}
                  type="button"
                  key={option.id}
                  onClick={() => setAppearance(option.id)}
                  aria-pressed={appearance === option.id}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="theme-picker-group">
            <legend>强调色</legend>
            <div className="theme-palette-options">
              {paletteOptions.map((option) => (
                <button
                  className={palette === option.id ? 'is-selected' : ''}
                  type="button"
                  key={option.id}
                  onClick={() => setPalette(option.id)}
                  aria-pressed={palette === option.id}
                  aria-label={`${option.label}主题${palette === option.id ? '，当前已选择' : ''}`}
                >
                  <span style={{ '--theme-option-color': option.color }} aria-hidden="true" />
                  <small>{option.label}</small>
                  {palette === option.id ? <i className="bi bi-check2" aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </fieldset>
        </section>
      ) : null}
    </div>
  )
}
