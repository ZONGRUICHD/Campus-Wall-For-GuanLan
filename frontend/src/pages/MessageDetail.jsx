import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../services/api'
import MessageCard from '../components/MessageCard.jsx'

export default function MessageDetail() {
  const { id } = useParams()
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.getMessageDetail(id)
      .then((response) => {
        if (response.data?.success) setMessage(response.data.message)
        else setError(response.data?.error || '消息不存在或已被删除')
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="page-center py-16">
        <div className="spinner" />
        <p className="text-sm text-[var(--text-secondary)] mt-3">正在加载留言详情...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-center py-16 text-center space-y-4">
        <div className="empty-state-card max-w-md mx-auto">
          <i className="bi bi-exclamation-circle text-rose-500" />
          <p className="mt-3 text-base font-bold text-[var(--text-primary)]">{error}</p>
          <Link className="btn btn-primary mt-4" to="/wall">
            <i className="bi bi-arrow-left" />
            <span>返回校园墙</span>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Top Breadcrumb & Actions */}
      <div className="flex items-center justify-between">
        <Link to="/wall" className="btn btn-sm btn-outline">
          <i className="bi bi-arrow-left" />
          <span>返回全部动态</span>
        </Link>
        <span className="text-xs text-[var(--text-muted)] font-mono">
          Message #{id}
        </span>
      </div>

      <div className="hero-section hero-section-compact">
        <div className="hero-content space-y-1">
          <span className="page-kicker hero-kicker">
            <i className="bi bi-chat-square-quote-fill text-indigo-300" />
            <span>Detail View</span>
          </span>
          <h1>留言详情</h1>
        </div>
      </div>

      {message ? <MessageCard message={message} /> : null}
    </div>
  )
}
