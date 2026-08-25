import { useEffect, useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useUser } from '../contexts/UserContext.jsx'

const links = [
  { to: '/admin', icon: 'bi-speedometer2', label: '仪表盘', capabilities: ['dashboard.read'] },
  { to: '/admin/wall', icon: 'bi-chat-quote', label: '帖子审核', capabilities: ['content.queue.read'] },
  { to: '/admin/confessions', icon: 'bi-heart', label: '表白墙审核', capabilities: ['content.queue.read'] },
  { to: '/admin/comments', icon: 'bi-chat-left-dots', label: '评论管理', capabilities: ['content.comment.read'] },
  { to: '/admin/trash', icon: 'bi-trash3', label: '内容回收站', capabilities: ['content.trash.read'] },
  { to: '/admin/users', icon: 'bi-people', label: '用户与权限', capabilities: ['users.read'] },
  { to: '/admin/notice', icon: 'bi-megaphone', label: '公告管理', capabilities: ['notice.read'] },
  { to: '/admin/feedback', icon: 'bi-life-preserver', label: '反馈工单', capabilities: ['feedback.read'] },
  { to: '/admin/report', icon: 'bi-flag', label: '举报管理', capabilities: ['report.read'] },
  { to: '/admin/log', icon: 'bi-file-text', label: '管理员日志', capabilities: ['logs.legacy_admin.read'] },
  { to: '/admin/audit', icon: 'bi-clock-history', label: '操作审计', capabilities: ['audit.read'] },
  { to: '/admin/error_log', icon: 'bi-exclamation-triangle', label: '错误日志', capabilities: ['logs.error.read'] },
  { to: '/admin/settings', icon: 'bi-gear', label: '平台设置', capabilities: ['settings.read'] }
]

export default function AdminShell({ children, title }) {
  const navigate = useNavigate()
  const { refreshMe } = useUser()
  const [menuOpen, setMenuOpen] = useState(false)
  const [admin, setAdmin] = useState(null)

  useEffect(() => {
    let alive = true
    const refreshAdmin = () => {
      api.adminVerify().then((response) => {
        if (alive) setAdmin(response.data?.admin || null)
      }).catch(() => {
        if (alive) setAdmin(null)
      })
    }
    refreshAdmin()
    window.addEventListener('admin-session-updated', refreshAdmin)
    return () => {
      alive = false
      window.removeEventListener('admin-session-updated', refreshAdmin)
    }
  }, [])

  const visibleLinks = useMemo(() => {
    const allowed = new Set(admin?.capabilities || [])
    return links.filter((link) => link.capabilities.some((capability) => allowed.has(capability)))
  }, [admin])
  const logout = async () => {
    try {
      await api.adminLogout()
    } finally {
      await refreshMe()
      window.dispatchEvent(new Event('admin-session-updated'))
      localStorage.removeItem('admin_user')
      navigate('/admin/login', { replace: true })
    }
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <h2 className="text-xl font-bold">观澜中学后台</h2>
          <button className="admin-sidebar-toggle btn btn-sm btn-outline" type="button" aria-label={menuOpen ? '收起管理菜单' : '展开管理菜单'} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            <i className={`bi ${menuOpen ? 'bi-x-lg' : 'bi-list'}`} />
          </button>
        </div>
        <div className={`admin-sidebar-content ${menuOpen ? 'is-open' : ''}`}>
          <nav className="space-y-2">
            {visibleLinks.map(({ to, icon, label }) => (
              <NavLink key={to} to={to} end={to === '/admin'} className="nav-link w-full" onClick={() => setMenuOpen(false)}>
                <i className={`bi ${icon}`} />{label}
              </NavLink>
            ))}
          </nav>
          <hr className="admin-sidebar-divider my-5" />
          {admin?.username ? <p className="mb-3 truncate px-2 text-xs text-muted"><i className="bi bi-person-check mr-1" />{admin.username}</p> : null}
          <button className="btn admin-logout-btn w-full" type="button" onClick={logout}>
            <i className="bi bi-box-arrow-right" />退出登录
          </button>
        </div>
      </aside>
      <section className="admin-main">
        <div className="card admin-main-card p-5">
          {title ? <h1 className="mb-5 text-2xl font-bold">{title}</h1> : null}
          {children}
        </div>
      </section>
    </div>
  )
}
