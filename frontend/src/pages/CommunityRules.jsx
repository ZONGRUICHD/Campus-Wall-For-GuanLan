import { Link } from 'react-router-dom'
import { usePlatform } from '../contexts/PlatformContext.jsx'

export default function CommunityRules() {
  const { community, loading } = usePlatform()
  const rules = String(community.community_rules || '')
    .split(/\r?\n/)
    .map((rule) => rule.trim())
    .filter(Boolean)

  const paused = !community.posting_enabled || !community.commenting_enabled

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="hero-section px-8 py-12 text-center">
        <div className="hero-content space-y-3">
          <span className="page-kicker hero-kicker"><i className="bi bi-shield-check" />Community Guidelines</span>
          <h1 className="text-3xl font-black text-white md:text-4xl">校园墙社区公约</h1>
          <p className="hero-subtitle mx-auto max-w-xl text-sm">自由表达与彼此尊重可以同时存在，每一位参与者都在共同塑造这里的氛围。</p>
        </div>
      </section>

      {paused ? (
        <div className="info-callout status-warning">
          <i className="bi bi-info-circle-fill" />
          <span>{community.pause_reason || '部分互动功能目前由管理员暂时关闭，请稍后再试。'}</span>
        </div>
      ) : null}

      <section className="card overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-color)] px-6 py-5">
          <div>
            <h2 className="text-xl font-black">交流准则</h2>
            <p className="mt-1 text-xs text-muted">规则由平台管理员维护，适用于留言、评论和投票内容。</p>
          </div>
          <span className="badge status-success"><i className="bi bi-check-circle-fill mr-1" />当前有效</span>
        </header>
        <div className="space-y-3 p-6">
          {loading ? <div className="page-center"><div className="spinner" /></div> : null}
          {!loading && rules.length ? rules.map((rule, index) => (
            <div className="card-flat flex items-start gap-4 p-4" key={`${index}-${rule}`}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary-light)] text-sm font-black text-[var(--primary-color)]">{index + 1}</span>
              <p className="pt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{rule}</p>
            </div>
          )) : null}
          {!loading && !rules.length ? <p className="py-8 text-center text-sm text-muted">管理员暂未发布额外社区规则。</p> : null}
        </div>
      </section>

      <div className="flex flex-wrap justify-center gap-3">
        <Link className="btn btn-primary" to="/wall"><i className="bi bi-chat-square-dots" />进入校园墙</Link>
        <Link className="btn btn-outline" to="/help"><i className="bi bi-life-preserver" />帮助与反馈</Link>
      </div>
    </div>
  )
}
