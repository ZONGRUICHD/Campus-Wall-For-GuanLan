import { useEffect, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import api from '../../services/api'
import { useAlert } from '../../contexts/AlertContext.jsx'

export default function AdminNotice() {
  const [notices, setNotices] = useState([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [editText, setEditText] = useState('')
  const alert = useAlert()

  const load = async () => {
    setLoading(true)
    try {
      const response = await api.adminGetNotice()
      const items = Array.isArray(response.data?.content) ? response.data.content : []
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
      if (response.data?.success) {
        setText('')
        alert.showTopRightAlert('公告发布成功', 'success', '成功')
        load()
      }
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
    try {
      const response = await api.adminUpdateNotice(getNoticeId(notice), editText.trim())
      if (response.data?.success) {
        cancelEdit()
        alert.showTopRightAlert('公告已更新', 'success', '成功')
        load()
      }
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '编辑失败')
    }
  }

  const retract = async (notice) => {
    if (!window.confirm('确定要收回这条公告吗？')) return
    try {
      const response = await api.adminDeleteNotice(getNoticeId(notice))
      if (response.data?.success) {
        alert.showTopRightAlert('公告已收回', 'success', '成功')
        load()
      }
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '收回失败')
    }
  }

  const latestNotice = notices[0]

  return (
    <AdminShell title="公告管理">
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="card-flat admin-stat-card"><b>{notices.length}</b><p className="text-muted">历史公告</p></div>
          <div className="card-flat admin-stat-card"><b>{latestNotice ? '1' : '0'}</b><p className="text-muted">当前最新</p></div>
          <div className="card-flat admin-stat-card"><b>{notices.filter((notice) => notice.updated_at).length}</b><p className="text-muted">已编辑</p></div>
        </div>

        <section className="card composer-card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="page-kicker"><i className="bi bi-megaphone" />公告</span>
              <h2 className="mt-2 text-lg font-bold">发布新公告</h2>
            </div>
            <span className="text-sm text-muted">公告会立即展示在前台首页</span>
          </div>
          <textarea className="field min-h-40" value={text} onChange={(event) => setText(event.target.value)} placeholder="输入公告内容" />
          <div className="mt-3 flex justify-end">
            <button className="btn btn-primary" disabled={submitting} onClick={submit}>
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
                  <span className="badge">{notice.user || '管理员'}</span>
                  <span>{notice.timestamp}</span>
                  {notice.updated_at ? <span>编辑于 {notice.updated_at}</span> : null}
                </div>
                {editingId === getNoticeId(notice) ? (
                  <textarea className="field mt-3 min-h-28" value={editText} onChange={(event) => setEditText(event.target.value)} />
                ) : (
                  <p className="message-text mt-3">{notice.content}</p>
                )}
              </div>
              <div className="notice-actions flex flex-wrap justify-end gap-2">
                {editingId === getNoticeId(notice) ? (
                  <>
                    <button className="btn btn-sm btn-outline" onClick={cancelEdit}>取消</button>
                    <button className="btn btn-sm btn-primary" onClick={() => saveEdit(notice)}>保存</button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-sm btn-outline" onClick={() => startEdit(notice)}><i className="bi bi-pencil" />编辑</button>
                    <button className="btn btn-sm btn-danger" onClick={() => retract(notice)}><i className="bi bi-arrow-counterclockwise" />收回</button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </AdminShell>
  )
}
