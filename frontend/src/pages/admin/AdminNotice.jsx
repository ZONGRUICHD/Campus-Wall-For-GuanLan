import { useEffect, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import Modal from '../../components/Modal.jsx'
import api from '../../services/api'
import { useAlert } from '../../contexts/AlertContext.jsx'

const defaultMaxNoticeLength = 10000
const noticeDateTime = (value) => value ? String(value).replace(' ', 'T') : undefined

export default function AdminNotice() {
  const [notices, setNotices] = useState([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [editText, setEditText] = useState('')
  const [savingId, setSavingId] = useState('')
  const [retractTarget, setRetractTarget] = useState(null)
  const [retracting, setRetracting] = useState(false)
  const [maxNoticeLength, setMaxNoticeLength] = useState(defaultMaxNoticeLength)
  const alert = useAlert()

  const load = async () => {
    setLoading(true)
    try {
      const response = await api.adminGetNotice()
      const items = Array.isArray(response.data?.content) ? response.data.content : []
      const configuredMaxLength = Number(response.data?.max_length)
      if (Number.isSafeInteger(configuredMaxLength) && configuredMaxLength > 0) setMaxNoticeLength(configuredMaxLength)
      setNotices(items.map((notice, index) => ({ ...notice, _index: index })).reverse())
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '加载公告失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const submit = async () => {
    if (!text.trim()) return
    setSubmitting(true)
    try {
      const response = await api.adminPostNotice(text.trim())
      if (!response.data?.success) throw new Error(response.data?.error || '公告发布失败')
      setText('')
      alert.showTopRightAlert('公告发布成功', 'success', '成功')
      load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '发布失败')
    } finally {
      setSubmitting(false)
    }
  }

  const getNoticeId = (notice) => notice.id || String(notice._index)

  const startEdit = (notice) => {
    setEditingId(getNoticeId(notice))
    setEditText(notice.content || '')
  }

  const cancelEdit = () => {
    setEditingId('')
    setEditText('')
  }

  const saveEdit = async (notice) => {
    if (!editText.trim()) return
    const noticeId = getNoticeId(notice)
    setSavingId(noticeId)
    try {
      const response = await api.adminUpdateNotice(noticeId, editText.trim())
      if (!response.data?.success) throw new Error(response.data?.error || '公告更新失败')
      cancelEdit()
      alert.showTopRightAlert('公告已更新', 'success', '成功')
      load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '编辑失败')
    } finally {
      setSavingId('')
    }
  }

  const retract = async () => {
    if (!retractTarget) return
    setRetracting(true)
    try {
      const response = await api.adminDeleteNotice(getNoticeId(retractTarget))
      if (!response.data?.success) throw new Error(response.data?.error || '公告收回失败')
      setRetractTarget(null)
      alert.showTopRightAlert('公告已收回', 'success', '成功')
      load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '收回失败')
    } finally {
      setRetracting(false)
    }
  }

  const latestNotice = notices[0]

  return (
    <AdminShell title="公告管理">
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="card-flat admin-stat-card"><b>{notices.length}</b><p className="text-muted">主页公告</p></div>
          <div className="card-flat admin-stat-card"><b>{latestNotice ? '已发布' : '暂无'}</b><p className="text-muted">当前状态</p></div>
          <div className="card-flat admin-stat-card"><b>{notices.filter((notice) => notice.updated_at).length}</b><p className="text-muted">已编辑</p></div>
        </div>

        <section className="card composer-card p-5" aria-labelledby="notice-composer-title">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="page-kicker"><i className="bi bi-megaphone" />公告</span>
              <h2 id="notice-composer-title" className="mt-2 text-lg font-bold">发布新公告</h2>
            </div>
            <span className="text-sm text-muted">发布后会立即出现在首页，三类管理角色均可维护</span>
          </div>
          <textarea id="notice-content-input" className="field min-h-40" aria-label="新公告内容" aria-describedby="notice-content-count" value={text} maxLength={maxNoticeLength} onChange={(event) => setText(event.target.value)} placeholder="输入公告内容，支持分段换行" />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span id="notice-content-count" className="text-xs text-muted">{text.length}/{maxNoticeLength}</span>
            <button className="btn btn-primary" type="button" disabled={submitting || !text.trim()} onClick={submit}>
              <i className="bi bi-send" />{submitting ? '发布中...' : '发布公告'}
            </button>
          </div>
        </section>
        <div className="admin-toolbar">
          <div className="mr-auto">
            <h2 className="text-lg font-bold"><i className="bi bi-list mr-2" />历史公告</h2>
            <p className="text-sm text-muted">可编辑公告内容，也可以收回不再展示。</p>
          </div>
          <button className="btn btn-sm btn-outline" onClick={load}><i className="bi bi-arrow-clockwise" />刷新</button>
        </div>
        {loading ? <div className="page-center"><div className="spinner" /></div> : null}
        {!loading && notices.length === 0 ? <div className="empty-state-card"><i className="bi bi-inbox text-6xl" /><p className="mt-3">暂无公告</p></div> : null}
        <div className="space-y-3">
          {notices.map((notice, index) => (
            <article className="notice-card card flex flex-col p-4" key={notice.id || `${notice.timestamp}-${index}`}>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span className="badge">{notice.user || '管理成员'}</span>
                  <time dateTime={noticeDateTime(notice.timestamp)}>{notice.timestamp}</time>
                  {notice.updated_at ? <time dateTime={noticeDateTime(notice.updated_at)}>编辑于 {notice.updated_at}</time> : null}
                </div>
                {editingId === getNoticeId(notice) ? (
                  <div className="mt-3">
                    <textarea className="field min-h-28" aria-label="编辑公告内容" aria-describedby={`notice-edit-count-${getNoticeId(notice)}`} value={editText} maxLength={maxNoticeLength} onChange={(event) => setEditText(event.target.value)} />
                    <span id={`notice-edit-count-${getNoticeId(notice)}`} className="mt-2 block text-xs text-muted">{editText.length}/{maxNoticeLength}</span>
                  </div>
                ) : (
                  <p className="message-text mt-3">{notice.content}</p>
                )}
              </div>
              <div className="notice-actions flex flex-wrap justify-end gap-2">
                {editingId === getNoticeId(notice) ? (
                  <>
                    <button className="btn btn-sm btn-outline" disabled={savingId === getNoticeId(notice)} onClick={cancelEdit}>取消</button>
                    <button className="btn btn-sm btn-primary" disabled={!editText.trim() || savingId === getNoticeId(notice)} onClick={() => saveEdit(notice)}>{savingId === getNoticeId(notice) ? '保存中...' : '保存'}</button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-sm btn-outline" onClick={() => startEdit(notice)}><i className="bi bi-pencil" />编辑</button>
                    <button className="btn btn-sm btn-danger" onClick={() => setRetractTarget(notice)}><i className="bi bi-arrow-counterclockwise" />收回</button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
      <Modal
        visible={Boolean(retractTarget)}
        title="收回公告"
        onClose={() => !retracting && setRetractTarget(null)}
        footer={(
          <>
            <button className="btn btn-outline" type="button" disabled={retracting} onClick={() => setRetractTarget(null)}>取消</button>
            <button className="btn btn-danger" type="button" disabled={retracting} onClick={retract}>
              <i className="bi bi-arrow-counterclockwise" />{retracting ? '正在收回...' : '确认收回'}
            </button>
          </>
        )}
      >
        <p className="text-sm text-muted">收回后，这条公告会立即从首页移除，且不能在此处直接撤销。</p>
      </Modal>
    </AdminShell>
  )
}
