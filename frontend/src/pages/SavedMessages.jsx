import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import api from '../services/api'
import MessageCard from '../components/MessageCard.jsx'
import { useAlert } from '../contexts/AlertContext.jsx'
import { useUser } from '../contexts/UserContext.jsx'

const PAGE_SIZE = 10

export default function SavedMessages() {
  const { user, loading: userLoading } = useUser()
  const [messages, setMessages] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const alert = useAlert()

  const loadFavorites = async (nextPage = 1, append = false) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    try {
      const response = await api.userFavorites({ page: nextPage, page_size: PAGE_SIZE })
      const incoming = response.data?.messages || []
      setMessages((current) => append ? [...current, ...incoming] : incoming)
      setPage(response.data?.page || nextPage)
      setTotal(response.data?.total || 0)
      setTotalPages(response.data?.total_pages || 0)
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '收藏加载失败')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    if (user) loadFavorites(1, false)
  }, [user?.id])

  if (userLoading) {
    return (
      <div className="page-center">
        <div className="spinner" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  const handleFavoriteChange = (favorited, messageId) => {
    if (favorited) return
    setMessages((items) => items.filter((item) => Number(item.id) !== Number(messageId)))
    setTotal((value) => Math.max(value - 1, 0))
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="wall-overview p-6 md:p-8">
        <div className="wall-overview-copy space-y-2">
          <span className="page-kicker">
            <i className="bi bi-heart-fill text-rose-500" />
            <span>Saved</span>
          </span>
          <h1 className="text-3xl font-black text-[var(--text-primary)]">我的收藏</h1>
          <p className="max-w-xl text-sm leading-relaxed text-[var(--text-secondary)]">
            收藏会跟随你的学生账号保存，换设备登录后也能继续查看。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="wall-stat-card min-w-28">
            <b>{total}</b>
            <span>已收藏留言</span>
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

      {!loading && messages.length === 0 ? (
        <section className="empty-state-card">
          <i className="bi bi-heart" />
          <h2 className="mt-4 text-lg font-bold text-[var(--text-primary)]">还没有收藏留言</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">在校园墙点击心形按钮，就能把感兴趣的内容留在这里。</p>
          <Link className="btn btn-primary mt-5" to="/wall">
            <i className="bi bi-chat-square-text" />
            <span>去逛校园墙</span>
          </Link>
        </section>
      ) : null}

      <div className="space-y-5">
        {messages.map((message) => (
          <MessageCard
            key={message.id}
            message={message}
            onFavoriteChange={handleFavoriteChange}
          />
        ))}
      </div>

      {page < totalPages ? (
        <div className="text-center">
          <button
            className="btn btn-outline min-w-44"
            type="button"
            disabled={loadingMore}
            onClick={() => loadFavorites(page + 1, true)}
          >
            <i className="bi bi-plus-circle" />
            <span>{loadingMore ? '加载中...' : '加载更多收藏'}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
