import { useEffect, useMemo } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAlert } from '../contexts/AlertContext.jsx'
import { useUser } from '../contexts/UserContext.jsx'
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
  not_configured: '飞书登录暂未配置，请稍后再试。'
}

export default function Login() {
  const { user, loading } = useUser()
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

  useEffect(() => {
    if (!feishuError) return undefined
    alert.showTopRightAlert(feishuErrorText[feishuError] || feishuErrorText.oauth_failed, 'warning', '飞书登录失败')
    navigate({ pathname: '/login', search: '', hash: '' }, { replace: true, state: location.state })
    return undefined
  }, [alert, feishuError, location.state, navigate])

  if (!loading && user) return <Navigate to={destination} replace />

  return (
    <div className="mx-auto grid max-w-5xl items-center gap-8 py-6 lg:grid-cols-[1.1fr_420px]">
      <section className="auth-hero order-2 flex flex-col justify-center space-y-6 p-7 md:p-10 lg:order-1">
        <div className="space-y-4">
          <span className="page-kicker"><i className="bi bi-person-check" /><span>校园账号</span></span>
          <h1 className="text-3xl font-black tracking-tight text-[var(--text-primary)] md:text-4xl">用飞书进入校园墙</h1>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)] md:text-base">
            电脑打开后扫码，手机一般会跳转飞书 App。只有指定校园墙飞书群的成员可以登录。普通动态仍可匿名浏览与发布；失物招领需要登录。
          </p>
        </div>

        <div className="auth-note-grid">
          <div className="auth-note flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-light)] text-[var(--primary-color)]"><i className="bi bi-box-arrow-in-right text-lg" /></div>
            <div><b className="text-sm font-bold">官方授权页</b><p className="mt-0.5 text-xs text-[var(--text-muted)]">使用飞书扫码或 App 跳转，不在站内嵌加群二维码。</p></div>
          </div>
          <div className="auth-note flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--secondary-light)] text-[var(--secondary-color)]"><i className="bi bi-people text-lg" /></div>
            <div><b className="text-sm font-bold">进群才能用</b><p className="mt-0.5 text-xs text-[var(--text-muted)]">登录时校验你是否仍在指定内部群；退群后下次无法进入。</p></div>
          </div>
          <div className="auth-note flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500"><i className="bi bi-search text-lg" /></div>
            <div><b className="text-sm font-bold">失物招领可追溯</b><p className="mt-0.5 text-xs text-[var(--text-muted)]">登录后才能查看与发布启事，减少无效信息。</p></div>
          </div>
        </div>
      </section>

      <section className="card relative order-1 overflow-hidden p-6 shadow-xl sm:p-8 lg:order-2">
        <div className="mb-6 space-y-1">
          <span className="page-kicker text-xs"><i className="bi bi-box-arrow-in-right" /><span>Welcome</span></span>
          <h2 className="text-2xl font-black text-[var(--text-primary)]">飞书登录</h2>
          <p className="text-xs text-[var(--text-muted)]">对外注册已关闭。审核员和管理员请使用后台入口。</p>
        </div>

        <a className="btn btn-primary mt-2 w-full justify-center py-2.5" href={startHref}>
          <i className="bi bi-box-arrow-in-right" />
          <span>使用飞书登录</span>
        </a>

        <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
          点击后将前往飞书官方授权页。授权完成会返回本站。
        </p>

        <div className="mt-6 flex items-center justify-between border-t border-[var(--border-color)] pt-4 text-xs">
          <Link className="font-semibold text-[var(--primary-color)] hover:underline" to="/wall">← 返回校园动态</Link>
          <Link className="text-[var(--text-muted)] hover:underline" to="/admin/login">管理员入口</Link>
        </div>
      </section>
    </div>
  )
}
