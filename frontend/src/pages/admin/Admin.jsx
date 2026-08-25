import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminShell from '../../components/AdminShell.jsx'
import api from '../../services/api'

const emptyStats = {
  messages: { total: 0, visible: 0, hidden: 0, deleted: 0, pending_review: 0, pending_posts: 0, pending_confessions: 0, approved: 0, awaiting_publication: 0, pinned: 0, featured: 0, comments: 0, comments_hidden: 0, comments_deleted: 0, likes: 0, dislikes: 0, last_24_hours: 0, last_7_days: 0, daily: [], top_tags: [] },
  community: { posting_enabled: true, commenting_enabled: true, guest_posting_enabled: true, guest_commenting_enabled: true, require_post_approval: false },
  feedback: { total: 0, pending: 0, in_progress: 0, resolved: 0, closed: 0 },
  reports: { total: 0, affected_messages: 0, comment_reports: 0, processed_total: 0, processed_last_7_days: 0 },
  managers: { total: 0, active: 0, disabled: 0, super_admins: 0 },
  trash: { all: 0, messages: 0, comments: 0 },
  audit: { total: 0, last_24_hours: 0, last_7_days: 0 },
  admin_logs: 0
}

const countValue = (value, fallback = 0) => {
  const count = Number(value)
  return Number.isFinite(count) && count >= 0 ? count : fallback
}

const Metric = ({ icon, label, value, detail, tone = 'primary' }) => (
  <div className={`admin-overview-metric admin-overview-metric-${tone}`}>
    <span className="admin-overview-icon"><i className={`bi ${icon}`} /></span>
    <div className="min-w-0">
      <p className="text-sm text-muted">{label}</p>
      <strong>{value}</strong>
      <p className="text-xs text-muted">{detail}</p>
    </div>
  </div>
)

export default function Admin() {
  const [stats, setStats] = useState(emptyStats)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [generatedAt, setGeneratedAt] = useState('')
  const [permissionNames, setPermissionNames] = useState([])
  const [statsUnavailable, setStatsUnavailable] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setStatsUnavailable(false)
    try {
      const session = await api.adminVerify()
      const names = (session.data?.admin?.permissions || []).map((permission) => permission.name)
      setPermissionNames(names)
      try {
        const response = await api.adminGetDashboardStats()
        const nextStats = response.data?.stats || {}
        const nextMessages = nextStats.messages || {}
        const nextManagers = nextStats.managers || {}
        const managerTotal = countValue(nextManagers.total)
        const managerDisabled = countValue(nextManagers.disabled)
        setStats({
          ...emptyStats,
          ...nextStats,
          messages: {
            ...emptyStats.messages,
            ...nextMessages,
            pending_review: nextMessages.pending_review ?? nextMessages.pending ?? 0
          },
          managers: {
            ...emptyStats.managers,
            ...nextManagers,
            total: managerTotal,
            active: countValue(nextManagers.active, Math.max(0, managerTotal - managerDisabled)),
            disabled: managerDisabled,
            super_admins: countValue(nextManagers.super_admins ?? nextManagers.super_admin)
          }
        })
        setGeneratedAt(response.data?.generated_at || new Date().toISOString())
      } catch (statsError) {
        if (!names.includes('review_posts')) throw statsError
        setStatsUnavailable(true)
      }
    } catch (requestError) {
      setError(requestError.message || '统计数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const maxDaily = useMemo(() => Math.max(1, ...(stats.messages.daily || []).map((item) => Number(item.count) || 0)), [stats.messages.daily])
  const interactions = (stats.messages.likes || 0) + (stats.messages.dislikes || 0) + (stats.messages.comments || 0)
  const can = (...names) => names.some((name) => permissionNames.includes(name))
  const canReviewPosts = can('manage_wall_message', 'review_posts')
  const reviewOnly = can('review_posts') && !can('manage_wall_message')

  return (
    <AdminShell title="仪表盘">
      <div className="admin-dashboard-toolbar">
        <div>
          <p className="font-bold">平台运行概览</p>
          <p className="text-xs text-muted">{generatedAt ? `数据生成于 ${new Date(generatedAt).toLocaleString('zh-CN')}` : '正在读取最新数据'}</p>
        </div>
        <button className="btn btn-outline" type="button" disabled={loading} onClick={load}>
          <i className={`bi bi-arrow-repeat ${loading ? 'admin-spin' : ''}`} />刷新
        </button>
      </div>

      {error ? <div className="info-callout status-danger my-4">{error}</div> : null}
      {statsUnavailable ? <div className="info-callout my-4">统计概览暂不可用，不影响内容审核或公告管理。</div> : null}

      <div className="admin-overview-grid mt-5">
        {canReviewPosts && reviewOnly ? <>
          <Metric icon="bi-chat-quote" label="待审核帖子" value={stats.messages.pending_posts} detail="校园动态与其他内容" tone={stats.messages.pending_posts ? 'danger' : 'success'} />
          <Metric icon="bi-heart" label="待审核表白" value={stats.messages.pending_confessions} detail="表白墙便签独立队列" tone={stats.messages.pending_confessions ? 'danger' : 'success'} />
        </> : null}
        {canReviewPosts && !reviewOnly ? <Metric icon="bi-chat-quote" label="公开内容" value={stats.messages.visible} detail={`今日新增 ${stats.messages.last_24_hours}，累计 ${stats.messages.total}`} /> : null}
        {can('view_report') ? <Metric icon="bi-flag" label="待处理举报" value={stats.reports.total} detail={`近 7 天处理 ${stats.reports.processed_last_7_days || 0} 条，累计 ${stats.reports.processed_total || 0} 条`} tone={stats.reports.total ? 'danger' : 'success'} /> : null}
        {can('manage_admins') ? <Metric icon="bi-shield-lock" label="管理员账号" value={stats.managers.active} detail={`${stats.managers.disabled} 个停用，${stats.managers.super_admins} 个账号管理者`} tone="success" /> : null}
      </div>

      {canReviewPosts && !reviewOnly ? <div className="admin-dashboard-columns mt-6">
        <section className="admin-dashboard-section">
          <div className="admin-section-heading">
            <div>
              <h2>近 7 天发布趋势</h2>
              <p>公开留言共新增 {stats.messages.last_7_days} 条</p>
            </div>
            <span className="badge">7 天</span>
          </div>
          <div className="admin-trend-chart" aria-label="近 7 天留言发布量">
            {(stats.messages.daily || []).map((item) => (
              <div className="admin-trend-column" key={item.date} title={`${item.label}：${item.count} 条`}>
                <span className="admin-trend-value">{item.count}</span>
                <div className="admin-trend-track"><span style={{ height: `${Math.max(item.count ? 12 : 3, (item.count / maxDaily) * 100)}%` }} /></div>
                <span className="admin-trend-label">{item.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="admin-dashboard-section">
          <div className="admin-section-heading">
            <div>
              <h2>内容治理</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className="btn btn-sm btn-outline" to="/admin/wall">帖子审核</Link>
              <Link className="btn btn-sm btn-outline" to="/admin/confessions">表白审核</Link>
            </div>
          </div>
          <div className="admin-governance-list">
            <div><span>待审核帖子</span><strong>{stats.messages.pending_posts}</strong></div>
            <div><span>待审核表白</span><strong>{stats.messages.pending_confessions}</strong></div>
            <div><span>待审核后公开</span><strong>{stats.messages.awaiting_publication || 0}</strong></div>
            <div><span>已下架</span><strong>{stats.messages.hidden}</strong></div>
            <div><span>已下架评论</span><strong>{stats.messages.comments_hidden || 0}</strong></div>
            <div><span>回收站</span><strong>{stats.trash.all || 0}</strong></div>
            <div><span>待跟进反馈</span><strong>{(stats.feedback.pending || 0) + (stats.feedback.in_progress || 0)}</strong></div>
            <div><span>发帖 / 评论</span><strong>{stats.community.posting_enabled ? '开' : '关'} / {stats.community.commenting_enabled ? '开' : '关'}</strong></div>
            <div><span>发帖预审</span><strong>{stats.community.require_post_approval ? '开启' : '关闭'}</strong></div>
            <div><span>置顶 / 精华</span><strong>{stats.messages.pinned} / {stats.messages.featured}</strong></div>
            <div><span>评论与表态</span><strong>{interactions}</strong></div>
          </div>
        </section>
      </div> : null}

      {canReviewPosts && !reviewOnly ? <section className="admin-dashboard-section mt-6">
        <div className="admin-section-heading">
          <div>
            <h2>热门分区</h2>
            <p>按当前公开留言数量统计</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {stats.messages.top_tags?.length ? stats.messages.top_tags.map((item) => (
            <Link className="badge" key={item.tag} to={`/p/${encodeURIComponent(item.tag)}`}>#{item.tag} · {item.count}</Link>
          )) : <span className="text-sm text-muted">暂时没有分区数据</span>}
        </div>
      </section> : null}

      <nav className="admin-quick-links mt-6" aria-label="管理快捷入口">
        {canReviewPosts ? <Link to="/admin/wall"><i className="bi bi-chat-quote" /><span>帖子审核</span><b>{stats.messages.pending_posts}</b></Link> : null}
        {canReviewPosts ? <Link to="/admin/confessions"><i className="bi bi-heart" /><span>表白墙审核</span><b>{stats.messages.pending_confessions}</b></Link> : null}
        {can('notice') ? <Link to="/admin/notice"><i className="bi bi-megaphone" /><span>公告管理</span><b>发布</b></Link> : null}
        {can('manage_wall_message') ? <Link to="/admin/comments"><i className="bi bi-chat-left-dots" /><span>评论管理</span><b>{stats.messages.comments_hidden || 0}</b></Link> : null}
        {can('manage_wall_message') ? <Link to="/admin/trash"><i className="bi bi-trash3" /><span>内容回收站</span><b>{stats.trash.all || 0}</b></Link> : null}
        {can('manage_admins') ? <Link to="/admin/managers"><i className="bi bi-shield-lock" /><span>管理员账号</span><b>{stats.managers.total}</b></Link> : null}
        {can('view_report') ? <Link to="/admin/report"><i className="bi bi-flag" /><span>举报管理</span><b>{stats.reports.total}</b></Link> : null}
        {can('view_user_log') ? <Link to="/admin/feedback"><i className="bi bi-life-preserver" /><span>反馈工单</span><b>{(stats.feedback.pending || 0) + (stats.feedback.in_progress || 0)}</b></Link> : null}
        {can('manage_settings') ? <Link to="/admin/settings"><i className="bi bi-gear" /><span>平台设置</span><b>{stats.community.posting_enabled && stats.community.commenting_enabled ? '开放' : '受限'}</b></Link> : null}
        {can('view_admin_log') ? <Link to="/admin/audit"><i className="bi bi-clock-history" /><span>操作审计</span><b>{stats.audit.last_7_days || 0}</b></Link> : null}
      </nav>
    </AdminShell>
  )
}
