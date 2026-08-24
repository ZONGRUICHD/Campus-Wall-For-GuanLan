import { useEffect, useState } from 'react'
import api from '../services/api'

const safeBackgroundImage = (value = '') => {
  const image = String(value).trim().replace(/;$/, '')
  return /^(linear-gradient|radial-gradient)\(/i.test(image) ? image : undefined
}

const safeExternalUrl = (value = '') => {
  try {
    const url = new URL(String(value), window.location.origin)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '#'
  } catch {
    return '#'
  }
}

export default function Apps() {
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getApps()
      .then((response) => setApps(response.data?.apps || []))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="apps-page space-y-8">
      {/* Hero */}
      <div className="section-heading space-y-2 py-4">
        <span className="page-kicker">
          <i className="bi bi-grid-3x3-gap-fill text-indigo-500" />
          <span>App Store</span>
        </span>
        <h1 className="section-title text-3xl md:text-4xl">应用广场</h1>
        <p className="text-sm text-[var(--text-secondary)] max-w-lg mx-auto leading-relaxed">
          汇聚学生自主开发的实用工具、学习平台与精彩拓展应用
        </p>
      </div>

      {!loading ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <span className="badge px-4 py-1.5 text-xs font-semibold">
            <i className="bi bi-stars text-amber-400 mr-1" />
            <span>已收录 {apps.length} 款优质应用</span>
          </span>
          <span className="badge px-4 py-1.5 text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
            <i className="bi bi-shield-check mr-1" />
            <span>经由学生管理员审核</span>
          </span>
        </div>
      ) : null}

      {/* Skeletons */}
      {loading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((index) => (
            <div className="card p-6 text-center space-y-4" key={index}>
              <span className="skeleton mx-auto block h-20 w-20 rounded-2xl" />
              <span className="skeleton mx-auto block h-6 w-32" />
              <span className="skeleton mx-auto block h-4 w-48" />
              <span className="skeleton block h-12 w-full" />
              <span className="skeleton block h-9 w-full rounded-xl" />
            </div>
          ))}
        </div>
      ) : null}

      {/* Empty State */}
      {!loading && apps.length === 0 ? (
        <div className="empty-state-card">
          <i className="bi bi-grid" />
          <p className="mt-4 text-base font-bold text-[var(--text-primary)]">应用广场正在筹备中</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">敬请期待更多同学带来的精彩应用！</p>
        </div>
      ) : null}

      {/* Apps Grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {apps.map((app, index) => (
          <article className="card app-gallery-card flex flex-col justify-between p-6 text-center" key={app.name || index}>
            <div className="space-y-4">
              <div
                className="app-icon-frame"
                style={{ backgroundImage: safeBackgroundImage(app.iconBackground) }}
              >
                {app.iconUrl ? (
                  <img src={app.iconUrl} alt={app.name} loading="lazy" />
                ) : (
                  <i className="bi bi-app-indicator" />
                )}
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-center gap-1.5 mb-1.5">
                  <h2 className="text-xl font-bold text-[var(--text-primary)]">{app.name}</h2>
                  {app.partition ? <span className="badge">#{app.partition}</span> : null}
                </div>
                <p className="text-xs text-[var(--text-muted)]">开发者 / 提供方：{app.author || '校园开发者'}</p>
              </div>

              <p className="text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-3 min-h-[48px]">
                {app.appDescription || app.description || '暂无应用详细介绍'}
              </p>
            </div>

            <div className="pt-5 border-t border-[var(--border-color)] mt-4">
              <a
                className="btn btn-primary w-full justify-center shadow-md"
                href={safeExternalUrl(app.url)}
                target="_blank"
                rel="noreferrer"
              >
                <i className="bi bi-box-arrow-up-right" />
                <span>立即打开应用</span>
              </a>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
