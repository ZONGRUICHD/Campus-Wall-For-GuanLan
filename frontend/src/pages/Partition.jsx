import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../services/api'
import MessageCard from '../components/MessageCard.jsx'

export default function Partition() {
  const { tag = '' } = useParams()
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    async function load() {
      try {
        if (!tag) {
          const response = await api.getMessages({ start: 0, end: 20 })
          setMessages(response.data?.data || [])
          return
        }
        const ids = await api.getPartitionMessages(tag)
        const all = await api.getMessages({ start: 0, end: 9999 })
        const idSet = new Set(ids.data?.data || [])
        setMessages((all.data?.data || []).filter((message) => idSet.has(message.id)))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [tag])

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <Link to="/wall" className="btn btn-sm btn-outline">
          <i className="bi bi-arrow-left" />
          <span>返回全部动态</span>
        </Link>
      </div>

      <div className="hero-section hero-section-compact">
        <div className="hero-content space-y-1">
          <span className="page-kicker hero-kicker">
            <i className="bi bi-tag-fill text-amber-300" />
            <span>Tag Topic</span>
          </span>
          <h1>
            {tag ? `#${tag}` : '全部话题'}
          </h1>
          <p className="hero-subtitle">
            共找到 {messages.length} 条归属此话题标签的留言分享
          </p>
        </div>
      </div>

      {loading ? (
        <div className="page-center py-12">
          <div className="spinner" />
          <p className="text-sm text-[var(--text-secondary)] mt-3">正在加载该标签动态...</p>
        </div>
      ) : null}

      {!loading && messages.length === 0 ? (
        <div className="empty-state-card">
          <i className="bi bi-tags" />
          <p className="mt-4 text-base font-bold text-[var(--text-primary)]">该标签下暂无内容</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">发帖时带上 #{tag} 即可出现在这里！</p>
          <Link to="/wall" className="btn btn-primary mt-4">
            <i className="bi bi-pencil-square" />
            <span>去发第一条</span>
          </Link>
        </div>
      ) : null}

      <div className="space-y-5">
        {messages.map((message) => <MessageCard key={message.id} message={message} />)}
      </div>
    </div>
  )
}
