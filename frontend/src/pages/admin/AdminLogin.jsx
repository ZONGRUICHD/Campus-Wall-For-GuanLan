import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import CaptchaWidget from '../../components/CaptchaWidget.jsx'
import api from '../../services/api'
import { useAlert } from '../../contexts/AlertContext.jsx'
import { useUser } from '../../contexts/UserContext.jsx'

export default function AdminLogin() {
  const [form, setForm] = useState({ username: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [captcha, setCaptcha] = useState({ enabled: false, provider: 'none', site_key: '' })
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [captchaLoading, setCaptchaLoading] = useState(true)
  const [captchaError, setCaptchaError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const alert = useAlert()
  const { refreshMe } = useUser()
  const captchaRequired = captcha.enabled && captcha.protected_actions?.admin_login !== false

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

  const submit = async (event) => {
    event.preventDefault()
    if (captchaRequired && !captchaToken) {
      alert.showTopRightAlert('请先完成人机验证', 'warning', '提示')
      return
    }
    setLoading(true)
    try {
      const response = await api.adminLogin({ ...form, captcha_token: captchaToken })
      if (response.data?.success) {
        localStorage.setItem('admin_user', form.username)
        await refreshMe()
        const from = location.state?.from
        const destination = from?.pathname
          ? `${from.pathname}${from.search || ''}${from.hash || ''}`
          : '/admin'
        navigate(destination, { replace: true })
      } else {
        alert.showTopRightAlert(response.data?.error || '登录失败', 'warning', '错误')
      }
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '登录失败')
      if (captchaRequired) {
        setCaptchaToken('')
        setCaptchaResetKey((value) => value + 1)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-login-shell grid items-stretch gap-6 lg:grid-cols-[1fr_420px]">
      <section className="auth-hero flex flex-col justify-center p-8">
        <div className="auth-copy max-w-xl">
          <span className="page-kicker"><i className="bi bi-shield-lock" />管理后台</span>
          <h1 className="mt-5 text-4xl font-black">观澜中学校园墙运营入口</h1>
          <p className="mt-4 max-w-lg text-lg text-muted">用于审核留言、管理公告、处理举报和维护用户账号。请确认你正在使用可信设备。</p>
        </div>
        <div className="auth-note-grid">
          <div className="auth-note"><b>审核</b><p className="mt-1 text-sm text-muted">快速处理留言状态</p></div>
          <div className="auth-note"><b>公告</b><p className="mt-1 text-sm text-muted">发布前台通知</p></div>
          <div className="auth-note"><b>安全</b><p className="mt-1 text-sm text-muted">登录态由服务端校验</p></div>
        </div>
      </section>

      <form className="card admin-login-card space-y-4 p-6" onSubmit={submit}>
        <div>
          <span className="page-kicker"><i className="bi bi-key" />Admin</span>
          <h2 className="mt-3 text-2xl font-bold">管理员登录</h2>
          <p className="mt-1 text-sm text-muted">仅供审核员、管理员和超级管理员使用用户名密码。普通师生请回到前台使用飞书或用户名密码登录。</p>
        </div>
        <label className="block">
          <span className="mb-2 block text-sm font-bold">用户名</span>
          <input className="field" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="请输入管理员用户名" autoComplete="username" />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-bold">密码</span>
          <input className="field" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="请输入密码" autoComplete="current-password" />
        </label>
        {captchaLoading ? <div className="captcha-loading"><div className="spinner" /><span>正在加载安全验证...</span></div> : null}
        {captchaError ? <div className="info-callout status-danger p-3 text-sm">{captchaError}</div> : null}
        {!captchaLoading && !captchaError && captchaRequired ? (
          <div className="space-y-2"><span className="text-xs font-bold text-[var(--text-secondary)]">Cloudflare 人机验证</span><CaptchaWidget action="admin_login" provider={captcha.provider} siteKey={captcha.site_key} onToken={setCaptchaToken} resetKey={captchaResetKey} /></div>
        ) : null}
        <button className="btn btn-primary w-full" disabled={loading || captchaLoading || Boolean(captchaError) || (captchaRequired && !captchaToken)} type="submit"><i className="bi bi-box-arrow-in-right" />{loading ? '登录中...' : '登录后台'}</button>
        <div className="flex items-center justify-between gap-3 text-sm">
          <Link to="/login">师生登录</Link>
          <Link to="/help">遇到问题？</Link>
        </div>
      </form>
    </div>
  )
}
