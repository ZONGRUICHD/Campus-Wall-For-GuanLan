import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import api from '../../services/api'
import { useAlert } from '../../contexts/AlertContext.jsx'

export default function AdminLogin() {
  const [form, setForm] = useState({ username: '', password: '' })
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const alert = useAlert()

  const submit = async (event) => {
    event.preventDefault()
    setLoading(true)
    try {
      const response = await api.adminLogin(form)
      if (response.data?.success) {
        localStorage.setItem('admin_user', form.username)
        navigate(location.state?.from?.pathname || '/admin', { replace: true })
      } else {
        alert.showTopRightAlert(response.data?.error || '登录失败', 'warning', '错误')
      }
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '登录失败')
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
          <p className="mt-1 text-sm text-muted">后台入口不会在前台导航展示。</p>
        </div>
        <label className="block">
          <span className="mb-2 block text-sm font-bold">用户名</span>
          <input className="field" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="请输入管理员用户名" autoComplete="username" />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-bold">密码</span>
          <input className="field" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="请输入密码" autoComplete="current-password" />
        </label>
        <button className="btn btn-primary w-full" disabled={loading} type="submit"><i className="bi bi-box-arrow-in-right" />{loading ? '登录中...' : '登录后台'}</button>
        <div className="flex items-center justify-between gap-3 text-sm">
          <Link to="/">返回首页</Link>
          <Link to="/help">遇到问题？</Link>
        </div>
      </form>
    </div>
  )
}
