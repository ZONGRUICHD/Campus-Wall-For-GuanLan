import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../services/api'
import MessageCard from '../components/MessageCard.jsx'

const topicPageSize = 24
const messagePageSize = 15

const topicDateTime = (value) => value ? String(value).replace(' ', 'T') : undefined

function Pagination({ label, loading, page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null

  return (
    <nav className="mt-6 flex flex-wrap items-center justify-center gap-3" aria-label={label}>
      <button
        className="btn btn-sm btn-outline"
        type="button"
        disabled={loading || page <= 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        <i className="bi bi-chevron-left" aria-hidden="true" />
        上一页
      </button>
      <span className="text-sm text-muted" aria-live="polite">第 {page} / {totalPages} 页</span>
      <button
        className="btn btn-sm btn-outline"
        type="button"
        disabled={loading || page >= totalPages}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
      >
        下一页
        <i className="bi bi-chevron-right" aria-hidden="true" />
      </button>
    </nav>
  )
}

export default function Partition() {
  const { tag = '' } = useParams()
  const selectedTag = String(tag || '').trim()
  const directoryMode = !selectedTag
  const loadSequence = useRef(0)
  const [topics, setTopics] = useState([])
  const [messages, setMessages] = useState([])
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [sort, setSort] = useState('popular')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const pageSize = directoryMode ? topicPageSize : messagePageSize
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    setPage(1)
    setTotal(0)
    setError('')
    setTopics([])
    setMessages([])
  }, [selectedTag])

  useEffect(() => {
    const sequence = ++loadSequence.current
    let cancelled = false
    const start = (page - 1) * pageSize
    const end = start + pageSize

    setLoading(true)
    setError('')
    if (directoryMode) setTopics([])
    else setMessages([])

    const load = async () => {
      try {
        const response = directoryMode
          ? await api.getTopics({ q: appliedQuery, s: sort, start, end })
          : await api.getTopicMessages(selectedTag, { s: 'newest', start, end })
        if (cancelled || sequence !== loadSequence.current) return

        const nextTotal = Math.max(0, Number(response.data?.total) || 0)
        const nextTotalPages = Math.max(1, Math.ceil(nextTotal / pageSize))
        setTotal(nextTotal)
        if (page > nextTotalPages) {
          setPage(nextTotalPages)
          return
        }

        if (directoryMode) setTopics(Array.isArray(response.data?.data) ? response.data.data : [])
        else setMessages(Array.isArray(response.data?.data) ? response.data.data : [])
      } catch (loadError) {
        if (!cancelled && sequence === loadSequence.current) {
          setError(loadError.message || '话题加载失败，请稍后重试')
          setTotal(0)
        }
      } finally {
        if (!cancelled && sequence === loadSequence.current) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [appliedQuery, directoryMode, page, pageSize, reloadKey, selectedTag, sort])

  const submitSearch = (event) => {
    event.preventDefault()
    setAppliedQuery(query.trim())
    setPage(1)
  }

  const clearSearch = () => {
    setQuery('')
    setAppliedQuery('')
    setPage(1)
  }

  const changeSort = (event) => {
    setSort(event.target.value)
    setPage(1)
  }

  const retry = () => setReloadKey((value) => value + 1)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link to={directoryMode ? '/wall' : '/p'} className="btn btn-sm btn-outline">
          <i className="bi bi-arrow-left" aria-hidden="true" />
          <span>{directoryMode ? '返回校园动态' : '返回全部话题'}</span>
        </Link>
      </div>

      <header className="card-flat p-5 md:p-6">
        <span className="page-kicker">
          <i className={`bi ${directoryMode ? 'bi-tags' : 'bi-hash'}`} aria-hidden="true" />
          <span>{directoryMode ? '话题目录' : '话题动态'}</span>
        </span>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-[var(--text-primary)] md:text-4xl">
          {directoryMode ? '按标签浏览话题' : `#${selectedTag}`}
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]" role="status" aria-live="polite">
          {loading
            ? (directoryMode ? '正在整理公开话题…' : '正在加载该话题的公开动态…')
            : (directoryMode ? `共找到 ${total} 个公开话题` : `共找到 ${total} 条公开动态`)}
        </p>
      </header>

      {directoryMode ? (
        <div className="search-panel">
          <form className="flex min-w-64 flex-1 gap-2" role="search" onSubmit={submitSearch}>
            <label className="sr-only" htmlFor="topic-search">搜索话题名称</label>
            <div className="relative min-w-0 flex-1">
              <i className="bi bi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input
                id="topic-search"
                className="field w-full pl-10 pr-10"
                value={query}
                maxLength={50}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索话题名称"
              />
              {query ? (
                <button
                  className="absolute right-0 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  type="button"
                  aria-label="清空话题搜索"
                  onClick={clearSearch}
                >
                  <i className="bi bi-x-circle-fill" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading}>搜索</button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="topic-sort">话题排序方式</label>
            <select id="topic-sort" className="field w-auto" value={sort} onChange={changeSort}>
              <option value="popular">动态最多</option>
              <option value="newest">最近更新</option>
              <option value="name">名称排序</option>
            </select>
            <button className="btn btn-outline" type="button" disabled={loading} onClick={retry}>
              <i className="bi bi-arrow-clockwise" aria-hidden="true" />
              <span className="hidden sm:inline">刷新</span>
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="page-center py-12" role="status" aria-live="polite">
          <div className="spinner" aria-hidden="true" />
          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            {directoryMode ? '正在加载话题目录…' : '正在加载该话题动态…'}
          </p>
        </div>
      ) : null}

      {!loading && error ? (
        <div className="empty-state-card" role="alert">
          <i className="bi bi-exclamation-octagon-fill" aria-hidden="true" />
          <p className="mt-4 text-base font-bold text-[var(--text-primary)]">暂时无法加载话题</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{error}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {/登录/.test(error) ? <Link to="/login" className="btn btn-primary">去登录</Link> : null}
            <button className="btn btn-outline" type="button" onClick={retry}>
              <i className="bi bi-arrow-clockwise" aria-hidden="true" />重试
            </button>
          </div>
        </div>
      ) : null}

      {!loading && !error && directoryMode && topics.length === 0 ? (
        <div className="empty-state-card">
          <i className="bi bi-tags" aria-hidden="true" />
          <p className="mt-4 text-base font-bold text-[var(--text-primary)]">
            {appliedQuery ? '没有匹配的话题' : '暂时还没有公开话题'}
          </p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {appliedQuery ? `没有找到包含“${appliedQuery}”的话题，请换个关键词试试。` : '公开动态添加标签后，会自动出现在这里。'}
          </p>
          {appliedQuery ? <button className="btn btn-primary mt-4" type="button" onClick={clearSearch}>查看全部话题</button> : null}
        </div>
      ) : null}

      {!loading && !error && directoryMode && topics.length > 0 ? (
        <section aria-label="话题列表">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {topics.map((topic) => (
              <li key={topic.tag}>
                <Link
                  className="card-flat flex min-h-32 h-full flex-col justify-between gap-4 p-5 transition-transform active:scale-[0.98]"
                  to={`/p/${encodeURIComponent(topic.tag)}`}
                  aria-label={`话题 ${topic.tag}，${topic.count} 条公开动态`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <strong className="min-w-0 break-words text-lg font-black text-[var(--text-primary)]">#{topic.tag}</strong>
                    <span className="badge shrink-0">{topic.count} 条</span>
                  </span>
                  <span className="flex items-center justify-between gap-3 text-xs text-[var(--text-secondary)]">
                    <span><i className="bi bi-clock mr-1" aria-hidden="true" />最近更新</span>
                    {topic.latest_at ? <time dateTime={topicDateTime(topic.latest_at)}>{topic.latest_at}</time> : <span>暂无</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination label="话题目录分页" loading={loading} page={page} totalPages={totalPages} onPageChange={setPage} />
        </section>
      ) : null}

      {!loading && !error && !directoryMode && messages.length === 0 ? (
        <div className="empty-state-card">
          <i className="bi bi-tags" aria-hidden="true" />
          <p className="mt-4 text-base font-bold text-[var(--text-primary)]">该话题下暂无公开内容</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">发布动态时带上 #{selectedTag}，审核通过后即可出现在这里。</p>
          <Link to="/wall" className="btn btn-primary mt-4">
            <i className="bi bi-pencil-square" aria-hidden="true" />
            <span>发布动态</span>
          </Link>
        </div>
      ) : null}

      {!directoryMode && !error && messages.length > 0 ? (
        <section aria-label={`话题 ${selectedTag} 的动态`}>
          <div className="space-y-5">
            {messages.map((message) => <MessageCard key={message.id} message={message} />)}
          </div>
          <Pagination label={`话题 ${selectedTag} 分页`} loading={loading} page={page} totalPages={totalPages} onPageChange={setPage} />
        </section>
      ) : null}
    </div>
  )
}
