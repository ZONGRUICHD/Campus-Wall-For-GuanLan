import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminShell from '../../components/AdminShell.jsx'
import Modal from '../../components/Modal.jsx'
import { useAlert } from '../../contexts/AlertContext.jsx'
import api from '../../services/api'

const statusOptions = [
  { value: 'all', label: '全部', icon: 'bi-collection' },
  { value: 'visible', label: '公开中', icon: 'bi-eye' },
  { value: 'hidden', label: '已下架', icon: 'bi-eye-slash' }
]

const commentKey = (comment) => `${comment.message_id}:${comment.id}`

function CommentUser({ comment }) {
  if (!comment.user_id) return <span className="text-sm text-muted">游客评论</span>
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <span className="badge">学号：{comment.user?.username || comment.username || '-'}</span>
      <span className="badge">姓名：{comment.user?.real_name || '-'}</span>
      <span className="badge">昵称：{comment.user?.nickname || '-'}</span>
      <span className="badge">账号：{comment.user?.status || '-'}</span>
    </div>
  )
}

export default function AdminComments() {
  const [comments, setComments] = useState([])
  const [status, setStatus] = useState('all')
  const [counts, setCounts] = useState({ all: 0, visible: 0, hidden: 0 })
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [selectedKeys, setSelectedKeys] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hideTarget, setHideTarget] = useState(null)
  const [hideReason, setHideReason] = useState('违反社区规范')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const alert = useAlert()

  const load = async () => {
    setLoading(true)
    try {
      const response = await api.adminGetComments({ status, q: appliedQuery, page, page_size: 20 })
      const data = response.data || {}
      setComments(data.comments || [])
      setCounts(data.counts || { all: 0, visible: 0, hidden: 0 })
      setTotal(data.total || 0)
      setTotalPages(data.total_pages || 0)
      setSelectedKeys([])
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '评论加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [status, page, appliedQuery])

  const selectedComments = useMemo(() => comments.filter((comment) => selectedKeys.includes(commentKey(comment))), [comments, selectedKeys])
  const allPageSelected = comments.length > 0 && comments.every((comment) => selectedKeys.includes(commentKey(comment)))

  const changeStatus = (nextStatus) => {
    setStatus(nextStatus)
    setPage(1)
  }

  const submitSearch = () => {
    setAppliedQuery(query.trim())
    setPage(1)
  }

  const toggleComment = (comment) => {
    const key = commentKey(comment)
    setSelectedKeys((keys) => keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key])
  }

  const togglePage = () => setSelectedKeys(allPageSelected ? [] : comments.map(commentKey))

  const updateComment = async (comment, hidden, hiddenReason = '') => {
    setBusy(true)
    try {
      const response = await api.adminUpdateCommentModeration(comment.message_id, comment.id, {
        hidden,
        hidden_reason: hiddenReason
      })
      if (!response.data?.success) throw new Error(response.data?.error || '评论状态更新失败')
      alert.showTopRightAlert(hidden ? '评论已下架' : '评论已恢复公开', 'success', '操作完成')
      setHideTarget(null)
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const runBulk = async (action, hiddenReason = '') => {
    if (!selectedComments.length) return
    setBusy(true)
    try {
      const response = await api.adminBulkModerateComments({
        action,
        hidden_reason: hiddenReason,
        targets: selectedComments.map((comment) => ({ message_id: comment.message_id, comment_id: comment.id }))
      })
      const data = response.data || {}
      if (!data.success) throw new Error(data.error || '批量操作失败')
      alert.showTopRightAlert(`成功处理 ${data.succeeded || 0} 条评论`, data.failed ? 'warning' : 'success', data.failed ? '部分完成' : '操作完成')
      setHideTarget(null)
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '批量操作失败')
    } finally {
      setBusy(false)
    }
  }

  const openHide = (target) => {
    setHideReason(target?.hidden_reason || '违反社区规范')
    setHideTarget(target)
  }

  const confirmHide = async () => {
    if (!hideTarget || !hideReason.trim()) return
    if (hideTarget.bulk) await runBulk('hide', hideReason.trim())
    else await updateComment(hideTarget, true, hideReason.trim())
  }

  const deleteComment = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      const response = await api.adminDeleteComment(deleteTarget.message_id, deleteTarget.id)
      if (!response.data?.success) throw new Error(response.data?.error || '评论删除失败')
      setDeleteTarget(null)
      alert.showTopRightAlert('评论已移入回收站', 'success', '操作完成')
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '删除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminShell title="评论管理">
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="评论状态筛选">
        {statusOptions.map((option) => (
          <button className={`btn btn-sm ${status === option.value ? 'btn-primary' : 'btn-outline'}`} type="button" role="tab" aria-selected={status === option.value} key={option.value} onClick={() => changeStatus(option.value)}>
            <i className={`bi ${option.icon}`} />
            <span>{option.label}</span>
            <span className="badge">{counts[option.value] || 0}</span>
          </button>
        ))}
      </div>

      <div className="admin-toolbar mb-4">
        <input className="field admin-toolbar-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submitSearch()} placeholder="搜索评论或原帖内容..." />
        <button className="btn btn-primary" type="button" onClick={submitSearch}><i className="bi bi-search" />搜索</button>
        <button className="btn btn-outline" type="button" onClick={load}><i className="bi bi-arrow-clockwise" />刷新</button>
      </div>

      <div className="mb-4 flex min-h-12 flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--card-secondary-bg)] px-4 py-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-bold"><input type="checkbox" checked={allPageSelected} onChange={togglePage} /><span>本页全选</span></label>
        <span className="text-sm text-muted">当前筛选 {total} 条，已选 {selectedKeys.length} 条</span>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-sm btn-danger" type="button" disabled={!selectedKeys.length || busy} onClick={() => openHide({ bulk: true, count: selectedKeys.length })}><i className="bi bi-eye-slash" />批量下架</button>
          <button className="btn btn-sm btn-success" type="button" disabled={!selectedKeys.length || busy} onClick={() => runBulk('restore')}><i className="bi bi-eye" />批量恢复</button>
        </div>
      </div>

      {loading ? <div className="page-center"><div className="spinner" /></div> : null}
      {!loading && !comments.length ? (
        <div className="empty-state-card"><i className="bi bi-chat-left-dots" /><h2 className="mt-3 text-lg font-bold">当前没有评论</h2><p className="mt-1 text-sm text-muted">没有符合当前条件的评论记录。</p></div>
      ) : null}

      <div className="space-y-3">
        {comments.map((comment) => {
          const hidden = comment.moderation_status === 'hidden'
          return (
            <article className={`card p-4 ${hidden ? 'admin-message-hidden' : ''}`} key={commentKey(comment)}>
              <div className="flex flex-col gap-4 lg:flex-row lg:justify-between">
                <div className="flex min-w-0 flex-1 gap-3">
                  <input className="mt-1 h-5 w-5 shrink-0" type="checkbox" checked={selectedKeys.includes(commentKey(comment))} onChange={() => toggleComment(comment)} aria-label={`选择评论 ${comment.id}`} />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`badge ${hidden ? 'status-danger' : 'status-success'}`}><i className={`bi ${hidden ? 'bi-eye-slash' : 'bi-eye'}`} />{hidden ? '已下架' : '公开中'}</span>
                      <span className="badge">留言 #{comment.message_id} · {comment.floor} 楼</span>
                      {comment.refer_id ? <span className="badge"><i className="bi bi-reply-fill" />回复</span> : null}
                      <span className="text-sm text-muted">{comment.timestamp || '未知时间'}</span>
                    </div>
                    <p className="message-text">{comment.text || ((comment.files || []).length ? '附件评论' : '空评论')}</p>
                    {comment.refer_id ? <div className="comment-reference"><i className="bi bi-reply-fill" /><b>引用</b><span>{comment.refer || '原评论不可见'}</span></div> : null}
                    {hidden ? <p className="text-sm text-danger">下架原因：{comment.hidden_reason || '违反社区规范'}</p> : null}
                    <CommentUser comment={comment} />
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                      <span className="truncate">原帖：{comment.message_preview || '附件留言'}</span>
                      {comment.message_moderation_status === 'visible' ? <Link className="text-link" to={`/wall/message/${comment.message_id}`} target="_blank">打开原帖 <i className="bi bi-box-arrow-up-right" /></Link> : <span className="badge">原帖未公开</span>}
                    </div>
                    {(comment.files || []).length ? <div className="flex flex-wrap gap-2">{comment.files.map((file) => <span className="badge" key={file}><i className="bi bi-paperclip" />{file}</span>)}</div> : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 self-start lg:w-44 lg:flex-col">
                  <button className={`btn btn-sm justify-center ${hidden ? 'btn-success' : 'btn-outline'}`} type="button" disabled={busy} onClick={() => hidden ? updateComment(comment, false) : openHide(comment)}><i className={`bi ${hidden ? 'bi-eye' : 'bi-eye-slash'}`} />{hidden ? '恢复公开' : '下架评论'}</button>
                  <button className="btn btn-sm btn-danger justify-center" type="button" disabled={busy} onClick={() => setDeleteTarget(comment)}><i className="bi bi-trash3" />移入回收站</button>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {totalPages > 1 ? (
        <div className="mt-5 flex items-center justify-center gap-3">
          <button className="btn btn-sm btn-outline" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><i className="bi bi-chevron-left" />上一页</button>
          <span className="text-sm text-muted">第 {page} / {totalPages} 页</span>
          <button className="btn btn-sm btn-outline" type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>下一页<i className="bi bi-chevron-right" /></button>
        </div>
      ) : null}

      <Modal
        visible={Boolean(hideTarget)}
        title={hideTarget?.bulk ? `批量下架 ${hideTarget.count || selectedComments.length} 条评论` : `下架评论 · 留言 #${hideTarget?.message_id || ''}`}
        onClose={() => !busy && setHideTarget(null)}
        footer={<><button className="btn btn-outline" disabled={busy} onClick={() => setHideTarget(null)}>取消</button><button className="btn btn-danger" disabled={busy || !hideReason.trim()} onClick={confirmHide}>确认下架</button></>}
      >
        <label className="block space-y-2"><span className="font-bold">下架原因</span><textarea className="field min-h-28 w-full" maxLength={200} value={hideReason} onChange={(event) => setHideReason(event.target.value)} /><span className="block text-right text-xs text-muted">{hideReason.length}/200</span></label>
      </Modal>

      <Modal visible={Boolean(deleteTarget)} title="将评论移入回收站" onClose={() => !busy && setDeleteTarget(null)} footer={<><button className="btn btn-outline" disabled={busy} onClick={() => setDeleteTarget(null)}>取消</button><button className="btn btn-danger" disabled={busy} onClick={deleteComment}>确认移入</button></>}>
        <p className="text-sm text-[var(--text-secondary)]">评论将从公开页面和评论管理队列移除，可在“内容回收站”恢复或彻底删除。</p>
      </Modal>
    </AdminShell>
  )
}
