import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Fragment, useEffect } from 'react'
import { usePlatform } from '../contexts/PlatformContext.jsx'
import { useUser } from '../contexts/UserContext.jsx'
import { firstAdminDestination } from '../services/permissions.js'
import { navigationModules } from '../modules/registry.jsx'
import ThemePicker from './ThemePicker.jsx'
export default function Layout() {
  const { community, enabledModuleIds } = usePlatform()
  const { user, loading: userLoading, notificationUnread } = useUser()
  const navigate = useNavigate()
  const location = useLocation()

  const wallEnabled = enabledModuleIds.has('wall')
  const canPublish = wallEnabled && community.posting_enabled
  const publishDisabledReason = wallEnabled
    ? (community.pause_reason || '管理员暂时关闭了发帖功能')
    : '校园动态板块当前未启用'
  const desktopModules = navigationModules('desktop', enabledModuleIds)
  const mobileModules = navigationModules('mobile', enabledModuleIds)
  const footerModules = navigationModules('footer', enabledModuleIds)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [location.pathname])

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
  const adminDestination = firstAdminDestination(user)
  const hasAdminAccess = Boolean(adminDestination)
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
            {desktopModules.map((module) => (
              <NavLink className="nav-link" to={module.path} end={module.end} key={module.id}>
                <i className={`bi ${module.icon}`} />
                <span>{module.label}</span>
              </NavLink>
            ))}
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

            {wallEnabled ? (
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
            ) : null}

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

            <ThemePicker />

          </div>
        </div>
      </header>

      <main className="page-wrap">
        <div className="route-transition" key={location.pathname}>
          <Outlet />
        </div>
      </main>

      <nav
        className="mobile-tab-bar"
        aria-label="移动端主导航"
        style={{ gridTemplateColumns: `repeat(${mobileModules.length + 1}, minmax(0, 1fr))` }}
      >
        {mobileModules.map((module) => (
          <NavLink className="mobile-tab-item" to={module.path} end={module.end} key={module.id}>
            <span className="mobile-tab-icon" aria-hidden="true"><i className={`bi ${module.icon}`} /></span>
            <span className="mobile-tab-label">{module.mobileLabel || module.label}</span>
          </NavLink>
        ))}
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
            {footerModules.map((module, index) => (
              <Fragment key={module.id}>
                {index > 0 ? <span className="footer-separator" aria-hidden="true">•</span> : null}
                <Link to={module.path} className="hover:text-[var(--primary-color)]">
                  {module.footerLabel || module.label}
                </Link>
              </Fragment>
            ))}
            {enabledModuleIds.has('help') ? (
              <>
                {footerModules.length ? <span className="footer-separator" aria-hidden="true">•</span> : null}
                <Link to="/rules" className="hover:text-[var(--primary-color)]">社区公约</Link>
              </>
            ) : null}
          </nav>
          <p className="footer-brand text-sm font-semibold text-[var(--text-primary)]">
            龙华区观澜中学 · 校园墙
          </p>
        </div>
      </footer>
    </div>
  )
}
