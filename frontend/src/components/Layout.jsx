import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useUser } from '../contexts/UserContext.jsx'
import { usePlatform } from '../contexts/PlatformContext.jsx'

const getSystemTheme = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
const themeStorageKey = 'theme-preference'

export default function Layout() {
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem(themeStorageKey) || 'system')
  const [systemTheme, setSystemTheme] = useState(getSystemTheme)
  const [menuOpen, setMenuOpen] = useState(false)
  const { user, notificationUnread } = useUser()
  const { community } = usePlatform()
  const navigate = useNavigate()
  const location = useLocation()

  const resolvedTheme = useMemo(() => themeMode === 'system' ? systemTheme : themeMode, [themeMode, systemTheme])
  const canPublish = community.posting_enabled && (Boolean(user) || community.guest_posting_enabled)
  const publishDisabledReason = !community.posting_enabled
    ? (community.pause_reason || '管理员暂时关闭了发帖功能')
    : '当前仅登录学生可以发帖'

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return undefined
    const handler = (event) => setSystemTheme(event.matches ? 'dark' : 'light')
    media.addEventListener?.('change', handler)
    media.addListener?.(handler)
    return () => {
      media.removeEventListener?.('change', handler)
      media.removeListener?.(handler)
    }
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    localStorage.setItem(themeStorageKey, themeMode)
  }, [themeMode])

  useEffect(() => {
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [location.pathname])

  const toggleTheme = () => {
    setThemeMode(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  const openPublish = () => {
    if (location.pathname !== '/wall') {
      navigate('/wall')
      window.setTimeout(() => window.dispatchEvent(new Event('open-publish-modal')), 80)
    } else {
      window.dispatchEvent(new Event('open-publish-modal'))
    }
  }

  return (
    <div className="app-shell">
      <header className="app-navbar">
        <div className="navbar-inner">
          <Link to="/" className="brand-link">
            <span className="brand-mark">
              <i className="bi bi-chat-heart-fill" />
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-base font-black tracking-tight text-[var(--text-primary)] md:text-lg">校园墙</span>
              <span className="text-[0.68rem] font-medium text-[var(--text-muted)] tracking-wider">CAMPUS WALL</span>
            </div>
          </Link>

          <button
            className="nav-menu-toggle btn btn-sm btn-outline"
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="打开导航菜单"
            aria-expanded={menuOpen}
          >
            <i className={`bi ${menuOpen ? 'bi-x-lg' : 'bi-list'} text-lg`} />
          </button>

          <nav className={`site-nav ${menuOpen ? 'is-open' : ''}`}>
            <NavLink className="nav-link" to="/">
              <i className="bi bi-house" />首页
            </NavLink>
            <NavLink className="nav-link" to="/wall">
              <i className="bi bi-chat-square-dots" />校园墙
            </NavLink>
            <NavLink className="nav-link" to="/apps">
              <i className="bi bi-grid-fill" />应用广场
            </NavLink>
            <NavLink className="nav-link" to="/help">
              <i className="bi bi-life-preserver" />帮助反馈
            </NavLink>

            <NavLink className="nav-link md:hidden" to={user ? '/me' : '/login'}>
              <i className="bi bi-person-circle" />
              {user ? (user.nickname || '个人中心') : '学生登录'}
            </NavLink>

            {user ? (
              <NavLink className="nav-link md:hidden" to="/me/notifications">
                <i className="bi bi-bell" />
                消息通知
                {notificationUnread ? <span className="badge ml-auto">{notificationUnread > 99 ? '99+' : notificationUnread}</span> : null}
              </NavLink>
            ) : null}

            <button className="nav-link mobile-theme-toggle" type="button" onClick={toggleTheme}>
              <i className={`bi ${resolvedTheme === 'dark' ? 'bi-sun-fill text-amber-400' : 'bi-moon-stars-fill text-indigo-500'}`} />
              {resolvedTheme === 'dark' ? '切换为亮色模式' : '切换为暗色模式'}
            </button>
          </nav>

          <div className="nav-actions">
            <button
              className="btn btn-sm btn-primary px-4 shadow-sm"
              type="button"
              onClick={openPublish}
              disabled={!canPublish}
              title={canPublish ? '发布留言' : publishDisabledReason}
            >
              <i className="bi bi-pencil-square" />
              <span>发布留言</span>
            </button>

            {user ? (
              <>
                <Link
                  to="/me/notifications"
                  className="btn btn-sm btn-outline relative px-2.5"
                  title={notificationUnread ? `${notificationUnread} 条未读通知` : '消息通知'}
                  aria-label={notificationUnread ? `消息通知，${notificationUnread} 条未读` : '消息通知'}
                >
                  <i className={`bi ${notificationUnread ? 'bi-bell-fill text-[var(--primary-color)]' : 'bi-bell'}`} />
                  {notificationUnread ? (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[0.62rem] font-bold leading-none text-white">
                      {notificationUnread > 99 ? '99+' : notificationUnread}
                    </span>
                  ) : null}
                </Link>
                <Link
                  to="/me"
                  className="btn btn-sm btn-outline flex items-center gap-2 py-1 px-2.5"
                  title="个人中心"
                >
                  {user.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt={user.nickname}
                      className="h-5 w-5 rounded-full object-cover"
                    />
                  ) : (
                    <i className="bi bi-person-fill text-primary" />
                  )}
                  <span className="max-w-[80px] truncate text-xs font-semibold">{user.nickname || '个人中心'}</span>
                </Link>
              </>
            ) : (
              <Link to="/login" className="btn btn-sm btn-outline" title="学生登录">
                <i className="bi bi-box-arrow-in-right" />
                <span>登录</span>
              </Link>
            )}

            <button
              className="btn btn-sm btn-outline px-2.5"
              type="button"
              onClick={toggleTheme}
              aria-label="切换主题"
              title={themeMode === 'system' ? '当前跟随系统，点击手动切换' : '切换主题'}
            >
              <i className={`bi ${resolvedTheme === 'dark' ? 'bi-sun-fill text-amber-400' : 'bi-moon-stars-fill text-indigo-500'} text-base`} />
            </button>
          </div>
        </div>
      </header>

      <main className="page-wrap">
        <Outlet />
      </main>

      <footer className="app-footer">
        <div className="mx-auto max-w-4xl space-y-3">
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-[var(--text-muted)]">
            <Link to="/" className="hover:text-[var(--primary-color)]">首页</Link>
            <span>•</span>
            <Link to="/wall" className="hover:text-[var(--primary-color)]">校园墙</Link>
            <span>•</span>
            <Link to="/apps" className="hover:text-[var(--primary-color)]">应用广场</Link>
            <span>•</span>
            <Link to="/help" className="hover:text-[var(--primary-color)]">帮助与反馈</Link>
            <span>•</span>
            <Link to="/rules" className="hover:text-[var(--primary-color)]">社区公约</Link>
          </div>
          <p className="text-sm font-bold text-[var(--text-primary)]">
            校园墙
          </p>
          <span className="text-xs text-[var(--text-muted)]">
            让校园里的每一次表达都被温柔倾听 · 非官方学生互助交流平台
          </span>
        </div>
      </footer>
    </div>
  )
}
