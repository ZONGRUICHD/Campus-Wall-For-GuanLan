import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import CaptchaWidget from '../components/CaptchaWidget.jsx'
import { useAlert } from '../contexts/AlertContext.jsx'
import { useUser } from '../contexts/UserContext.jsx'
import api from '../services/api'

const destinationFrom = (location) => {
  const from = location.state?.from
  if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('/login')) return from
  if (from?.pathname?.startsWith('/') && from.pathname !== '/login') {
    return `${from.pathname}${from.search || ''}${from.hash || ''}`
  }
  return '/me'
}

export default function Login() {
  const { user, loading, login, register } = useUser()
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
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
  const destination = useMemo(() => destinationFrom(location), [location])

  useEffect(() => {
    let active = true
    api.getCaptchaConfig()
      .then((response) => {
        if (active) setCaptcha(response.data?.captcha || { enabled: false, provider: 'none', site_key: '' })
      })
      .catch((error) => {
        if (active) setCaptchaError(error.message || '安全验证配置加载失败')
      })
      .finally(() => {
        if (active) setCaptchaLoading(false)
      })
    return () => { active = false }
  }, [])

  if (!loading && user) return <Navigate to={destination} replace />

  const switchMode = (nextMode) => {
    setMode(nextMode)
    setPassword('')
    setPasswordConfirm('')
    setCaptchaToken('')
    setCaptchaResetKey((value) => value + 1)
  }

  const submit = async (event) => {
    event.preventDefault()
    const cleanUsername = username.trim()
    if (!cleanUsername || !password) {
      alert.showTopRightAlert('请输入用户名和密码', 'warning', '信息还不完整')
      return
    }
    if (mode === 'register' && cleanUsername.length < 2) {
      alert.showTopRightAlert('用户名至少需要 2 个字符', 'warning', '用户名太短')
      return
    }
    if (mode === 'register' && !/^[\p{L}\p{N}._-]+$/u.test(cleanUsername)) {
      alert.showTopRightAlert('用户名只能包含中文、字母、数字、点、下划线与短横线', 'warning', '用户名格式不正确')
      return
    }
    if (mode === 'register' && password.length < 8) {
      alert.showTopRightAlert('密码至少需要 8 个字符', 'warning', '密码太短')
      return
    }
    if (mode === 'register' && password !== passwordConfirm) {
      alert.showTopRightAlert('两次输入的密码不一致', 'warning', '请重新确认密码')
      return
    }
    if (captcha.enabled && !captchaToken) {
      alert.showTopRightAlert('请先完成人机验证', 'warning', '提示')
      return
    }

    setSubmitting(true)
    try {
      const payload = { username: cleanUsername, password, captcha_token: captchaToken }
      if (mode === 'register') await register(payload)
      else await login(payload)
      alert.showTopRightAlert(
        mode === 'register' ? '账号创建成功，已经为你登录' : '登录成功，欢迎回来',
        'success',
        mode === 'register' ? '注册成功' : '欢迎'
      )
      navigate(destination, { replace: true })
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', mode === 'register' ? '注册失败' : '登录失败')
      if (captcha.enabled) {
        setCaptchaToken('')
        setCaptchaResetKey((value) => value + 1)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const isRegister = mode === 'register'

  return (
    <div className="mx-auto grid max-w-5xl items-center gap-8 py-6 lg:grid-cols-[1.1fr_420px]">
      <section className="auth-hero order-2 flex flex-col justify-center space-y-6 p-7 md:p-10 lg:order-1">
        <div className="space-y-4">
          <span className="page-kicker"><i className="bi bi-person-check" /><span>校园账号</span></span>
          <h1 className="text-3xl font-black tracking-tight text-[var(--text-primary)] md:text-4xl">一个名字，开始连接校园</h1>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)] md:text-base">
            自由设置用户名和密码即可加入。普通动态仍可匿名浏览与发布；失物招领需要登录，方便线索持续跟进。
          </p>
        </div>

        <div className="auth-note-grid">
          <div className="auth-note flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-light)] text-[var(--primary-color)]"><i className="bi bi-incognito text-lg" /></div>
            <div><b className="text-sm font-bold">匿名由你决定</b><p className="mt-0.5 text-xs text-[var(--text-muted)]">登录不等于公开身份，发帖时仍可选择完全匿名。</p></div>
          </div>
          <div className="auth-note flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--secondary-light)] text-[var(--secondary-color)]"><i className="bi bi-person-badge text-lg" /></div>
            <div><b className="text-sm font-bold">保存你的内容</b><p className="mt-0.5 text-xs text-[var(--text-muted)]">集中查看发布、评论、收藏与消息提醒。</p></div>
          </div>
          <div className="auth-note flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500"><i className="bi bi-search-heart text-lg" /></div>
            <div><b className="text-sm font-bold">失物招领可追溯</b><p className="mt-0.5 text-xs text-[var(--text-muted)]">登录后才能查看与发布启事，减少无效信息。</p></div>
          </div>
        </div>
      </section>

      <section className="card relative order-1 overflow-hidden p-6 shadow-xl sm:p-8 lg:order-2">
        <div className="mb-6 grid grid-cols-2 rounded-xl bg-[var(--card-secondary-bg)] p-1" role="tablist" aria-label="账号操作">
          <button className={`btn justify-center border-0 ${!isRegister ? 'btn-primary' : ''}`} type="button" role="tab" aria-selected={!isRegister} onClick={() => switchMode('login')}>登录</button>
          <button className={`btn justify-center border-0 ${isRegister ? 'btn-primary' : ''}`} type="button" role="tab" aria-selected={isRegister} onClick={() => switchMode('register')}>注册</button>
        </div>

        <div className="mb-6 space-y-1">
          <span className="page-kicker text-xs"><i className={`bi ${isRegister ? 'bi-person-plus' : 'bi-box-arrow-in-right'}`} /><span>{isRegister ? 'Create account' : 'Welcome back'}</span></span>
          <h2 className="text-2xl font-black text-[var(--text-primary)]">{isRegister ? '创建校园账号' : '账号登录'}</h2>
          <p className="text-xs text-[var(--text-muted)]">{isRegister ? '2–24 个字符，可使用中文、字母、数字、点、下划线与短横线' : '输入你注册时设置的用户名与密码'}</p>
        </div>

        <form className="space-y-4" onSubmit={submit}>
          <div className="block space-y-1.5">
            <label className="text-xs font-bold text-[var(--text-secondary)]" htmlFor="account-username">用户名</label>
            <div className="relative">
              <i className="bi bi-person absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="account-username" className="field w-full pl-10" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" maxLength={24} placeholder="输入你的用户名" />
            </div>
          </div>

          <div className="block space-y-1.5">
            <label className="text-xs font-bold text-[var(--text-secondary)]" htmlFor="account-password">{isRegister ? '设置密码' : '登录密码'}</label>
            <div className="relative">
              <i className="bi bi-lock absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="account-password" className="field w-full pl-10 pr-10" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete={isRegister ? 'new-password' : 'current-password'} maxLength={128} placeholder={isRegister ? '至少 8 个字符' : '请输入密码'} />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword}><i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`} aria-hidden="true" /></button>
            </div>
          </div>

          {isRegister ? (
            <div className="block space-y-1.5">
              <label className="text-xs font-bold text-[var(--text-secondary)]" htmlFor="account-password-confirm">确认密码</label>
              <div className="relative">
                <i className="bi bi-shield-check absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                <input id="account-password-confirm" className="field w-full pl-10" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="new-password" maxLength={128} placeholder="再次输入密码" />
              </div>
            </div>
          ) : null}

          {captchaLoading ? <div className="captcha-loading"><div className="spinner" /><span>正在加载安全验证...</span></div> : null}
          {captchaError ? <div className="info-callout status-danger p-3 text-sm">{captchaError}</div> : null}
          {!captchaLoading && !captchaError && captcha.enabled ? (
            <div className="space-y-2"><span className="text-xs font-bold text-[var(--text-secondary)]">人机验证</span><CaptchaWidget provider={captcha.provider} siteKey={captcha.site_key} onToken={setCaptchaToken} resetKey={captchaResetKey} /></div>
          ) : null}

          <button className="btn btn-primary mt-2 w-full justify-center py-2.5" type="submit" disabled={submitting || captchaLoading || Boolean(captchaError) || (captcha.enabled && !captchaToken)}>
            <i className={`bi ${isRegister ? 'bi-person-plus' : 'bi-box-arrow-in-right'}`} />
            <span>{submitting ? (isRegister ? '正在创建...' : '正在登录...') : (isRegister ? '创建并登录' : '立即登录')}</span>
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between border-t border-[var(--border-color)] pt-4 text-xs">
          <Link className="font-semibold text-[var(--primary-color)] hover:underline" to="/wall">← 返回校园动态</Link>
          <Link className="text-[var(--text-muted)] hover:underline" to="/help">遇到账号问题？</Link>
        </div>
      </section>
    </div>
  )
}
