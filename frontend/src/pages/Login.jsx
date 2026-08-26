import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import CaptchaWidget from '../components/CaptchaWidget.jsx'
import { useAlert } from '../contexts/AlertContext.jsx'
import { useUser } from '../contexts/UserContext.jsx'
import api from '../services/api'
import { toApiUrl } from '../services/urls'

const destinationFrom = (location) => {
  const from = location.state?.from
  if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('/login')) return from
  if (from?.pathname?.startsWith('/') && from.pathname !== '/login') {
    return `${from.pathname}${from.search || ''}${from.hash || ''}`
  }
  return '/me'
}

const feishuErrorText = {
  not_in_group: '你不在指定的校园墙飞书群中，无法登录。请先加入该内部群后再试。',
  disabled: '账号已停用，请联系管理员。',
  oauth_failed: '飞书授权失败，请重试。',
  invalid_state: '登录已过期，请重新点击飞书登录。',
  cancelled: '已取消飞书登录。',
  not_configured: '飞书登录暂未配置，请稍后再试。',
  conflict: '该飞书账号已绑定其他校园墙账号。',
  already_bound: '当前账号已绑定其他飞书账号。',
  join_failed: '飞书账号已绑定，但自动进群失败，请联系管理员。'
}

export default function Login() {
  const { user, loading, login, register } = useUser()
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [email, setEmail] = useState('')
  const [emailNotify, setEmailNotify] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [captcha, setCaptcha] = useState({ enabled: false, provider: 'none', site_key: '' })
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [captchaLoading, setCaptchaLoading] = useState(true)
  const [captchaError, setCaptchaError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const alert = useAlert()
  const destination = useMemo(() => destinationFrom(location), [location])
  const startHref = useMemo(() => {
    const params = new URLSearchParams()
    params.set('next', destination)
    return toApiUrl(`/api/user/feishu/start?${params.toString()}`)
  }, [destination])
  const feishuError = searchParams.get('feishu_error') || ''
  const emailStatus = searchParams.get('email') || ''
  const emailError = searchParams.get('email_error') || ''

  useEffect(() => {
    if (!feishuError && !emailStatus && !emailError) return undefined
    if (feishuError) {
      alert.showTopRightAlert(feishuErrorText[feishuError] || feishuErrorText.oauth_failed, 'warning', '飞书登录失败')
    } else if (emailStatus === 'verified') {
      alert.showTopRightAlert('邮箱已验证，审核通过后即可登录接收消息', 'success', '邮箱已绑定')
    } else if (emailError) {
      alert.showTopRightAlert('验证链接无效或已过期', 'warning', '邮箱验证失败')
    }
    navigate({ pathname: '/login', search: '', hash: '' }, { replace: true, state: location.state })
    return undefined
  }, [alert, emailError, emailStatus, feishuError, location.state, navigate])

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
    setEmail('')
    setEmailNotify(true)
    setCaptchaToken('')
    setCaptchaResetKey((value) => value + 1)
  }

  const submit = async (event) => {
    event.preventDefault()
    const cleanUsername = username.trim()
    const isRegister = mode === 'register'
    if (!cleanUsername || !password) {
      alert.showTopRightAlert('请输入用户名和密码', 'warning', '信息还不完整')
      return
    }
    if (isRegister && cleanUsername.length < 2) {
      alert.showTopRightAlert('用户名至少需要 2 个字符', 'warning', '用户名太短')
      return
    }
    if (isRegister && !/^[\p{L}\p{N}._-]+$/u.test(cleanUsername)) {
      alert.showTopRightAlert('用户名只能包含中文、字母、数字、点、下划线与短横线', 'warning', '用户名格式不正确')
      return
    }
    if (isRegister && password.length < 8) {
      alert.showTopRightAlert('密码至少需要 8 个字符', 'warning', '密码太短')
      return
    }
    if (isRegister && password !== passwordConfirm) {
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
      if (isRegister) {
        const cleanEmail = email.trim()
        if (cleanEmail) payload.email = cleanEmail
        payload.email_notify = emailNotify
        const result = await register(payload)
        alert.showTopRightAlert(
          result?.email_queued
            ? '注册已提交。请查收验证邮件；审核员通过后再登录。'
            : '注册已提交。审核员通过后，再用同一用户名密码登录。',
          'success',
          '等待审核'
        )
        switchMode('login')
        return
      }
      await login(payload)
      alert.showTopRightAlert('登录成功，欢迎回来', 'success', '欢迎')
      navigate(destination, { replace: true })
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', isRegister ? '注册失败' : '登录失败')
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
        <h1 className="text-3xl font-black tracking-tight text-[var(--text-primary)] md:text-4xl">进入校园墙</h1>

        <div className="auth-note-grid">
          <div className="auth-note flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-light)] text-[var(--primary-color)]"><i className="bi bi-box-arrow-in-right text-lg" /></div>
            <b className="text-sm font-bold">飞书立即进入</b>
          </div>
          <div className="auth-note flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--secondary-light)] text-[var(--secondary-color)]"><i className="bi bi-hourglass-split text-lg" /></div>
            <b className="text-sm font-bold">密码注册要审核</b>
          </div>
          <div className="auth-note flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500"><i className="bi bi-search text-lg" /></div>
            <b className="text-sm font-bold">失物招领可追溯</b>
          </div>
        </div>
      </section>

      <section className="card relative order-1 overflow-hidden p-6 shadow-xl sm:p-8 lg:order-2">
        <h2 className="mb-5 text-2xl font-black text-[var(--text-primary)]">登录校园墙</h2>

        <a className="btn btn-primary w-full justify-center py-2.5" href={startHref}>
          <i className="bi bi-box-arrow-in-right" />
          <span>使用飞书登录</span>
        </a>

        <div className="my-5 flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
          <span className="h-px flex-1 bg-[var(--border-color)]" />
          或使用用户名密码
          <span className="h-px flex-1 bg-[var(--border-color)]" />
        </div>

        <div className="mb-4 grid grid-cols-2 rounded-xl bg-[var(--card-secondary-bg)] p-1" role="tablist" aria-label="账号操作">
          <button className={`btn justify-center border-0 ${!isRegister ? 'btn-primary' : ''}`} type="button" role="tab" aria-selected={!isRegister} onClick={() => switchMode('login')}>登录</button>
          <button className={`btn justify-center border-0 ${isRegister ? 'btn-primary' : ''}`} type="button" role="tab" aria-selected={isRegister} onClick={() => switchMode('register')}>注册</button>
        </div>

        <form className="space-y-4" onSubmit={submit}>
          <label className="block space-y-1.5" htmlFor="account-username">
            <span className="text-xs font-bold text-[var(--text-secondary)]">用户名</span>
            <input id="account-username" className="field w-full" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" maxLength={24} placeholder="输入你的用户名" />
          </label>

          <label className="block space-y-1.5" htmlFor="account-password">
            <span className="text-xs font-bold text-[var(--text-secondary)]">{isRegister ? '设置密码' : '登录密码'}</span>
            <div className="relative">
              <input id="account-password" className="field w-full pr-10" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete={isRegister ? 'new-password' : 'current-password'} maxLength={128} placeholder={isRegister ? '至少 8 个字符' : '请输入密码'} />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword}><i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`} aria-hidden="true" /></button>
            </div>
          </label>

          {isRegister ? (
            <label className="block space-y-1.5" htmlFor="account-password-confirm">
              <span className="text-xs font-bold text-[var(--text-secondary)]">确认密码</span>
              <input id="account-password-confirm" className="field w-full" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="new-password" maxLength={128} placeholder="再次输入密码" />
            </label>
          ) : null}

          {isRegister ? (
            <>
              <label className="block space-y-1.5" htmlFor="account-email">
                <span className="text-xs font-bold text-[var(--text-secondary)]">邮箱（选填）</span>
                <input id="account-email" className="field w-full" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" maxLength={320} placeholder="用于接收消息，可稍后在主页添加" />
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <input type="checkbox" checked={emailNotify} onChange={(event) => setEmailNotify(event.target.checked)} />
                <span>验证邮箱后接收消息通知</span>
              </label>
            </>
          ) : null}

          {captchaLoading ? <div className="captcha-loading"><div className="spinner" /><span>正在加载安全验证...</span></div> : null}
          {captchaError ? <div className="info-callout status-danger p-3 text-sm">{captchaError}</div> : null}
          {!captchaLoading && !captchaError && captcha.enabled ? (
            <div className="space-y-2"><span className="text-xs font-bold text-[var(--text-secondary)]">人机验证</span><CaptchaWidget provider={captcha.provider} siteKey={captcha.site_key} onToken={setCaptchaToken} resetKey={captchaResetKey} /></div>
          ) : null}

          <button className="btn btn-primary mt-2 w-full justify-center py-2.5" type="submit" disabled={submitting || captchaLoading || Boolean(captchaError) || (captcha.enabled && !captchaToken)}>
            <i className={`bi ${isRegister ? 'bi-person-plus' : 'bi-box-arrow-in-right'}`} />
            <span>{submitting ? (isRegister ? '正在提交...' : '正在登录...') : (isRegister ? '提交注册审核' : '用户名密码登录')}</span>
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between border-t border-[var(--border-color)] pt-4 text-xs">
          <Link className="font-semibold text-[var(--primary-color)] hover:underline" to="/wall">← 返回校园动态</Link>
          <Link className="text-[var(--text-muted)] hover:underline" to="/admin/login">管理员入口</Link>
        </div>
      </section>
    </div>
  )
}
