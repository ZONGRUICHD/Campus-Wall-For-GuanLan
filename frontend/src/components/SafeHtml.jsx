import { useEffect, useState } from 'react'

const sanitizedCache = new Map()
let sanitizerPromise

const loadSanitizer = () => {
  sanitizerPromise ||= import('../utils/sanitizeHtml.js').then((module) => module.sanitizeHtml)
  return sanitizerPromise
}

export default function SafeHtml({ as: Element = 'div', html = '', fallback = null, ...props }) {
  const source = String(html || '')
  const [safeHtml, setSafeHtml] = useState(() => sanitizedCache.get(source))

  useEffect(() => {
    let alive = true

    if (!source) {
      setSafeHtml('')
      return () => {
        alive = false
      }
    }

    if (sanitizedCache.has(source)) {
      setSafeHtml(sanitizedCache.get(source))
      return () => {
        alive = false
      }
    }

    setSafeHtml(undefined)
    loadSanitizer()
      .then((sanitizeHtml) => {
        const sanitized = sanitizeHtml(source)
        sanitizedCache.set(source, sanitized)
        if (alive) setSafeHtml(sanitized)
      })
      .catch(() => {
        if (alive) setSafeHtml('')
      })

    return () => {
      alive = false
    }
  }, [source])

  const contentProps = safeHtml === undefined
    ? { children: fallback }
    : { dangerouslySetInnerHTML: { __html: safeHtml } }

  return <Element {...props} {...contentProps} />
}
