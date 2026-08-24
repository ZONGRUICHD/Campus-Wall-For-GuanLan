import { useEffect, useRef, useState } from 'react'

const scripts = new Map()

const loadScript = (id, src, isReady) => {
  if (isReady()) return Promise.resolve()
  if (scripts.has(id)) return scripts.get(id)

  const promise = new Promise((resolve, reject) => {
    const existing = document.getElementById(id)
    const script = existing || document.createElement('script')
    const done = () => isReady() ? resolve() : reject(new Error('验证组件加载失败'))
    script.addEventListener('load', done, { once: true })
    script.addEventListener('error', () => reject(new Error('验证组件加载失败')), { once: true })
    if (!existing) {
      script.id = id
      script.src = src
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
  }).catch((error) => {
    scripts.delete(id)
    throw error
  })

  scripts.set(id, promise)
  return promise
}

const currentTheme = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'

export default function CaptchaWidget({ provider, siteKey, onToken, resetKey = 0 }) {
  const containerRef = useRef(null)
  const [error, setError] = useState('')
  const [theme, setTheme] = useState(currentTheme)

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let active = true
    let widgetId = null
    setError('')
    onToken('')

    const mount = async () => {
      if (!containerRef.current || !siteKey) throw new Error('验证站点密钥未配置')
      if (provider === 'turnstile') {
        await loadScript('turnstile-api', 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', () => Boolean(window.turnstile))
        if (!active || !containerRef.current) return
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'auto',
          size: 'flexible',
          callback: (token) => active && onToken(token),
          'expired-callback': () => active && onToken(''),
          'error-callback': () => active && setError('验证组件暂时不可用，请刷新后重试')
        })
        return
      }

      if (provider === 'recaptcha') {
        await loadScript('recaptcha-api', 'https://www.google.com/recaptcha/api.js?render=explicit', () => Boolean(window.grecaptcha?.render))
        if (!active || !containerRef.current) return
        await new Promise((resolve) => window.grecaptcha.ready(resolve))
        if (!active || !containerRef.current) return
        widgetId = window.grecaptcha.render(containerRef.current, {
          sitekey: siteKey,
          theme,
          callback: (token) => active && onToken(token),
          'expired-callback': () => active && onToken(''),
          'error-callback': () => active && setError('验证组件暂时不可用，请刷新后重试')
        })
        return
      }

      throw new Error('不支持的人机验证服务')
    }

    mount().catch((mountError) => {
      if (active) setError(mountError.message || '验证组件加载失败')
    })

    return () => {
      active = false
      onToken('')
      if (provider === 'turnstile' && widgetId !== null && window.turnstile?.remove) window.turnstile.remove(widgetId)
      if (provider === 'recaptcha' && widgetId !== null && window.grecaptcha?.reset) window.grecaptcha.reset(widgetId)
      if (containerRef.current) containerRef.current.replaceChildren()
    }
  }, [onToken, provider, resetKey, siteKey, theme])

  return (
    <div className="captcha-widget-wrap">
      <div ref={containerRef} className="captcha-widget" />
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
    </div>
  )
}
