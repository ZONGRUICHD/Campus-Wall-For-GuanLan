import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import api from '../services/api'
import MessageCard from '../components/MessageCard.jsx'
import Modal from '../components/Modal.jsx'
import { useAlert } from '../contexts/AlertContext.jsx'
import { useUser } from '../contexts/UserContext.jsx'
import { usePlatform } from '../contexts/PlatformContext.jsx'

const PAGE_SIZE = 10

export default function MyPosts() {
  const { user, loading: userLoading } = useUser()
  const { community } = usePlatform()
  const [messages, setMessages] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [selectedMessage, setSelectedMessage] = useState(null)
  const [editingMessage, setEditingMessage] = useState(null)
  const [editText, setEditText] = useState('')
  const [editTags, setEditTags] = useState('')
  const [editAnonymous, setEditAnonymous] = useState(true)
  const [savingEdit, setSavingEdit] = useState(false)
  const alert = useAlert()
  const canEdit = community.posting_enabled

  const loadMessages = async (nextPage = 1, append = false) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    try {
      const response = await api.userMessages({ page: nextPage, page_size: PAGE_SIZE })
      const incoming = response.data?.messages || []
      setMessages((current) => append ? [...current, ...incoming] : incoming)
      setPage(response.data?.page || nextPage)
      setTotal(response.data?.total || 0)
      setTotalPages(response.data?.total_pages || 0)
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '发布记录加载失败')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    if (user) loadMessages(1, false)
  }, [user?.id])

  if (userLoading) {
    return (
      <div className="page-center">
        <div className="spinner" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  const deleteMessage = async () => {
    if (!selectedMessage) return
    setDeleting(true)
    try {
      const response = await api.userDeleteMessage(selectedMessage.id)
      if (response.data?.success) {
        setMessages((items) => items.filter((item) => item.id !== selectedMessage.id))
        setTotal((value) => Math.max(value - 1, 0))
        setSelectedMessage(null)
        alert.showTopRightAlert('留言已删除', 'success', '操作成功')
      }
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  const openEditor = (message) => {
    setEditingMessage(message)
    setEditText(message.text || '')
    setEditTags((message.tags || []).join(', '))
    setEditAnonymous(message.anonymous !== false)
  }

  const saveEdit = async () => {
    if (!editingMessage) return
    const tags = [...new Set(editTags.split(',').map((tag) => tag.trim()).filter(Boolean))]
    if (!editText.trim() && !(editingMessage.files || []).length && !editingMessage.poll) {
      alert.showTopRightAlert('留言内容不能为空', 'warning', '无法保存')
      return
    }
    if (tags.length > 8 || tags.some((tag) => tag.length > 50)) {
      alert.showTopRightAlert('最多填写 8 个标签，每个标签不超过 50 个字符', 'warning', '标签不符合要求')
      return
    }
    setSavingEdit(true)
    try {
      const response = await api.userUpdateMessage(editingMessage.id, {
        text: editText.trim(),
        tags: tags.join(','),
        anonymous: editAnonymous
      })
      if (response.data?.success) {
        setMessages((items) => items.map((item) => item.id === editingMessage.id ? response.data.message : item))
        setEditingMessage(null)
        const pendingReview = response.data.message?.moderation_status === 'pending'
        alert.showTopRightAlert(
          pendingReview ? '修改已保存，留言已重新进入审核' : '留言修改已保存',
          'success',
          pendingReview ? '等待审核' : '保存成功'
        )
      }
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '保存失败')
    } finally {
      setSavingEdit(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="wall-overview p-6 md:p-8">
        <div className="wall-overview-copy space-y-2">
          <span className="page-kicker">
            <i className="bi bi-journal-text text-[var(--primary-color)]" />
            <span>My posts</span>
          </span>
          <h1 className="text-3xl font-black text-[var(--text-primary)]">我的发布</h1>
          <p className="max-w-xl text-sm leading-relaxed text-[var(--text-secondary)]">
            这里会显示当前账号发布的全部内容，包括公开页面无法追溯身份的匿名留言。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="wall-stat-card min-w-28">
            <b>{total}</b>
            <span>发布总数</span>
          </div>
          <Link className="btn btn-outline" to="/me">
            <i className="bi bi-person" />
            <span>返回个人中心</span>
          </Link>
        </div>
      </section>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((item) => (
            <div className="card p-6 space-y-4" key={item}>
              <div className="skeleton h-11 w-44" />
              <div className="skeleton h-20 w-full" />
            </div>
          ))}
        </div>
      ) : null}

      {!canEdit ? (
        <div className="info-callout status-warning"><i className="bi bi-info-circle-fill" /><span>{community.pause_reason || '管理员暂时关闭了发帖与留言编辑功能'}</span></div>
      ) : null}

      {!loading && messages.length === 0 ? (
        <section className="empty-state-card">
          <i className="bi bi-journal-text" />
          <h2 className="mt-4 text-lg font-bold text-[var(--text-primary)]">还没有发布记录</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">写下第一条校园动态，它会出现在这里。</p>
          <Link className="btn btn-primary mt-5" to="/wall">
            <i className="bi bi-pencil-square" />
            <span>去发布留言</span>
          </Link>
        </section>
      ) : null}

      <div className="space-y-6">
        {messages.map((message) => (
          <section className="space-y-2" key={message.id}>
            <div className="flex items-center justify-between gap-3 px-1 text-xs text-[var(--text-muted)]">
              <span className="flex items-center gap-1.5 font-bold text-[var(--text-secondary)]">
                <i className={`bi ${message.anonymous === false ? 'bi-person-check-fill' : 'bi-incognito'} text-[var(--primary-color)]`} />
                {message.anonymous === false ? '展示昵称发布' : '匿名发布'}
              </span>
              <span>仅你和管理员可确认归属</span>
            </div>
            {message.moderation_status === 'pending' ? (
              <div className="info-callout status-warning">
                <i className="bi bi-hourglass-split" />
                <span>这条留言正在等待管理员审核，通过后才会出现在公开页面。</span>
              </div>
            ) : null}
            <MessageCard message={message} onEditRequest={canEdit ? openEditor : undefined} onDeleteRequest={setSelectedMessage} />
          </section>
        ))}
      </div>

      {page < totalPages ? (
        <div className="text-center">
          <button
            className="btn btn-outline min-w-44"
            type="button"
            disabled={loadingMore}
            onClick={() => loadMessages(page + 1, true)}
          >
            <i className="bi bi-plus-circle" />
            <span>{loadingMore ? '加载中...' : '加载更多发布'}</span>
          </button>
        </div>
      ) : null}

      <Modal
        visible={Boolean(selectedMessage)}
        title="删除我的留言"
        onClose={() => !deleting && setSelectedMessage(null)}
        footer={(
          <>
            <button className="btn btn-outline" type="button" disabled={deleting} onClick={() => setSelectedMessage(null)}>
              取消
            </button>
            <button className="btn bg-rose-600 text-white hover:bg-rose-700" type="button" disabled={deleting} onClick={deleteMessage}>
              <i className="bi bi-trash" />
              <span>{deleting ? '删除中...' : '确认删除'}</span>
            </button>
          </>
        )}
      >
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          删除后留言会立即从公开页面和你的发布列表中移除，由管理员在回收站中统一保留或清理。
        </p>
      </Modal>

      <Modal
        visible={Boolean(editingMessage)}
        title="编辑我的留言"
        width="760px"
        onClose={() => !savingEdit && setEditingMessage(null)}
        footer={(
          <>
            <button className="btn btn-outline" type="button" disabled={savingEdit} onClick={() => setEditingMessage(null)}>取消</button>
            <button className="btn btn-primary px-6" type="button" disabled={savingEdit} onClick={saveEdit}>
              <i className="bi bi-check-circle" />
              <span>{savingEdit ? '保存中...' : '保存修改'}</span>
            </button>
          </>
        )}
      >
        <div className="space-y-5">
          {editingMessage?.moderation_status === 'hidden' ? (
            <div className="message-hidden-notice">
              <i className="bi bi-eye-slash" />
              <div>
                <b>这条留言仍处于下架状态</b>
                <p>修改内容不会自动恢复展示，请等待管理员复核。</p>
              </div>
            </div>
          ) : null}
          {editingMessage?.moderation_status === 'pending' ? (
            <div className="message-hidden-notice">
              <i className="bi bi-hourglass-split" />
              <div>
                <b>这条留言正在等待审核</b>
                <p>保存修改后仍需管理员通过才会公开。</p>
              </div>
            </div>
          ) : null}

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-[var(--text-secondary)]">留言内容</span>
            <textarea
              className="field min-h-40 w-full"
              value={editText}
              maxLength={2000}
              onChange={(event) => setEditText(event.target.value)}
              placeholder="写下留言内容"
            />
            <span className="block text-right text-xs text-[var(--text-muted)]">{editText.length} / 2000</span>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-[var(--text-secondary)]">标签</span>
            <input
              className="field w-full"
              value={editTags}
              onChange={(event) => setEditTags(event.target.value)}
              placeholder="多个标签使用英文逗号分隔"
            />
            <span className="block text-xs text-[var(--text-muted)]">最多 8 个标签。附件与投票内容保持原样。</span>
          </label>

          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-secondary-bg)] p-4">
            <span className="min-w-0">
              <b className="block text-sm text-[var(--text-primary)]">匿名发布</b>
              <span className="block text-xs text-[var(--text-muted)]">
                {editAnonymous ? '公开页面不会显示你的昵称' : `公开页面将显示“${user.nickname || '未设置昵称'}”`}
              </span>
            </span>
            <input
              className="h-5 w-5 shrink-0 accent-[var(--primary-color)]"
              type="checkbox"
              checked={editAnonymous}
              onChange={(event) => setEditAnonymous(event.target.checked)}
            />
          </label>
        </div>
      </Modal>
    </div>
  )
}
