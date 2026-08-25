import { useCallback, useEffect, useMemo, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import Modal from '../../components/Modal.jsx'
import api from '../../services/api'
import { useAlert } from '../../contexts/AlertContext.jsx'
import { useUser } from '../../contexts/UserContext.jsx'

const fallbackCategories = {
  bug: '网站故障',
  feature: '功能建议',
  account: '账号问题',
  content: '内容与社区',
  other: '其他反馈'
}

const fallbackStatuses = {
  pending: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  closed: '已关闭'
}

const statusMeta = {
  pending: { className: 'status-warning', icon: 'bi-hourglass-split' },
  in_progress: { className: '', icon: 'bi-arrow-repeat' },
  resolved: { className: 'status-success', icon: 'bi-check2-circle' },
  closed: { className: '', icon: 'bi-archive' }
}

const formatTicketId = (value) => String(value || '').match(/.{1,8}/g)?.join('-') || value

function TicketStatus({ ticket, statuses }) {
  const meta = statusMeta[ticket.status] || statusMeta.pending
  return <span className={`badge ${meta.className}`}><i className={`bi ${meta.icon} mr-1`} />{statuses[ticket.status] || ticket.status}</span>
}

export default function AdminFeedback() {
  const [tickets, setTickets] = useState([])
  const [stats, setStats] = useState({ total: 0, pending: 0, in_progress: 0, resolved: 0, closed: 0 })
  const [categories, setCategories] = useState(fallbackCategories)
  const [statuses, setStatuses] = useState(fallbackStatuses)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [draft, setDraft] = useState({ q: '', status: '', category: '' })
  const [filters, setFilters] = useState({ q: '', status: '', category: '' })
  const [selected, setSelected] = useState(null)
  const [editor, setEditor] = useState({ status: 'pending', public_reply: '', internal_note: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const alert = useAlert()
  const { hasCapability } = useUser()
  const canUpdateFeedback = hasCapability('feedback.update')

  const params = useMemo(() => ({ page, page_size: 15, ...filters }), [filters, page])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.adminGetFeedback(params)
      setTickets(response.data?.tickets || [])
      setStats(response.data?.stats || { total: 0, pending: 0, in_progress: 0, resolved: 0, closed: 0 })
      setCategories(response.data?.categories || fallbackCategories)
      setStatuses(response.data?.statuses || fallbackStatuses)
      setTotalPages(Number(response.data?.total_pages || 0))
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '加载反馈工单失败')
    } finally {
      setLoading(false)
    }
  }, [alert, params])

  useEffect(() => { load() }, [load])

  const applyFilters = (event) => {
    event.preventDefault()
    setPage(1)
    setFilters({ ...draft, q: draft.q.trim() })
  }

  const resetFilters = () => {
    const empty = { q: '', status: '', category: '' }
    setDraft(empty)
    setFilters(empty)
    setPage(1)
  }

  const openTicket = (ticket) => {
    setSelected(ticket)
    setEditor({
      status: ticket.status || 'pending',
      public_reply: ticket.public_reply || '',
      internal_note: ticket.internal_note || ''
    })
  }

  const saveTicket = async () => {
    if (!canUpdateFeedback || !selected || saving) return
    setSaving(true)
    try {
      const response = await api.adminUpdateFeedback(selected.id, editor)
      const updated = response.data?.ticket
      if (updated) setSelected(updated)
      alert.showTopRightAlert('工单状态与回复已保存', 'success', '处理完成')
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '保存工单失败')
    } finally {
      setSaving(false)
    }
  }

  const activeCount = Number(stats.pending || 0) + Number(stats.in_progress || 0)

  return (
    <AdminShell title="反馈工单">
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="admin-stat-card"><b>{stats.pending}</b><p className="text-muted">待处理</p></div>
        <div className="admin-stat-card"><b>{stats.in_progress}</b><p className="text-muted">处理中</p></div>
        <div className="admin-stat-card"><b>{stats.resolved}</b><p className="text-muted">已解决</p></div>
        <div className="admin-stat-card"><b>{stats.closed}</b><p className="text-muted">已关闭</p></div>
      </div>

      <form className="card-flat mb-4 grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_160px_160px_auto]" onSubmit={applyFilters}>
        <input className="field w-full" value={draft.q} onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))} placeholder="搜索工单编号、主题、邮箱或反馈内容" aria-label="搜索反馈工单" />
        <select className="field w-full" value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} aria-label="反馈分类">
          <option value="">全部分类</option>
          {Object.entries(categories).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <select className="field w-full" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))} aria-label="工单状态">
          <option value="">全部状态</option>
          {Object.entries(statuses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <div className="flex gap-2">
          <button className="btn btn-primary" type="submit" disabled={loading}><i className="bi bi-search" />查询</button>
          <button className="btn btn-outline" type="button" disabled={loading} onClick={resetFilters} aria-label="重置筛选"><i className="bi bi-arrow-counterclockwise" /></button>
        </div>
      </form>

      <div className="admin-toolbar mb-4">
        <div className="mr-auto min-w-0">
          <h2 className="text-lg font-bold"><i className="bi bi-life-preserver mr-2" />工单队列</h2>
          <p className="text-sm text-muted">当前共有 {activeCount} 条待跟进工单，处理记录仅供后台团队协作查阅。</p>
        </div>
        <button className="btn btn-sm btn-outline" type="button" disabled={loading} onClick={load}><i className={`bi bi-arrow-clockwise ${loading ? 'admin-spin' : ''}`} />刷新</button>
      </div>

      {loading ? <div className="page-center"><div className="spinner" /></div> : null}
      {!loading && tickets.length === 0 ? (
        <div className="empty-state-card"><i className="bi bi-inbox text-6xl" /><p className="mt-3 font-bold">没有匹配的反馈工单</p></div>
      ) : null}

      {!loading ? (
        <div className="space-y-3">
          {tickets.map((ticket) => (
            <article className="card p-4 md:p-5" key={ticket.id}>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge">{categories[ticket.category] || '其他反馈'}</span>
                    <TicketStatus ticket={ticket} statuses={statuses} />
                    <code className="text-xs text-muted">{formatTicketId(ticket.id)}</code>
                  </div>
                  <h3 className="truncate font-black">{ticket.title || '未填写反馈主题'}</h3>
                  <p className="line-clamp-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)]">{ticket.text}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span><i className="bi bi-clock mr-1" />{ticket.timestamp}</span>
                    {ticket.email ? <span><i className="bi bi-envelope mr-1" />{ticket.email}</span> : <span>未留邮箱</span>}
                    {ticket.updated_at ? <span>更新于 {ticket.updated_at}</span> : null}
                  </div>
                </div>
                <button className={`btn btn-sm justify-center ${canUpdateFeedback ? 'btn-primary' : 'btn-outline'}`} type="button" onClick={() => openTicket(ticket)}><i className={`bi ${canUpdateFeedback ? 'bi-pencil' : 'bi-eye'}`} />{canUpdateFeedback ? '处理工单' : '查看工单'}</button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {totalPages > 1 ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button className="btn btn-sm btn-outline" type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}><i className="bi bi-chevron-left" />上一页</button>
          <span className="badge">第 {page} / {totalPages} 页</span>
          <button className="btn btn-sm btn-outline" type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>下一页<i className="bi bi-chevron-right" /></button>
        </div>
      ) : null}

      <Modal
        visible={Boolean(selected)}
        title={`${canUpdateFeedback ? '处理' : '查看'}反馈 · ${selected ? formatTicketId(selected.id) : ''}`}
        width="860px"
        onClose={() => saving ? null : setSelected(null)}
        footer={(
          <>
            <button className="btn btn-outline" type="button" disabled={saving} onClick={() => setSelected(null)}>关闭</button>
            {canUpdateFeedback ? <button className="btn btn-primary" type="button" disabled={saving} onClick={saveTicket}><i className="bi bi-save" />{saving ? '保存中...' : '保存处理结果'}</button> : null}
          </>
        )}
      >
        {selected ? (
          <div className="space-y-5">
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-2"><span className="badge">{categories[selected.category] || '其他反馈'}</span><TicketStatus ticket={selected} statuses={statuses} /><span className="text-xs text-muted">提交于 {selected.timestamp}</span></div>
              <h3 className="text-lg font-black">{selected.title || '未填写反馈主题'}</h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{selected.text}</p>
              <p className="text-xs text-muted"><i className="bi bi-envelope mr-1" />{selected.email || '未留下联系邮箱'}</p>
            </section>

            <section className="grid gap-4 border-t border-[var(--border-color)] pt-4 md:grid-cols-2">
              <label className="block space-y-2 md:col-span-2"><span className="text-sm font-bold">工单状态</span><select className="field w-full" value={editor.status} disabled={!canUpdateFeedback || saving} onChange={(event) => setEditor((current) => ({ ...current, status: event.target.value }))}>{Object.entries(statuses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label className="block space-y-2"><span className="text-sm font-bold">处理说明</span><textarea className="field min-h-36 w-full" value={editor.public_reply} maxLength={10000} disabled={!canUpdateFeedback || saving} onChange={(event) => setEditor((current) => ({ ...current, public_reply: event.target.value }))} placeholder="记录本次处理结果，便于管理团队后续查阅" /><span className="block text-right text-xs text-muted">{editor.public_reply.length}/10000</span></label>
              <label className="block space-y-2"><span className="text-sm font-bold">内部备注</span><textarea className="field min-h-36 w-full" value={editor.internal_note} maxLength={10000} disabled={!canUpdateFeedback || saving} onChange={(event) => setEditor((current) => ({ ...current, internal_note: event.target.value }))} placeholder="仅管理员可见，不会公开" /><span className="block text-right text-xs text-muted">{editor.internal_note.length}/10000</span></label>
            </section>

            {!canUpdateFeedback ? <div className="info-callout"><i className="bi bi-eye" /><span>当前为只读查看；需要 <code>feedback.update</code> 才能修改状态、处理说明或内部备注。</span></div> : null}

            {selected.history?.length ? (
              <section className="border-t border-[var(--border-color)] pt-4">
                <h4 className="mb-2 font-bold">处理时间线</h4>
                <div className="divide-y divide-[var(--border-color)] border-y border-[var(--border-color)]">
                  {[...selected.history].reverse().map((entry, index) => (
                    <div className="flex flex-wrap items-center gap-2 py-2 text-xs text-muted" key={`${entry.timestamp}-${index}`}>
                      <span>{entry.timestamp || '-'}</span><b className="text-[var(--text-primary)]">{entry.by || '管理员'}</b><span>{statuses[entry.previous_status] || entry.previous_status} → {statuses[entry.status] || entry.status}</span>{entry.reply_updated ? <span className="badge">更新处理说明</span> : null}{entry.note_updated ? <span className="badge">更新内部备注</span> : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </AdminShell>
  )
}
