import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import CaptchaWidget from '../components/CaptchaWidget.jsx'
import { useAlert } from '../contexts/AlertContext.jsx'
import { useUser } from '../contexts/UserContext.jsx'
import api from '../services/api'

export default function Login() {
  const { user, loading, login } = useUser()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [captcha, setCaptcha] = useState({ enabled: false, provider: 'none', site_key: '' })
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [captchaLoading, setCaptchaLoading] = useState(true)
  const [captchaError, setCaptchaError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const alert = useAlert()

  useEffect(() => {
    let active = true
    api.getCaptchaConfig()
      .then((response) => {
        if (active) setCaptcha(response.data?.captcha || { enabled: false, provider: 'none', site_key: '' })
      })
      .catch((error) => {
        if (active) setCaptchaError(error.message || '登录安全配置加载失败')
      })
      .finally(() => {
        if (active) setCaptchaLoading(false)
      })
    return () => { active = false }
  }, [])

  if (!loading && user) return <Navigate to="/me" replace />

  const submit = async (event) => {
    event.preventDefault()
    if (!username.trim() || !password) {
      alert.showTopRightAlert('请输入学号和密码', 'warning', '提示')
      return
    }
    if (captcha.enabled && !captchaToken) {
      alert.showTopRightAlert('请先完成人机验证', 'warning', '提示')
      return
    }
    setSubmitting(true)
    try {
      await login({ username: username.trim(), password, captcha_token: captchaToken })
      alert.showTopRightAlert('登录成功，欢迎回来！', 'success', '欢迎')
      const from = location.state?.from?.pathname || '/me'
      navigate(from, { replace: true })
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '登录失败')
      if (captcha.enabled) {
        setCaptchaToken('')
        setCaptchaResetKey((value) => value + 1)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1.1fr_420px] items-center py-6">
      {/* Left Promo Card */}
      <section className="auth-hero flex flex-col justify-center p-8 md:p-10 space-y-6">
        <div className="space-y-4">
          <span className="page-kicker">
            <i className="bi bi-shield-check" />
            <span>学生认证中心</span>
          </span>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight text-[var(--text-primary)]">
            学生账号登录
          </h1>
          <p className="text-sm md:text-base text-[var(--text-secondary)] leading-relaxed">
            登录后可在发帖时选择展示个性昵称与头像，支持随时切换为完全匿名模式。学号仅用于身份认证与后台保障，绝不会在公开页面展示。
          </p>
        </div>

        <div className="auth-note-grid">
          <div className="auth-note flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary-light)] text-[var(--primary-color)] shrink-0">
              <i className="bi bi-incognito text-lg" />
            </div>
            <div>
              <b className="text-sm font-bold">默认完全匿名</b>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">公开页面绝不泄露你的学号与真实姓名。</p>
            </div>
          </div>

          <div className="auth-note flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--secondary-light)] text-[var(--secondary-color)] shrink-0">
              <i className="bi bi-person-badge text-lg" />
            </div>
            <div>
              <b className="text-sm font-bold">个性化个人空间</b>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">可自由设置你的专属昵称、头像和个人简介。</p>
            </div>
          </div>

          <div className="auth-note flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500 shrink-0">
              <i className="bi bi-shield-lock-fill text-lg" />
            </div>
            <div>
              <b className="text-sm font-bold">安全纯净环境</b>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">杜绝恶意违规与骚扰，营造友善温暖的校园社区。</p>
            </div>
          </div>
        </div>
      </section>

      {/* Right Login Form */}
      <section className="card p-8 shadow-xl relative overflow-hidden">
        <div className="mb-6 space-y-1">
          <span className="page-kicker text-xs">
            <i className="bi bi-box-arrow-in-right" />
            <span>Login</span>
          </span>
          <h2 className="text-2xl font-black text-[var(--text-primary)]">账号登录</h2>
          <p className="text-xs text-[var(--text-muted)]">请输入你的学生学号与初始密码</p>
        </div>

        <form className="space-y-4" onSubmit={submit}>
          <div className="block space-y-1.5">
            <label className="text-xs font-bold text-[var(--text-secondary)]" htmlFor="login-username">学生学号</label>
            <div className="relative">
              <i className="bi bi-person absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input
                id="login-username"
                className="field pl-10 w-full"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="请输入你的学号"
              />
            </div>
          </div>

          <div className="block space-y-1.5">
            <label className="text-xs font-bold text-[var(--text-secondary)]" htmlFor="login-password">登录密码</label>
            <div className="relative">
              <i className="bi bi-lock absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input
                id="login-password"
                className="field pl-10 pr-10 w-full"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="请输入密码"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                aria-pressed={showPassword}
              >
                <i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`} aria-hidden="true" />
              </button>
            </div>
          </div>

          {captchaLoading ? <div className="captcha-loading"><div className="spinner" /><span>正在加载登录安全验证...</span></div> : null}
          {captchaError ? <div className="info-callout status-danger p-3 text-sm">{captchaError}</div> : null}
          {!captchaLoading && !captchaError && captcha.enabled ? (
            <div className="space-y-2">
              <span className="text-xs font-bold text-[var(--text-secondary)]">人机验证</span>
              <CaptchaWidget provider={captcha.provider} siteKey={captcha.site_key} onToken={setCaptchaToken} resetKey={captchaResetKey} />
            </div>
          ) : null}

          <button
            className="btn btn-primary w-full justify-center py-2.5 mt-2"
            type="submit"
            disabled={submitting || captchaLoading || Boolean(captchaError) || (captcha.enabled && !captchaToken)}
          >
            <i className="bi bi-box-arrow-in-right" />
            <span>{submitting ? '正在登录...' : '立即登录'}</span>
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between border-t border-[var(--border-color)] pt-4 text-xs">
          <Link className="font-semibold text-[var(--primary-color)] hover:underline" to="/wall">
            ← 返回匿名浏览
          </Link>
          <Link className="text-[var(--text-muted)] hover:underline" to="/help">
            遇到登录问题？
          </Link>
        </div>
      </section>
    </div>
  )
}
