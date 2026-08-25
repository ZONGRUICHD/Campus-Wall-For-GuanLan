import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { usePlatform } from '../contexts/PlatformContext.jsx'
import { useUser } from '../contexts/UserContext.jsx'

const getSystemTheme = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
const themeStorageKey = 'theme-preference'
const themeModes = new Set(['system', 'light', 'dark'])
const privilegedRoles = new Set(['reviewer', 'admin', 'super_admin'])
const readThemeMode = () => {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = window.localStorage.getItem(themeStorageKey)
    return themeModes.has(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}
const persistThemeMode = (mode) => {
  try {
    window.localStorage.setItem(themeStorageKey, mode)
  } catch {
    // Storage can be unavailable in private or sandboxed browsing contexts.
  }
}
export default function Layout() {
  const [themeMode, setThemeMode] = useState(readThemeMode)
  const [systemTheme, setSystemTheme] = useState(getSystemTheme)
  const { community } = usePlatform()
  const { user, loading: userLoading, notificationUnread } = useUser()
  const navigate = useNavigate()
  const location = useLocation()

  const resolvedTheme = useMemo(() => themeMode === 'system' ? systemTheme : themeMode, [themeMode, systemTheme])
  const canPublish = community.posting_enabled
  const publishDisabledReason = community.pause_reason || '管理员暂时关闭了发帖功能'

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return undefined
    const handler = (event) => setSystemTheme(event.matches ? 'dark' : 'light')
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handler)
      return () => media.removeEventListener('change', handler)
    }
    media.addListener?.(handler)
    return () => media.removeListener?.(handler)
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme)
    const themeMeta = document.querySelector('meta[name="theme-color"]')
    if (themeMeta) themeMeta.setAttribute('content', resolvedTheme === 'dark' ? '#000000' : '#f5f5f7')
  }, [resolvedTheme])

  useEffect(() => {
    persistThemeMode(themeMode)
  }, [themeMode])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [location.pathname])

  const toggleTheme = () => {
    setThemeMode(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  const openPublish = () => {
    if (location.pathname !== '/wall') {
      navigate('/wall', { state: { openPublish: true } })
    } else {
      window.dispatchEvent(new Event('open-publish-modal'))
    }
  }

  const accountDestination = user ? '/me' : '/login'
  const accountLabel = '我的'
  const unreadLabel = notificationUnread > 99 ? '99+' : notificationUnread
  const hasAdminAccess = privilegedRoles.has(user?.role)
  const adminDestination = user?.role === 'reviewer' ? '/admin/wall' : '/admin'
  const adminLabel = user?.role === 'reviewer' ? '运营后台' : '管理后台'

  return (
    <div className="app-shell">
      <header className="app-navbar">
        <div className="navbar-inner">
          {/* Brand Mark */}
          <Link to="/" className="brand-link" aria-label="龙华区观澜中学校园墙首页">
            <span className="brand-mark shrink-0" aria-hidden="true">
              <i className="bi bi-chat-heart-fill" />
            </span>
            <span className="brand-copy font-semibold text-[var(--text-primary)]">观澜中学</span>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="site-nav desktop-site-nav" aria-label="主导航">
            <NavLink className="nav-link" to="/" end>
              <i className="bi bi-house" />
              <span>首页</span>
            </NavLink>
            <NavLink className="nav-link" to="/wall">
              <i className="bi bi-chat-square-dots" />
              <span>动态</span>
            </NavLink>
            <NavLink className="nav-link" to="/confessions">
              <i className="bi bi-heart" />
              <span>表白墙</span>
            </NavLink>
            <NavLink className="nav-link" to="/lost-found">
              <i className="bi bi-search" />
              <span>失物招领</span>
            </NavLink>
            <NavLink className="nav-link" to="/p">
              <i className="bi bi-hash" />
              <span>话题</span>
            </NavLink>
            <NavLink className="nav-link" to="/help">
              <i className="bi bi-life-preserver" />
              <span>帮助反馈</span>
            </NavLink>
          </nav>

          {/* Right Action Icons */}
          <div className="navbar-actions flex shrink-0 items-center gap-1.5 sm:gap-2.5">
            {!userLoading && hasAdminAccess ? (
              <Link
                className="btn btn-sm btn-outline px-2.5 sm:px-3"
                to={adminDestination}
                aria-label={`进入${adminLabel}`}
                title={`进入${adminLabel}`}
              >
                <i className="bi bi-shield-check" />
                <span className="sm:hidden">{user?.role === 'reviewer' ? '后台' : '管理'}</span>
                <span className="hidden sm:inline">{adminLabel}</span>
              </Link>
            ) : null}

            <button
              className="btn btn-sm btn-primary px-3 sm:px-3.5"
              type="button"
              onClick={openPublish}
              disabled={!canPublish}
              title={canPublish ? '发布留言' : publishDisabledReason}
            >
              <i className="bi bi-pencil-square" />
              <span className="hidden sm:inline">发布动态</span>
              <span className="mobile-publish-label sm:hidden">发帖</span>
            </button>

            {!userLoading ? (
              <Link
                className="btn btn-sm btn-outline hidden px-3 sm:inline-flex"
                to={user ? '/me' : '/login'}
                aria-label={user ? `打开 ${user.nickname || user.username} 的个人中心` : '登录或注册'}
              >
                <i className={`bi ${user ? 'bi-person-circle' : 'bi-box-arrow-in-right'}`} />
                <span className="max-w-24 truncate">{user ? (user.nickname || user.username) : '登录'}</span>
                {user && notificationUnread > 0 ? <span className="badge status-danger">{notificationUnread > 99 ? '99+' : notificationUnread}</span> : null}
              </Link>
            ) : null}

            <button
              className="btn btn-sm btn-outline px-2.5"
              type="button"
              onClick={toggleTheme}
              aria-label="切换主题"
              title={themeMode === 'system' ? '当前跟随系统，点击手动切换' : '切换主题'}
            >
              <i className={`theme-icon bi ${resolvedTheme === 'dark' ? 'bi-sun-fill' : 'bi-moon-stars-fill'} text-base`} aria-hidden="true" />
            </button>

          </div>
        </div>
      </header>

      <main className="page-wrap">
        <div className="route-transition" key={location.pathname}>
          <Outlet />
        </div>
      </main>

      <nav className="mobile-tab-bar" aria-label="移动端主导航">
        <NavLink className="mobile-tab-item" to="/" end>
          <span className="mobile-tab-icon" aria-hidden="true"><i className="bi bi-house" /></span>
          <span className="mobile-tab-label">首页</span>
        </NavLink>
        <NavLink className="mobile-tab-item" to="/wall">
          <span className="mobile-tab-icon" aria-hidden="true"><i className="bi bi-chat-square-dots" /></span>
          <span className="mobile-tab-label">动态</span>
        </NavLink>
        <NavLink className="mobile-tab-item" to="/confessions">
          <span className="mobile-tab-icon" aria-hidden="true"><i className="bi bi-heart" /></span>
          <span className="mobile-tab-label">表白</span>
        </NavLink>
        <NavLink className="mobile-tab-item" to="/lost-found">
          <span className="mobile-tab-icon" aria-hidden="true"><i className="bi bi-search" /></span>
          <span className="mobile-tab-label">失物</span>
        </NavLink>
        <NavLink
          className="mobile-tab-item"
          to={accountDestination}
          aria-label={user
            ? (notificationUnread > 0 ? `${accountLabel}，${notificationUnread} 条未读通知` : accountLabel)
            : `${accountLabel}，登录后查看`}
        >
          <span className="mobile-tab-icon" aria-hidden="true">
            <i className={`bi ${user ? 'bi-person-circle' : 'bi-person'}`} />
            {user && notificationUnread > 0 ? <span className="mobile-tab-badge">{unreadLabel}</span> : null}
          </span>
          <span className="mobile-tab-label">{accountLabel}</span>
        </NavLink>
      </nav>

      <footer className="app-footer">
        <div className="mx-auto max-w-4xl space-y-3">
          <nav className="footer-links" aria-label="页脚导航">
            <Link to="/" className="hover:text-[var(--primary-color)]">首页</Link>
            <span className="footer-separator" aria-hidden="true">•</span>
            <Link to="/wall" className="hover:text-[var(--primary-color)]">校园动态</Link>
            <span className="footer-separator" aria-hidden="true">•</span>
            <Link to="/confessions" className="hover:text-[var(--primary-color)]">表白墙</Link>
            <span className="footer-separator" aria-hidden="true">•</span>
            <Link to="/lost-found" className="hover:text-[var(--primary-color)]">失物招领</Link>
            <span className="footer-separator" aria-hidden="true">•</span>
            <Link to="/help" className="hover:text-[var(--primary-color)]">帮助与反馈</Link>
            <span className="footer-separator" aria-hidden="true">•</span>
            <Link to="/rules" className="hover:text-[var(--primary-color)]">社区公约</Link>
          </nav>
          <p className="footer-brand text-sm font-semibold text-[var(--text-primary)]">
            龙华区观澜中学 · 校园墙
          </p>
        </div>
      </footer>
    </div>
  )
}
