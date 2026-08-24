import { useEffect, useMemo, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import Modal from '../../components/Modal.jsx'
import { useAlert } from '../../contexts/AlertContext.jsx'
import api from '../../services/api'
import { fileType, fileUrl } from '../../utils/user.js'

const statusOptions = [
  { value: 'pending', label: '待审核', count: 'pending', icon: 'bi-hourglass-split' },
  { value: 'approved', label: '已通过', count: 'approved', icon: 'bi-check-circle' },
  { value: 'awaiting_publication', label: '待公开', count: 'awaiting_publication', icon: 'bi-eye-slash' },
  { value: 'visible', label: '公开中', count: 'visible', icon: 'bi-eye' },
  { value: 'hidden', label: '已下架', count: 'hidden', icon: 'bi-archive' },
  { value: 'all', label: '全部', count: 'all', icon: 'bi-collection' }
]

function BoundUser({ message }) {
  if (message?.identity_redacted || message?.review_identity_redacted || message?.author_redacted) {
    return <span className="text-muted"><i className="bi bi-eye-slash mr-1" />发布者身份已隐藏，审核时只需判断内容是否符合社区规范</span>
  }
  if (message?.official || message?.author_type === 'admin') {
    return <span className="badge"><i className="bi bi-patch-check-fill" />官方账号发布{message.admin_username ? ` · ${message.admin_username}` : ''}</span>
  }
  if (!message?.user_id) return <span className="text-muted">匿名或未登录发布（审核页不展示可识别身份）</span>
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <span className="badge">{message.anonymous === false ? '非匿名' : '匿名'}</span>
      <span className="badge">用户名：{message.user?.username || message.username || '-'}</span>
      <span className="badge">昵称：{message.user?.nickname || message.display_name_snapshot || '-'}</span>
      <span className="badge">状态：{message.user?.status || '-'}</span>
    </div>
  )
}

const reviewConstraintText = (message) => {
  if (!message) return ''
  if (message.can_approve === false || message.is_own_submission) {
    return message.approval_block_reason || '这条官方帖子由你发布。为避免自审，请交由其他审核员或超级管理员处理。'
  }
  if (typeof message.review_constraint === 'string' && message.review_constraint.trim()) return message.review_constraint
  if (message.review_constraint?.message) return message.review_constraint.message
  if (message.self_review_forbidden) return '这条官方帖子由你发布。为避免自审，请交由其他审核员或超级管理员处理。'
  return ''
}

const formatTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}

const attachmentName = (file) => typeof file === 'string' ? file : (file?.filename || file?.name || '')
const tagNames = (message) => {
  const values = Array.isArray(message?.tags) ? message.tags : String(message?.tags || '').split(',')
  return values.map((tag) => typeof tag === 'string' ? tag : (tag?.tag || tag?.name || '')).map((tag) => tag.trim()).filter(Boolean)
}

function AttachmentList({ files = [] }) {
  const normalized = files.map(attachmentName).filter(Boolean)
  if (!normalized.length) return null
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-bold">附件（{normalized.length}）</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {normalized.map((file, index) => {
          const type = fileType(file)
          const url = fileUrl(file)
          return type === 'image' ? (
            <a className="block overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-secondary-bg)]" href={url} target="_blank" rel="noreferrer" key={`${file}-${index}`}>
              <img className="aspect-square w-full object-cover" src={fileUrl(file, true)} alt={`帖子附件 ${index + 1}`} loading="lazy" />
              <span className="block truncate p-2 text-xs">查看原图</span>
            </a>
          ) : (
            <a className="card-flat flex min-h-24 flex-col items-center justify-center gap-2 p-3 text-center text-sm" href={url} target="_blank" rel="noreferrer" key={`${file}-${index}`}>
              <i className={`bi ${type === 'video' ? 'bi-play-btn' : type === 'audio' ? 'bi-music-note-beamed' : 'bi-file-earmark'} text-2xl text-[var(--primary-color)]`} />
              <span className="max-w-full truncate">{file}</span>
            </a>
          )
        })}
      </div>
    </section>
  )
}

function ReviewBadge({ message }) {
  if (message.review_status === 'approved') {
    return <span className="badge status-success"><i className="bi bi-check-circle-fill" />已审核</span>
  }
  if (message.moderation_status === 'pending') {
    return <span className="badge status-warning"><i className="bi bi-hourglass-split" />待审核 · 未公开</span>
  }
  if (message.moderation_status === 'hidden') {
    return <span className="badge status-warning"><i className="bi bi-clock-history" />待复核</span>
  }
  return <span className="badge status-warning"><i className="bi bi-clock-history" />待复核 · 已公开</span>
}

export default function AdminWall() {
  const [messages, setMessages] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [counts, setCounts] = useState({ all: 0, pending: 0, approved: 0, visible: 0, hidden: 0, awaiting_publication: 0 })
  const [status, setStatus] = useState('pending')
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [selected, setSelected] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [hideTarget, setHideTarget] = useState(null)
  const [hideReason, setHideReason] = useState('违反社区规范')
  const [canManage, setCanManage] = useState(false)
  const alert = useAlert()
  const visibleStatusOptions = canManage
    ? statusOptions
    : statusOptions.filter((option) => ['pending', 'approved', 'awaiting_publication'].includes(option.value))

  useEffect(() => {
    let alive = true
    api.adminVerify().then((response) => {
      const permissions = (response.data?.admin?.permissions || []).map((permission) => permission.name)
      if (alive) setCanManage(permissions.includes('manage_wall_message'))
    }).catch(() => {
      if (alive) setCanManage(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const response = await api.adminGetMessages({ q: appliedQuery, page, status })
      const data = response.data || {}
      setMessages(data.messages || [])
      setTotal(data.total || 0)
      setTotalPages(data.total_pages || 0)
      setCounts((current) => ({ ...current, ...(data.counts || {}) }))
      setSelectedIds([])
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '留言加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [page, status, appliedQuery])

  const selectableMessages = useMemo(
    () => messages.filter((message) => !reviewConstraintText(message)),
    [messages]
  )
  const allPageSelected = selectableMessages.length > 0 && selectableMessages.every((message) => selectedIds.includes(message.id))
  const selectedMessages = useMemo(
    () => messages.filter((message) => selectedIds.includes(message.id)),
    [messages, selectedIds]
  )

  const changeStatus = (nextStatus) => {
    setPage(1)
    setStatus(nextStatus)
    setSelectedIds([])
  }

  const submitSearch = () => {
    setPage(1)
    setAppliedQuery(query.trim())
  }

  const toggleSelection = (messageId) => {
    const message = messages.find((item) => item.id === messageId)
    if (reviewConstraintText(message)) return
    setSelectedIds((ids) => ids.includes(messageId) ? ids.filter((id) => id !== messageId) : [...ids, messageId])
  }

  const togglePageSelection = () => {
    setSelectedIds(allPageSelected ? [] : selectableMessages.map((message) => message.id))
  }

  const review = async (message, action) => {
    const constraint = reviewConstraintText(message)
    if (constraint) {
      alert.showTopRightAlert(constraint, 'warning', '需要其他审核员处理')
      return false
    }
    setBusy(true)
    try {
      const response = await api.adminReviewMessage(message.id, action)
      if (!response.data?.success) throw new Error(response.data?.error || '审核失败')
      alert.showTopRightAlert(action === 'approve' ? '留言已通过审核' : '留言已退回待审', 'success', '审核状态已更新')
      await load()
      return true
    } catch (error) {
      const friendlyMessage = /自己|自审/.test(error.message || '')
        ? '这条官方帖子由你发布，不能由自己审核。请交给其他审核员或超级管理员处理。'
        : error.message
      alert.showTopRightAlert(friendlyMessage, 'warning', '审核失败')
      return false
    } finally {
      setBusy(false)
    }
  }

  const runBulk = async (action, extra = {}) => {
    if (!selectedIds.length) return
    setBusy(true)
    try {
      const response = await api.adminBulkModerateMessages({ message_ids: selectedIds, action, ...extra })
      const data = response.data || {}
      if (!data.success) throw new Error(data.error || '批量操作失败')
      alert.showTopRightAlert(`成功处理 ${data.succeeded || 0} 条留言`, data.failed ? 'warning' : 'success', data.failed ? '部分完成' : '操作完成')
      setHideTarget(null)
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '批量操作失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      const response = await api.adminDeleteMessage(deleteTarget.id)
      if (!response.data?.success) throw new Error(response.data?.error || '删除失败')
      setDeleteTarget(null)
      alert.showTopRightAlert('留言已移入回收站', 'success', '操作完成')
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '删除失败')
    } finally {
      setBusy(false)
    }
  }

  const updateModeration = async (message, update) => {
    setBusy(true)
    try {
      const response = await api.adminUpdateMessageModeration(message.id, update)
      if (!response.data?.success) throw new Error(response.data?.error || '更新失败')
      const updated = response.data.message
      setMessages((items) => items.map((item) => item.id === message.id ? { ...item, ...updated } : item))
      setSelected((item) => item?.id === message.id ? { ...item, ...updated } : item)
      alert.showTopRightAlert('留言管理状态已更新', 'success', '操作完成')
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '更新失败')
    } finally {
      setBusy(false)
    }
  }

  const detail = async (message) => {
    try {
      const response = await api.adminGetMessage(message.id)
      setSelected(response.data?.message || response.data?.data || response.data)
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '详情加载失败')
    }
  }

  const deleteComment = async (messageId, commentId) => {
    if (!window.confirm('确定要删除这条评论吗？')) return
    try {
      const response = await api.adminDeleteComment(messageId, commentId)
      if (response.data?.success) await detail({ id: messageId })
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '评论删除失败')
    }
  }

  const openHideDialog = (target) => {
    setHideReason(target?.hidden_reason || '违反社区规范')
    setHideTarget(target)
  }

  const confirmHide = async () => {
    if (!hideTarget || !hideReason.trim()) return
    if (hideTarget.bulk) await runBulk('hide', { hidden_reason: hideReason.trim() })
    else {
      await updateModeration(hideTarget, { hidden: true, hidden_reason: hideReason.trim() })
      setHideTarget(null)
    }
  }

  return (
    <AdminShell title="帖子审核">
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="审核队列筛选">
        {visibleStatusOptions.map((option) => (
          <button
            className={`btn btn-sm ${status === option.value ? 'btn-primary' : 'btn-outline'}`}
            type="button"
            role="tab"
            aria-selected={status === option.value}
            key={option.value}
            onClick={() => changeStatus(option.value)}
          >
            <i className={`bi ${option.icon}`} />
            <span>{option.label}</span>
            <span className="badge">{counts[option.count] || 0}</span>
          </button>
        ))}
      </div>

      <div className="admin-toolbar mb-4">
        <input className="field admin-toolbar-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submitSearch()} placeholder="搜索留言内容..." />
        <button className="btn btn-primary" type="button" onClick={submitSearch}><i className="bi bi-search" />搜索</button>
        <button className="btn btn-outline" type="button" onClick={load}><i className="bi bi-arrow-clockwise" />刷新</button>
      </div>

      <div className="mb-4 flex min-h-12 flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--card-secondary-bg)] px-4 py-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-bold">
          <input type="checkbox" checked={allPageSelected} onChange={togglePageSelection} />
          <span>本页全选</span>
        </label>
        <span className="text-sm text-muted">当前筛选 {total} 条，已选 {selectedIds.length} 条</span>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-sm btn-success" type="button" disabled={!selectedIds.length || busy} onClick={() => runBulk('approve')}><i className="bi bi-check2-all" />批量通过</button>
          <button className="btn btn-sm btn-outline" type="button" disabled={!selectedIds.length || busy} onClick={() => runBulk('return')}><i className="bi bi-arrow-counterclockwise" />批量退回</button>
          {canManage ? <button className="btn btn-sm btn-danger" type="button" disabled={!selectedIds.length || busy} onClick={() => openHideDialog({ bulk: true, count: selectedIds.length })}><i className="bi bi-eye-slash" />批量下架</button> : null}
        </div>
      </div>

      {loading ? <div className="page-center"><div className="spinner" /></div> : null}
      {!loading && !messages.length ? (
        <div className="empty-state-card">
          <i className="bi bi-inbox" />
          <h2 className="mt-3 text-lg font-bold">当前队列为空</h2>
          <p className="mt-1 text-sm text-muted">没有符合当前筛选条件的留言。</p>
        </div>
      ) : null}

      <div className="space-y-3">
        {messages.map((message) => (
          <article className={`card message-card p-4 ${message.moderation_status === 'hidden' ? 'admin-message-hidden' : ''}`} key={message.id}>
            <div className="flex flex-col gap-3 md:flex-row md:justify-between">
              <div className="flex min-w-0 flex-1 gap-3">
                <input className="mt-1 h-5 w-5 shrink-0" type="checkbox" checked={selectedIds.includes(message.id)} disabled={Boolean(reviewConstraintText(message))} onChange={() => toggleSelection(message.id)} aria-label={`选择留言 ${message.id}`} title={reviewConstraintText(message) || '选择此帖'} />
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="badge">#{message.id}</span>
                    <ReviewBadge message={message} />
                    {message.pinned ? <span className="badge status-warning"><i className="bi bi-pin-angle" />置顶</span> : null}
                    {message.featured ? <span className="badge status-success"><i className="bi bi-star-fill" />精华</span> : null}
                    {message.moderation_status === 'hidden' ? <span className="badge status-danger"><i className="bi bi-eye-slash" />已下架</span> : null}
                    {message.poll ? <span className="badge"><i className="bi bi-ui-radios-grid" />投票 {message.poll.total_votes || 0} 票</span> : null}
                    <span className="text-sm text-muted">{message.timestamp || message.time}</span>
                  </div>
                  <p className="message-text line-clamp-3">{message.text || message.poll?.question || '附件留言'}</p>
                  {reviewConstraintText(message) ? <div className="info-callout status-warning mt-3 p-3 text-sm"><i className="bi bi-person-lock" /><span>{reviewConstraintText(message)}</span></div> : null}
                  {message.moderation_status === 'hidden' ? <p className="mt-2 text-sm text-danger">下架原因：{message.hidden_reason || '违反社区规范'}</p> : null}
                  <div className="mt-2"><BoundUser message={message} /></div>
                  <div className="mt-2 flex gap-4 text-sm text-muted"><span><i className="bi bi-heart" /> {message.likes || 0}</span><span><i className="bi bi-chat" /> {message.comments?.length || 0}</span></div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 self-start md:w-48">
                <button className={`btn btn-sm justify-center ${message.review_status === 'approved' ? 'btn-outline' : 'btn-success'}`} disabled={busy || Boolean(reviewConstraintText(message))} title={reviewConstraintText(message) || (message.review_status === 'approved' ? '退回待审核队列' : '通过审核并按发布规则公开')} onClick={() => review(message, message.review_status === 'approved' ? 'return' : 'approve')}>
                  <i className={`bi ${message.review_status === 'approved' ? 'bi-arrow-counterclockwise' : 'bi-check-circle'}`} />
                  {message.review_status === 'approved' ? '退回待审' : '通过审核'}
                </button>
                <button className="btn btn-sm btn-outline justify-center" onClick={() => detail(message)}><i className="bi bi-info-circle" />详情</button>
                {canManage ? <>
                  <button className="btn btn-sm btn-outline justify-center" disabled={busy} onClick={() => updateModeration(message, { pinned: !message.pinned })}><i className="bi bi-pin-angle" />{message.pinned ? '取消置顶' : '置顶'}</button>
                  <button className="btn btn-sm btn-outline justify-center" disabled={busy} onClick={() => updateModeration(message, { featured: !message.featured })}><i className="bi bi-star-fill" />{message.featured ? '取消精华' : '设为精华'}</button>
                  <button className={`btn btn-sm col-span-2 justify-center ${message.moderation_status === 'hidden' ? 'btn-success' : 'btn-outline'}`} disabled={busy} onClick={() => message.moderation_status === 'hidden' ? updateModeration(message, { hidden: false }) : openHideDialog(message)}>
                    <i className={`bi ${message.moderation_status === 'hidden' ? 'bi-eye' : 'bi-eye-slash'}`} />
                    {message.moderation_status === 'hidden' ? '恢复' : '下架留言'}
                  </button>
                  <button className="btn btn-sm btn-danger col-span-2 justify-center" disabled={busy} onClick={() => setDeleteTarget(message)}><i className="bi bi-trash3" />移入回收站</button>
                </> : null}
              </div>
            </div>
          </article>
        ))}
      </div>

      {totalPages > 1 ? (
        <div className="mt-5 flex items-center justify-center gap-3">
          <button className="btn btn-sm btn-outline" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(value - 1, 1))}><i className="bi bi-chevron-left" />上一页</button>
          <span className="text-sm text-muted">第 {page} / {totalPages} 页</span>
          <button className="btn btn-sm btn-outline" type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>下一页<i className="bi bi-chevron-right" /></button>
        </div>
      ) : null}

      <Modal visible={Boolean(selected)} title={`留言详情 #${selected?.id || ''}`} width="900px" onClose={() => setSelected(null)}>
        {selected ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <ReviewBadge message={selected} />
              {selected.official ? <span className="badge"><i className="bi bi-patch-check-fill" />官方帖子</span> : null}
              {selected.moderation_status === 'hidden' ? <span className="badge status-danger"><i className="bi bi-eye-slash" />已下架</span> : null}
              {selected.pinned ? <span className="badge status-warning"><i className="bi bi-pin-angle" />已置顶</span> : null}
              {selected.featured ? <span className="badge status-success"><i className="bi bi-star-fill" />精华</span> : null}
            </div>

            {reviewConstraintText(selected) ? (
              <div className="info-callout status-warning p-4 text-sm">
                <i className="bi bi-person-lock" />
                <div><b>此帖不能由你审核</b><p className="mt-1">{reviewConstraintText(selected)}</p></div>
              </div>
            ) : null}

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="留言摘要">
              <div className="card-flat p-3"><span className="block text-xs text-muted">提交时间</span><b className="mt-1 block text-sm">{formatTime(selected.timestamp || selected.time)}</b></div>
              <div className="card-flat p-3"><span className="block text-xs text-muted">公开状态</span><b className="mt-1 block text-sm">{selected.moderation_status === 'pending' ? '等待审核，尚未公开' : selected.moderation_status === 'hidden' ? '已下架' : '已公开'}</b></div>
              <div className="card-flat p-3"><span className="block text-xs text-muted">互动</span><b className="mt-1 block text-sm">{selected.likes || 0} 赞 · {selected.dislikes || 0} 踩</b></div>
              <div className="card-flat p-3"><span className="block text-xs text-muted">评论</span><b className="mt-1 block text-sm">{selected.comments?.length || 0} 条</b></div>
            </section>

            <section className="info-callout p-4">
              <div>
                <h3 className="mb-2 text-sm font-bold">发布者</h3>
                <BoundUser message={selected} />
              </div>
            </section>

            <section className="card-flat p-4">
              <h3 className="text-sm font-bold">帖子内容</h3>
              <p className="message-text mt-3 whitespace-pre-wrap break-words">{selected.text || selected.poll?.question || (selected.files?.length ? '此帖只包含附件' : '此帖没有文字内容')}</p>
              {tagNames(selected).length ? <div className="mt-4 flex flex-wrap gap-2">{tagNames(selected).map((tag) => <span className="badge" key={tag}>#{tag}</span>)}</div> : null}
            </section>

            {selected.poll ? (
              <section className="card-flat p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">投票</h3><span className="badge">{selected.poll.total_votes || 0} 票</span></div>
                <p className="mt-2 font-semibold">{selected.poll.question}</p>
                <div className="mt-3 space-y-2">{(selected.poll.options || []).map((option, index) => <div className="flex items-center justify-between rounded-lg bg-[var(--card-secondary-bg)] px-3 py-2 text-sm" key={option.id || index}><span>{option.text || option.label || `选项 ${index + 1}`}</span><b>{option.votes || 0} 票</b></div>)}</div>
              </section>
            ) : null}

            <AttachmentList files={selected.files || selected.filenames || []} />

            {selected.moderation_status === 'hidden' ? <div className="info-callout status-danger p-4"><i className="bi bi-eye-slash" /><span><b>下架原因：</b>{selected.hidden_reason || '违反社区规范'}</span></div> : null}

            {!reviewConstraintText(selected) && selected.review_status !== 'approved' ? (
              <button className="btn btn-success w-full justify-center" type="button" disabled={busy} onClick={async () => { if (await review(selected, 'approve')) setSelected(null) }}><i className="bi bi-check-circle" />通过这条帖子</button>
            ) : null}

            <section className="space-y-2">
              <h3 className="text-sm font-bold">评论（{selected.comments?.length || 0}）</h3>
              {selected.comments?.length ? selected.comments.map((comment) => (
                <div className="comment-item" key={comment.id}>
                  <p className="whitespace-pre-wrap break-words">{comment.text}</p>
                  <p className="mt-2 text-xs text-muted">{comment.user ? `评论用户：${comment.user.nickname || comment.user.username || '已登录用户'}` : '匿名评论'} · {formatTime(comment.timestamp || comment.time)}</p>
                  {canManage ? <button className="btn btn-sm btn-danger mt-2" type="button" onClick={() => deleteComment(selected.id, comment.id)}>移入回收站</button> : null}
                </div>
              )) : <p className="rounded-xl bg-[var(--card-secondary-bg)] p-4 text-sm text-muted">暂无评论</p>}
            </section>
          </div>
        ) : null}
      </Modal>

      <Modal visible={canManage && Boolean(deleteTarget)} title="将留言移入回收站" onClose={() => !busy && setDeleteTarget(null)} footer={<><button className="btn btn-outline" disabled={busy} onClick={() => setDeleteTarget(null)}>取消</button><button className="btn btn-danger" disabled={busy} onClick={remove}>确认移入</button></>}>
        <p>留言 #{deleteTarget?.id} 将立即从公开页面和管理队列移除，可在“内容回收站”恢复或彻底删除。</p>
      </Modal>

      <Modal
        visible={canManage && Boolean(hideTarget)}
        title={hideTarget?.bulk ? `批量下架 ${hideTarget.count || selectedMessages.length} 条留言` : `下架留言 #${hideTarget?.id || ''}`}
        onClose={() => !busy && setHideTarget(null)}
        footer={<><button className="btn btn-outline" disabled={busy} onClick={() => setHideTarget(null)}>取消</button><button className="btn btn-danger" disabled={busy || !hideReason.trim()} onClick={confirmHide}>确认下架</button></>}
      >
        <p className="mb-3 text-sm text-muted">下架后公开页面不可见，登录作者仍可在“我的发布”中查看原因。</p>
        <label className="block space-y-2">
          <span className="font-bold">下架原因</span>
          <textarea className="field min-h-28 w-full" maxLength={200} value={hideReason} onChange={(event) => setHideReason(event.target.value)} placeholder="请输入给作者看的下架原因" />
          <span className="block text-right text-xs text-muted">{hideReason.length}/200</span>
        </label>
      </Modal>
    </AdminShell>
  )
}
