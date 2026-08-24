import { useCallback, useEffect, useMemo, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import Modal from '../../components/Modal.jsx'
import api from '../../services/api'
import { useAlert } from '../../contexts/AlertContext.jsx'

const actionCopy = {
  dismiss: {
    title: '标记举报已处理',
    button: '确认处理',
    icon: 'bi-check2-circle',
    detail: '这条举报将从待处理队列移出，原留言和评论保持不变。'
  },
  delete_comment: {
    title: '将违规评论移入回收站',
    button: '移入回收站并处理',
    icon: 'bi-trash',
    detail: '被举报评论将从公开页面移除并进入回收站，针对该评论的重复举报也会一并结清。'
  },
  delete_message: {
    title: '将违规留言移入回收站',
    button: '移入回收站并处理',
    icon: 'bi-trash',
    detail: '整条留言将从公开页面移除并进入回收站，该留言下的全部举报都会结清。'
  }
}

const reportKind = (report) => report?.target_type === 'comment' ? '评论' : '留言'

const resolutionCopy = {
  dismiss: { label: '保留内容', className: 'status-success', icon: 'bi-check2-circle' },
  delete_comment: { label: '评论已移入回收站', className: 'status-warning', icon: 'bi-trash' },
  delete_message: { label: '留言已移入回收站', className: 'status-danger', icon: 'bi-trash' }
}

function ReportTarget({ report }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`badge ${report?.target_type === 'comment' ? 'status-warning' : ''}`}>
          <i className={`bi ${report?.target_type === 'comment' ? 'bi-chat-left-text' : 'bi-chat-quote'} mr-1`} />
          {reportKind(report)}举报
        </span>
        <span className="badge">{report?.category || '其它违规情况'}</span>
        {report?.comment_id ? <span className="text-xs text-muted">评论 ID：{report.comment_id}</span> : null}
      </div>
      <p className="line-clamp-2 text-sm font-semibold leading-relaxed text-[var(--text-primary)]">
        {report?.target_excerpt || '被举报内容暂无文字摘要'}
      </p>
    </div>
  )
}

function ContextContent({ context }) {
  const { message, report } = context
  const comments = Array.isArray(message.comments) ? message.comments : []
  const targetComment = report.target_type === 'comment'
    ? comments.find((comment) => String(comment.id) === String(report.comment_id))
    : null

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="badge">留言 #{message.id}</span>
          {message.user?.username ? <span>绑定账号：{message.user.username}</span> : <span>游客留言</span>}
          {message.timestamp ? <span>{message.timestamp}</span> : null}
        </div>
        <p className="message-text whitespace-pre-wrap">{message.text || '该留言仅包含附件'}</p>
        {message.files?.length ? <p className="text-xs text-muted">附件：{message.files.join('、')}</p> : null}
      </section>

      {report.target_type === 'comment' ? (
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="font-bold">评论上下文</h4>
            <span className="text-xs text-muted">共 {comments.length} 条评论</span>
          </div>
          {!targetComment ? (
            <div className="info-callout status-warning">
              <i className="bi bi-exclamation-triangle mr-2" />被举报评论已经不存在，可将举报标记为已处理。
            </div>
          ) : null}
          <div className="divide-y divide-[var(--border-color)] border-y border-[var(--border-color)]">
            {comments.map((comment, index) => {
              const targeted = String(comment.id) === String(report.comment_id)
              return (
                <div className={`py-3 ${targeted ? 'bg-[var(--secondary-light)] px-3' : ''}`} key={comment.id || index}>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <b className="text-[var(--text-primary)]">{index + 1} 楼</b>
                    <span>{comment.display_name_snapshot || '匿名用户'}</span>
                    {comment.user?.username ? <span>用户名：{comment.user.username}</span> : null}
                    {targeted ? <span className="badge status-warning">被举报评论</span> : null}
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{comment.text || '该评论仅包含附件'}</p>
                  {comment.files?.length ? <p className="mt-1 text-xs text-muted">附件：{comment.files.join('、')}</p> : null}
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      <section className="info-callout">
        <p className="mb-1 text-xs font-bold text-muted">举报理由</p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{report.text || '无补充说明'}</p>
      </section>
    </div>
  )
}

function HistoryRecord({ report }) {
  const resolution = resolutionCopy[report.resolution] || resolutionCopy.dismiss
  return (
    <article className="card p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ReportTarget report={report} />
        <span className={`badge ${resolution.className}`}>
          <i className={`bi ${resolution.icon} mr-1`} />{resolution.label}
        </span>
      </div>
      <div className="mt-4 border-t border-[var(--border-color)] pt-3">
        <p className="text-xs font-bold text-muted">举报说明</p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{report.text || '无补充说明'}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span><i className="bi bi-chat-square-text mr-1" />留言 #{report.message_id}</span>
        {report.timestamp ? <span><i className="bi bi-clock mr-1" />举报于 {report.timestamp}</span> : null}
        <span><i className="bi bi-archive mr-1" />处理于 {report.processed_at || '时间未知'}</span>
        <span><i className="bi bi-person-check mr-1" />{report.processed_by || '历史记录'}</span>
      </div>
      {report.public_reply ? (
        <div className="mt-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-secondary-bg)] p-3">
          <p className="text-xs font-bold text-muted">处理说明（后台记录）</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{report.public_reply}</p>
        </div>
      ) : null}
    </article>
  )
}

export default function AdminReport() {
  const [reports, setReports] = useState({})
  const [processedTotal, setProcessedTotal] = useState(0)
  const [view, setView] = useState('pending')
  const [history, setHistory] = useState({ items: [], page: 1, total: 0, total_pages: 0 })
  const [historyPage, setHistoryPage] = useState(1)
  const [historyDraft, setHistoryDraft] = useState({ q: '', action: '', target_type: '' })
  const [historyFilters, setHistoryFilters] = useState({ q: '', action: '', target_type: '' })
  const [context, setContext] = useState(null)
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [publicReply, setPublicReply] = useState('')
  const alert = useAlert()

  const loadPending = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.adminGetReport()
      setReports(response.data?.reports || {})
      setProcessedTotal(Number(response.data?.processed_total || 0))
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '加载举报失败')
    } finally {
      setLoading(false)
    }
  }, [alert])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const response = await api.adminGetReportHistory({
        page: historyPage,
        page_size: 15,
        ...historyFilters
      })
      setHistory({
        items: response.data?.items || [],
        page: Number(response.data?.page || 1),
        total: Number(response.data?.total || 0),
        total_pages: Number(response.data?.total_pages || 0)
      })
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '加载处理记录失败')
    } finally {
      setHistoryLoading(false)
    }
  }, [alert, historyFilters, historyPage])

  useEffect(() => { loadPending() }, [loadPending])
  useEffect(() => {
    if (view === 'history') loadHistory()
  }, [loadHistory, view])

  const entries = useMemo(() => Object.entries(reports).filter(([, items]) => Array.isArray(items) && items.length), [reports])
  const stats = useMemo(() => {
    const all = entries.flatMap(([, items]) => items)
    return {
      total: all.length,
      messages: entries.length,
      comments: all.filter((report) => report.target_type === 'comment').length
    }
  }, [entries])

  const viewContext = async (messageId, report) => {
    try {
      const response = await api.adminGetMessage(messageId)
      if (!response.data) {
        alert.showTopRightAlert('被举报留言已不存在，可直接标记处理', 'info', '内容已删除')
        return
      }
      setContext({ message: response.data, report, messageId })
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '加载举报上下文失败')
    }
  }

  const askResolve = (messageId, report, action) => {
    setContext(null)
    setPublicReply('')
    setConfirmTarget({ messageId, report, action })
  }

  const resolveReport = async () => {
    if (!confirmTarget || resolving) return
    setResolving(true)
    try {
      const response = await api.adminResolveReport(
        confirmTarget.messageId,
        confirmTarget.report.id,
        confirmTarget.action,
        publicReply.trim()
      )
      const count = Number(response.data?.resolved || 1)
      alert.showTopRightAlert(`已结清 ${count} 条举报`, 'success', '处理完成')
      setConfirmTarget(null)
      await loadPending()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '处理举报失败')
    } finally {
      setResolving(false)
    }
  }

  const contextFooter = context ? (
    <>
      <button className="btn btn-outline" type="button" onClick={() => setContext(null)}>关闭</button>
      <button className="btn btn-outline" type="button" onClick={() => askResolve(context.messageId, context.report, 'dismiss')}>
        <i className="bi bi-check2-circle" />标记处理
      </button>
      {context.report.target_type === 'comment' ? (
        <button className="btn btn-danger" type="button" onClick={() => askResolve(context.messageId, context.report, 'delete_comment')}>
          <i className="bi bi-trash" />评论移入回收站
        </button>
      ) : null}
      <button className="btn btn-danger" type="button" onClick={() => askResolve(context.messageId, context.report, 'delete_message')}>
        <i className="bi bi-trash" />留言移入回收站
      </button>
    </>
  ) : null

  const confirmCopy = confirmTarget ? actionCopy[confirmTarget.action] : null

  const searchHistory = (event) => {
    event.preventDefault()
    setHistoryPage(1)
    setHistoryFilters({ ...historyDraft, q: historyDraft.q.trim() })
  }

  const resetHistory = () => {
    const empty = { q: '', action: '', target_type: '' }
    setHistoryDraft(empty)
    setHistoryFilters(empty)
    setHistoryPage(1)
  }

  return (
    <AdminShell title="举报管理">
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="admin-stat-card"><b>{stats.total}</b><p className="text-muted">待处理举报</p></div>
        <div className="admin-stat-card"><b>{stats.comments}</b><p className="text-muted">评论举报</p></div>
        <div className="admin-stat-card"><b>{stats.messages}</b><p className="text-muted">涉及留言</p></div>
        <div className="admin-stat-card"><b>{processedTotal}</b><p className="text-muted">累计处理记录</p></div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2 border-b border-[var(--border-color)] pb-3" role="tablist" aria-label="举报管理视图">
        <button className={`btn btn-sm ${view === 'pending' ? 'btn-primary' : 'btn-outline'}`} type="button" role="tab" aria-selected={view === 'pending'} onClick={() => setView('pending')}>
          <i className="bi bi-inbox" />待处理 <span className="tabular-nums">{stats.total}</span>
        </button>
        <button className={`btn btn-sm ${view === 'history' ? 'btn-primary' : 'btn-outline'}`} type="button" role="tab" aria-selected={view === 'history'} onClick={() => setView('history')}>
          <i className="bi bi-archive" />处理记录 <span className="tabular-nums">{processedTotal}</span>
        </button>
      </div>

      {view === 'pending' ? <div className="admin-toolbar mb-4">
        <div className="mr-auto min-w-0">
          <h2 className="text-lg font-bold"><i className="bi bi-flag mr-2" />待处理队列</h2>
          <p className="text-sm text-muted">查看上下文后，可保留内容，或将评论、整条留言移入回收站。</p>
        </div>
        <button className="btn btn-sm btn-outline" type="button" disabled={loading} onClick={loadPending}>
          <i className={`bi bi-arrow-clockwise ${loading ? 'admin-spin' : ''}`} />刷新
        </button>
      </div> : null}

      {view === 'pending' && loading ? <div className="page-center"><div className="spinner" /></div> : null}
      {view === 'pending' && !loading && entries.length === 0 ? (
        <div className="empty-state-card">
          <i className="bi bi-shield-check text-6xl" />
          <p className="mt-3 font-bold">暂无待处理举报</p>
          <p className="mt-1 text-sm text-muted">新的留言或评论举报会集中显示在这里。</p>
        </div>
      ) : null}

      {view === 'pending' ? <div className="space-y-4">
        {entries.map(([messageId, items]) => (
          <article className="card overflow-hidden" key={messageId}>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-color)] px-4 py-3 md:px-5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-black">留言 #{messageId}</h3>
                <span className="badge">{items.length} 条待处理</span>
              </div>
              <button className="btn btn-sm btn-outline" type="button" onClick={() => viewContext(messageId, items[0])}>
                <i className="bi bi-eye" />查看留言
              </button>
            </header>

            <div className="divide-y divide-[var(--border-color)]">
              {items.map((report) => (
                <div className="grid gap-4 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:px-5" key={report.id}>
                  <div className="min-w-0 space-y-3">
                    <ReportTarget report={report} />
                    <div>
                      <p className="text-xs font-bold text-muted">举报说明</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{report.text || '无补充说明'}</p>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      <span><i className="bi bi-clock mr-1" />{report.timestamp || '时间未知'}</span>
                      {report.email ? <span><i className="bi bi-envelope mr-1" />{report.email}</span> : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 md:max-w-64 md:justify-end">
                    <button className="btn btn-sm btn-outline" type="button" onClick={() => viewContext(messageId, report)}>
                      <i className="bi bi-eye" />上下文
                    </button>
                    <button className="btn btn-sm btn-outline" type="button" onClick={() => askResolve(messageId, report, 'dismiss')}>
                      <i className="bi bi-check2-circle" />保留内容
                    </button>
                    {report.target_type === 'comment' ? (
                      <button className="btn btn-sm btn-danger" type="button" onClick={() => askResolve(messageId, report, 'delete_comment')}>
                        <i className="bi bi-trash" />移走评论
                      </button>
                    ) : null}
                    <button className="btn btn-sm btn-danger" type="button" onClick={() => askResolve(messageId, report, 'delete_message')}>
                      <i className="bi bi-trash" />移走留言
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div> : null}

      {view === 'history' ? (
        <>
          <form className="card-flat mb-4 grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_170px_180px_auto]" onSubmit={searchHistory}>
            <input
              className="field w-full"
              value={historyDraft.q}
              onChange={(event) => setHistoryDraft((current) => ({ ...current, q: event.target.value }))}
              placeholder="搜索留言 ID、摘要、理由、邮箱或管理员"
              aria-label="搜索处理记录"
            />
            <select className="field w-full" value={historyDraft.target_type} onChange={(event) => setHistoryDraft((current) => ({ ...current, target_type: event.target.value }))} aria-label="举报对象">
              <option value="">全部对象</option>
              <option value="message">留言举报</option>
              <option value="comment">评论举报</option>
            </select>
            <select className="field w-full" value={historyDraft.action} onChange={(event) => setHistoryDraft((current) => ({ ...current, action: event.target.value }))} aria-label="处理方式">
              <option value="">全部处理方式</option>
              <option value="dismiss">保留内容</option>
              <option value="delete_comment">评论移入回收站</option>
              <option value="delete_message">留言移入回收站</option>
            </select>
            <div className="flex gap-2">
              <button className="btn btn-primary" type="submit" disabled={historyLoading}><i className="bi bi-search" />查询</button>
              <button className="btn btn-outline" type="button" disabled={historyLoading} onClick={resetHistory} aria-label="重置筛选"><i className="bi bi-arrow-counterclockwise" /></button>
            </div>
          </form>

          <div className="admin-toolbar mb-4">
            <div className="mr-auto min-w-0">
              <h2 className="text-lg font-bold"><i className="bi bi-archive mr-2" />处理记录</h2>
              <p className="text-sm text-muted">当前筛选共 {history.total} 条，记录处理方式、管理员和时间。</p>
            </div>
            <button className="btn btn-sm btn-outline" type="button" disabled={historyLoading} onClick={loadHistory}>
              <i className={`bi bi-arrow-clockwise ${historyLoading ? 'admin-spin' : ''}`} />刷新
            </button>
          </div>

          {historyLoading ? <div className="page-center"><div className="spinner" /></div> : null}
          {!historyLoading && history.items.length === 0 ? (
            <div className="empty-state-card">
              <i className="bi bi-archive text-6xl" />
              <p className="mt-3 font-bold">没有匹配的处理记录</p>
              <p className="mt-1 text-sm text-muted">处理待办举报后，审计记录会保存在这里。</p>
            </div>
          ) : null}
          {!historyLoading ? <div className="space-y-3">{history.items.map((report) => <HistoryRecord report={report} key={`${report.message_id}-${report.id}`} />)}</div> : null}

          {history.total_pages > 1 ? (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <button className="btn btn-sm btn-outline" type="button" disabled={history.page <= 1 || historyLoading} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}><i className="bi bi-chevron-left" />上一页</button>
              <span className="badge">第 {history.page} / {history.total_pages} 页</span>
              <button className="btn btn-sm btn-outline" type="button" disabled={history.page >= history.total_pages || historyLoading} onClick={() => setHistoryPage((page) => page + 1)}>下一页<i className="bi bi-chevron-right" /></button>
            </div>
          ) : null}
        </>
      ) : null}

      <Modal
        visible={Boolean(context)}
        title={`举报上下文 · 留言 #${context?.messageId || ''}`}
        width="900px"
        onClose={() => setContext(null)}
        footer={contextFooter}
      >
        {context ? <ContextContent context={context} /> : null}
      </Modal>

      <Modal
        visible={Boolean(confirmTarget)}
        title={confirmCopy?.title || '确认处理举报'}
        width="560px"
        onClose={() => resolving ? null : setConfirmTarget(null)}
        footer={(
          <>
            <button className="btn btn-outline" type="button" disabled={resolving} onClick={() => setConfirmTarget(null)}>取消</button>
            <button className={confirmTarget?.action === 'dismiss' ? 'btn btn-primary' : 'btn btn-danger'} type="button" disabled={resolving} onClick={resolveReport}>
              <i className={`bi ${confirmCopy?.icon || 'bi-check2-circle'}`} />
              {resolving ? '正在处理...' : (confirmCopy?.button || '确认')}
            </button>
          </>
        )}
      >
        <div className="space-y-3">
          <p>{confirmCopy?.detail}</p>
          {confirmTarget ? <ReportTarget report={confirmTarget.report} /> : null}
          <label className="block space-y-1.5 pt-2">
            <span className="text-xs font-bold text-muted">向举报人公开的处理说明（选填）</span>
            <textarea
              className="field min-h-28 w-full"
              value={publicReply}
              onChange={(event) => setPublicReply(event.target.value)}
              placeholder="例如：已核查相关内容并按社区公约完成处理。请勿填写举报人信息或后台内部备注。"
              maxLength={1000}
              disabled={resolving}
            />
            <span className="block text-right text-xs text-muted">{publicReply.length} / 1000</span>
          </label>
        </div>
      </Modal>
    </AdminShell>
  )
}
