import { useEffect, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import { useAlert } from '../../contexts/AlertContext.jsx'
import api from '../../services/api'

const targetLabels = {
  admin: '后台',
  message: '留言',
  comment: '评论',
  user: '用户',
  app: '应用',
  notice: '公告',
  report: '举报',
  manager: '管理员',
  setting: '设置',
  legacy_log: '历史日志'
}

export default function AdminAudit() {
  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [targetType, setTargetType] = useState('')
  const [loading, setLoading] = useState(false)
  const alert = useAlert()

  const load = async () => {
    setLoading(true)
    try {
      const response = await api.adminGetAudit({ q: appliedQuery, target_type: targetType, page, page_size: 25 })
      const data = response.data || {}
      setItems(data.items || [])
      setTotal(data.total || 0)
      setTotalPages(data.total_pages || 0)
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '审计记录加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [page, appliedQuery, targetType])

  const submitSearch = () => {
    setAppliedQuery(query.trim())
    setPage(1)
  }

  return (
    <AdminShell title="操作审计">
      <div className="admin-toolbar mb-5">
        <input className="field admin-toolbar-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submitSearch()} placeholder="搜索管理员、动作、对象或摘要..." />
        <select className="field" value={targetType} onChange={(event) => { setTargetType(event.target.value); setPage(1) }} aria-label="对象类型">
          <option value="">全部对象</option>
          {Object.entries(targetLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <button className="btn btn-primary" type="button" onClick={submitSearch}><i className="bi bi-search" />搜索</button>
        <button className="btn btn-outline" type="button" onClick={load}><i className="bi bi-arrow-clockwise" />刷新</button>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="page-kicker"><i className="bi bi-shield-check" />结构化审计记录</span>
        <span className="text-sm text-muted">共 {total} 条</span>
      </div>

      {loading ? <div className="page-center"><div className="spinner" /></div> : null}
      {!loading && !items.length ? <div className="empty-state-card"><i className="bi bi-file-text" /><h2 className="mt-3 text-lg font-bold">暂无审计记录</h2></div> : null}

      <div className="admin-audit-list">
        {items.map((item) => (
          <article className="admin-audit-item" key={item.id}>
            <div className="admin-audit-time">
              <b>{new Date(item.created_at).toLocaleDateString('zh-CN')}</b>
              <span>{new Date(item.created_at).toLocaleTimeString('zh-CN')}</span>
            </div>
            <span className="admin-audit-dot" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge"><i className="bi bi-person-check" />{item.actor}</span>
                <span className="badge">{targetLabels[item.target_type] || item.target_type || '后台'}</span>
                {item.target_id ? <span className="badge">#{item.target_id}</span> : null}
              </div>
              <p className="font-bold text-[var(--text-primary)]">{item.summary}</p>
              <code className="text-xs text-muted">{item.action}</code>
            </div>
          </article>
        ))}
      </div>

      {totalPages > 1 ? (
        <div className="mt-5 flex items-center justify-center gap-3">
          <button className="btn btn-sm btn-outline" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><i className="bi bi-chevron-left" />上一页</button>
          <span className="text-sm text-muted">第 {page} / {totalPages} 页</span>
          <button className="btn btn-sm btn-outline" type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>下一页<i className="bi bi-chevron-right" /></button>
        </div>
      ) : null}
    </AdminShell>
  )
}
