import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { usePlatform } from '../contexts/PlatformContext.jsx'

const getSystemTheme = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
const themeStorageKey = 'theme-preference'
const themeModes = new Set(['system', 'light', 'dark'])
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
const getScrollBehavior = () => (
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
)

export default function Layout() {
  const [themeMode, setThemeMode] = useState(readThemeMode)
  const [systemTheme, setSystemTheme] = useState(getSystemTheme)
  const [menuOpen, setMenuOpen] = useState(false)
  const { community } = usePlatform()
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
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: getScrollBehavior() })
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
          {/* Brand Mark */}
          <Link to="/" className="brand-link" aria-label="龙华区观澜中学校园墙首页">
            <span className="brand-mark shrink-0" aria-hidden="true">
              <i className="bi bi-chat-heart-fill" />
            </span>
            <div className="brand-copy flex flex-col leading-tight">
              <span className="font-semibold text-[var(--text-primary)]">观澜中学</span>
              <span className="text-[0.62rem] font-medium text-[var(--text-muted)] tracking-wide">龙华区 · 校园墙</span>
            </div>
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

            <button
              className="btn btn-sm btn-outline px-2.5"
              type="button"
              onClick={toggleTheme}
              aria-label="切换主题"
              title={themeMode === 'system' ? '当前跟随系统，点击手动切换' : '切换主题'}
            >
              <i className={`theme-icon bi ${resolvedTheme === 'dark' ? 'bi-sun-fill' : 'bi-moon-stars-fill'} text-base`} aria-hidden="true" />
            </button>

            {/* Mobile Menu Hamburger */}
            <button
              className="mobile-menu-toggle btn btn-sm btn-outline px-2"
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={menuOpen ? '关闭导航菜单' : '打开导航菜单'}
              aria-expanded={menuOpen}
              aria-controls="mobile-site-navigation"
            >
              <i className={`bi ${menuOpen ? 'bi-x-lg' : 'bi-list'} text-lg`} />
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {menuOpen ? (
          <nav id="mobile-site-navigation" className="mobile-nav-drawer space-y-2 border-t border-[var(--border-color)] p-4" aria-label="移动端导航">
            <NavLink className="nav-link w-full" to="/" end onClick={() => setMenuOpen(false)}>
              <i className="bi bi-house" />
              <span>首页</span>
            </NavLink>
            <NavLink className="nav-link w-full" to="/wall" onClick={() => setMenuOpen(false)}>
              <i className="bi bi-chat-square-dots" />
              <span>校园动态</span>
            </NavLink>
            <NavLink className="nav-link w-full" to="/confessions" onClick={() => setMenuOpen(false)}>
              <i className="bi bi-heart" />
              <span>表白墙</span>
            </NavLink>
            <NavLink className="nav-link w-full" to="/lost-found" onClick={() => setMenuOpen(false)}>
              <i className="bi bi-search" />
              <span>失物招领</span>
            </NavLink>
            <NavLink className="nav-link w-full" to="/p" onClick={() => setMenuOpen(false)}>
              <i className="bi bi-hash" />
              <span>话题分类</span>
            </NavLink>
            <NavLink className="nav-link w-full" to="/help" onClick={() => setMenuOpen(false)}>
              <i className="bi bi-life-preserver" />
              <span>帮助反馈</span>
            </NavLink>
          </nav>
        ) : null}
      </header>

      <main className="page-wrap">
        <Outlet />
      </main>

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
          <span className="footer-tagline text-[var(--text-muted)]">
            让校园里的每一次表达都被温柔倾听 · 校内互助交流平台
          </span>
        </div>
      </footer>
    </div>
  )
}
