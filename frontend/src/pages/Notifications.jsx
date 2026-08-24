import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import api from '../services/api'
import Modal from '../components/Modal.jsx'
import { useAlert } from '../contexts/AlertContext.jsx'
import { useUser } from '../contexts/UserContext.jsx'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const PAGE_SIZE = 20

const notificationMeta = (notification) => {
  if (notification.type === 'reply') {
    return { icon: 'bi-reply-fill', title: '有人回复了你的评论', action: '查看回复', destination: notification.message_id ? `/wall/message/${notification.message_id}` : '/me/posts' }
  }
  if (notification.type === 'featured') {
    return { icon: 'bi-star-fill', title: '你的留言被设为精华', action: '查看留言', destination: notification.message_id ? `/wall/message/${notification.message_id}` : '/me/posts' }
  }
  if (notification.type === 'moderation') {
    return { icon: 'bi-shield-exclamation', title: '你的留言状态有更新', action: '查看我的发布', destination: '/me/posts' }
  }
  if (notification.type === 'comment_moderation') {
    return { icon: 'bi-shield-exclamation', title: '你的评论状态有更新', action: '查看我的评论', destination: '/me/comments' }
  }
  return { icon: 'bi-chat-dots', title: '有人评论了你的留言', action: '查看留言', destination: notification.message_id ? `/wall/message/${notification.message_id}` : '/me/posts' }
}

export default function Notifications() {
  const { user, loading: userLoading, setNotificationUnread } = useUser()
  const [notifications, setNotifications] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const navigate = useNavigate()
  const alert = useAlert()

  const loadNotifications = async (nextPage = 1, append = false) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    try {
      const response = await api.userNotifications({ page: nextPage, page_size: PAGE_SIZE })
      const incoming = response.data?.notifications || []
      setNotifications((current) => append ? [...current, ...incoming] : incoming)
      setPage(response.data?.page || nextPage)
      setTotal(response.data?.total || 0)
      setTotalPages(response.data?.total_pages || 0)
      setUnread(response.data?.unread || 0)
      setNotificationUnread(response.data?.unread || 0)
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '通知加载失败')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    if (user) loadNotifications(1, false)
  }, [user?.id])

  if (userLoading) {
    return (
      <div className="page-center">
        <div className="spinner" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  const openNotification = async (notification) => {
    if (!notification.is_read) {
      try {
        await api.userMarkNotificationRead(notification.id)
        setNotifications((items) => items.map((item) => item.id === notification.id ? { ...item, is_read: true } : item))
        setUnread((value) => Math.max(value - 1, 0))
        setNotificationUnread((value) => Math.max(value - 1, 0))
      } catch {}
    }
    navigate(notificationMeta(notification).destination)
  }

  const markAllRead = async () => {
    setMarkingAll(true)
    try {
      await api.userMarkAllNotificationsRead()
      setNotifications((items) => items.map((item) => ({ ...item, is_read: true })))
      setUnread(0)
      setNotificationUnread(0)
      alert.showTopRightAlert('所有通知已标记为已读', 'success', '操作成功')
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '操作失败')
    } finally {
      setMarkingAll(false)
    }
  }

  const deleteNotification = async (notification) => {
    setDeletingId(notification.id)
    try {
      await api.userDeleteNotification(notification.id)
      setNotifications((items) => items.filter((item) => item.id !== notification.id))
      const nextTotal = Math.max(total - 1, 0)
      setTotal(nextTotal)
      setTotalPages(Math.ceil(nextTotal / PAGE_SIZE))
      if (!notification.is_read) {
        setUnread((value) => Math.max(value - 1, 0))
        setNotificationUnread((value) => Math.max(value - 1, 0))
      }
      alert.showTopRightAlert('通知已删除', 'success', '操作成功')
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  const clearNotifications = async () => {
    setClearing(true)
    try {
      await api.userClearNotifications()
      setNotifications([])
      setPage(1)
      setTotal(0)
      setTotalPages(0)
      setUnread(0)
      setNotificationUnread(0)
      setClearOpen(false)
      alert.showTopRightAlert('通知已清空', 'success', '操作成功')
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '清空失败')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="wall-overview p-6 md:p-8">
        <div className="wall-overview-copy space-y-2">
          <span className="page-kicker">
            <i className="bi bi-bell-fill text-amber-500" />
            <span>Notifications</span>
          </span>
          <h1 className="text-3xl font-black text-[var(--text-primary)]">消息通知</h1>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">评论、精华与内容状态变化会在这里提醒你。</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="wall-stat-card min-w-28">
            <b>{unread}</b>
            <span>未读通知</span>
          </div>
          {unread ? (
            <button className="btn btn-primary" type="button" disabled={markingAll} onClick={markAllRead}>
              <i className="bi bi-check-all" />
              <span>{markingAll ? '处理中...' : '全部已读'}</span>
            </button>
          ) : null}
          {total ? (
            <button className="btn btn-outline" type="button" onClick={() => setClearOpen(true)}>
              <i className="bi bi-trash3" />
              <span>清空通知</span>
            </button>
          ) : null}
          <Link className="btn btn-outline" to="/me">
            <i className="bi bi-person" />
            <span>个人中心</span>
          </Link>
        </div>
      </section>

      {loading ? (
        <div className="card divide-y divide-[var(--border-color)] overflow-hidden">
          {[1, 2, 3].map((item) => <div className="skeleton m-5 h-16" key={item} />)}
        </div>
      ) : null}

      {!loading && notifications.length === 0 ? (
        <section className="empty-state-card">
          <i className="bi bi-inbox" />
          <h2 className="mt-4 text-lg font-bold text-[var(--text-primary)]">暂时没有通知</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">新的互动与内容状态提醒会显示在这里。</p>
        </section>
      ) : null}

      {notifications.length ? (
        <section className="card overflow-hidden divide-y divide-[var(--border-color)]">
          {notifications.map((notification) => {
            const meta = notificationMeta(notification)
            return (
              <article className={`notification-row ${notification.is_read ? '' : 'is-unread'}`} key={notification.id}>
                <button className="notification-open-button" type="button" onClick={() => openNotification(notification)}>
                  <span className="flex items-start gap-3">
                    <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${notification.is_read ? 'bg-[var(--card-secondary-bg)] text-[var(--text-muted)]' : 'bg-[var(--primary-color)] text-white'}`}>
                      <i className={`bi ${meta.icon}`} />
                    </span>
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <b className="text-sm text-[var(--text-primary)]">{meta.title}</b>
                        <span className="text-xs text-[var(--text-muted)]">{dayjs(notification.created_at).fromNow()}</span>
                      </span>
                      <span className="block truncate text-sm text-[var(--text-secondary)]">{notification.content || '查看最新回复'}</span>
                      <span className="block text-xs font-bold text-[var(--primary-color)]">{meta.action}</span>
                    </span>
                    {!notification.is_read ? <span className="mt-4 h-2 w-2 shrink-0 rounded-full bg-rose-500" /> : null}
                  </span>
                </button>
                <button
                  className="notification-remove-button"
                  type="button"
                  title="删除这条通知"
                  aria-label="删除这条通知"
                  disabled={deletingId === notification.id}
                  onClick={() => deleteNotification(notification)}
                >
                  <i className={`bi ${deletingId === notification.id ? 'bi-hourglass-split' : 'bi-trash3'}`} />
                </button>
              </article>
            )
          })}
        </section>
      ) : null}

      {page < totalPages ? (
        <div className="text-center">
          <button className="btn btn-outline min-w-44" type="button" disabled={loadingMore} onClick={() => loadNotifications(page + 1, true)}>
            <i className="bi bi-plus-circle" />
            <span>{loadingMore ? '加载中...' : '加载更多通知'}</span>
          </button>
        </div>
      ) : null}

      <Modal
        visible={clearOpen}
        title="清空全部通知"
        onClose={() => !clearing && setClearOpen(false)}
        footer={(
          <>
            <button className="btn btn-outline" type="button" disabled={clearing} onClick={() => setClearOpen(false)}>取消</button>
            <button className="btn bg-rose-600 text-white hover:bg-rose-700" type="button" disabled={clearing} onClick={clearNotifications}>
              <i className="bi bi-trash3" />
              <span>{clearing ? '清空中...' : '确认清空'}</span>
            </button>
          </>
        )}
      >
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">清空后无法恢复，所有已读和未读通知都会被删除。</p>
      </Modal>
    </div>
  )
}
