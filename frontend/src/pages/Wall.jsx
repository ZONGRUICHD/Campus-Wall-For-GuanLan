import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import api from '../services/api'
import MessageCard from '../components/MessageCard.jsx'
import Modal from '../components/Modal.jsx'
import { useAlert } from '../contexts/AlertContext.jsx'
import { useUser } from '../contexts/UserContext.jsx'
import { usePlatform } from '../contexts/PlatformContext.jsx'

const CHUNK_SIZE = 5 * 1024 * 1024
const presetTags = ['公告', '日常', '寻物', '表白', '树洞', '提问', '吐槽', '学习', '互助']
const DRAFT_STORAGE_PREFIX = 'campus-wall-publish-draft-v1'
const EMPTY_POLL_OPTIONS = ['', '']
const wallBoards = [
  { id: 'news', name: '校园资讯', eyebrow: 'CAMPUS NEWS', tag: '公告', icon: 'bi-megaphone' },
  { id: 'daily', name: '校园日常', eyebrow: 'DAILY LIFE', tag: '日常', icon: 'bi-chat-heart' },
  { id: 'lost-found', name: '失物招领', eyebrow: 'LOST & FOUND', tag: '寻物', icon: 'bi-archive' },
  { id: 'confession', name: '表白墙', eyebrow: 'CONFESSION', tag: '表白', icon: 'bi-heart' },
  { id: 'tree-hole', name: '树洞', eyebrow: 'TREE HOLE', tag: '树洞', icon: 'bi-chat-quote' }
]

export default function Wall() {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const { user } = useUser()
  const { community } = usePlatform()
  const alert = useAlert()
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [searchWord, setSearchWord] = useState(params.get('w') || '')
  const [filter, setFilter] = useState(params.get('f') || 'all')
  const [sortBy, setSortBy] = useState(params.get('s') || 'newest')
  const [pageStart, setPageStart] = useState(0)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishText, setPublishText] = useState('')
  const [publishTags, setPublishTags] = useState([])
  const [publishAnonymous, setPublishAnonymous] = useState(true)
  const [publishMode, setPublishMode] = useState('post')
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState(EMPTY_POLL_OPTIONS)
  const [pollDuration, setPollDuration] = useState('3')
  const [tagInput, setTagInput] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [files, setFiles] = useState([])
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [draftSavedAt, setDraftSavedAt] = useState('')
  const pageSize = 15
  const draftKey = `${DRAFT_STORAGE_PREFIX}:${user?.id || 'guest'}`
  const canPublish = !user?.is_muted
    && community.posting_enabled
    && (Boolean(user) || community.guest_posting_enabled)
  const publishDisabledReason = user?.is_muted
    ? (user.mute_reason ? `账号已被禁言：${user.mute_reason}` : '账号已被禁言，暂时不能发帖')
    : (!community.posting_enabled
        ? (community.pause_reason || '管理员暂时关闭了发帖功能')
        : '当前仅登录学生可以发帖')

  const openPublish = useCallback(() => {
    if (!canPublish) {
      alert.showTopRightAlert(publishDisabledReason, 'warning', '暂时无法发布')
      return
    }
    const hasCurrentContent = publishText.trim() || publishTags.length || files.length || pollQuestion.trim() || pollOptions.some((option) => option.trim())
    if (!hasCurrentContent) {
      try {
        const saved = JSON.parse(window.localStorage.getItem(draftKey) || 'null')
        if (saved && typeof saved === 'object') {
          setPublishText(String(saved.text || '').slice(0, 2000))
          setPublishTags(Array.isArray(saved.tags) ? saved.tags.slice(0, 8) : [])
          setPublishAnonymous(saved.anonymous !== false)
          setPublishMode(saved.mode === 'poll' ? 'poll' : 'post')
          setPollQuestion(String(saved.pollQuestion || '').slice(0, 200))
          setPollOptions(Array.isArray(saved.pollOptions) && saved.pollOptions.length >= 2
            ? saved.pollOptions.slice(0, 6).map((option) => String(option || '').slice(0, 80))
            : EMPTY_POLL_OPTIONS)
          setPollDuration(['1', '3', '7', 'none'].includes(saved.pollDuration) ? saved.pollDuration : '3')
          setDraftSavedAt(saved.savedAt || '')
        } else {
          setPublishAnonymous(true)
        }
      } catch {
        setPublishAnonymous(true)
      }
    }
    setPublishOpen(true)
  }, [alert, canPublish, draftKey, files.length, pollOptions, pollQuestion, publishDisabledReason, publishTags.length, publishText])

  const loadMessages = async ({ reset = false, sortValue = sortBy, wordValue = searchWord, filterValue = filter } = {}) => {
    const start = reset ? 0 : pageStart
    if (reset) setLoading(true)
    try {
      const response = await api.getMessages({
        s: sortValue,
        w: wordValue,
        f: filterValue,
        start,
        end: start + pageSize
      })
      const incoming = response.data?.data || []
      setMessages((prev) => reset ? incoming : [...prev, ...incoming])
      setHasMore(incoming.length === pageSize)
      if (reset) setPageStart(0)
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '加载留言失败')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    loadMessages({ reset: true })
  }, [])

  useEffect(() => {
    const handler = () => openPublish()
    window.addEventListener('open-publish-modal', handler)
    return () => window.removeEventListener('open-publish-modal', handler)
  }, [openPublish])

  useEffect(() => {
    if (!publishOpen) return undefined
    const timer = window.setTimeout(() => {
      const hasDraft = publishText.trim() || publishTags.length || pollQuestion.trim() || pollOptions.some((option) => option.trim())
      try {
        if (!hasDraft) {
          window.localStorage.removeItem(draftKey)
          setDraftSavedAt('')
          return
        }
        const savedAt = new Date().toISOString()
        window.localStorage.setItem(draftKey, JSON.stringify({
          text: publishText,
          tags: publishTags,
          anonymous: publishAnonymous,
          mode: publishMode,
          pollQuestion,
          pollOptions,
          pollDuration,
          savedAt
        }))
        setDraftSavedAt(savedAt)
      } catch {}
    }, 500)
    return () => window.clearTimeout(timer)
  }, [draftKey, pollDuration, pollOptions, pollQuestion, publishAnonymous, publishMode, publishOpen, publishTags, publishText])

  const refresh = () => loadMessages({ reset: true })

  const handleFilterChange = (newFilter) => {
    setFilter(newFilter)
    loadMessages({ reset: true, filterValue: newFilter })
  }

  const handleSortChange = (newSort) => {
    setSortBy(newSort)
    loadMessages({ reset: true, sortValue: newSort })
  }

  const clearPublishDraft = () => {
    try {
      window.localStorage.removeItem(draftKey)
    } catch {}
    setPublishText('')
    setPublishTags([])
    setTagInput('')
    setFiles([])
    setPublishAnonymous(true)
    setPublishMode('post')
    setPollQuestion('')
    setPollOptions(EMPTY_POLL_OPTIONS)
    setPollDuration('3')
    setDraftSavedAt('')
  }

  const loadMore = async () => {
    if (loadingMore || !hasMore) return
    const next = pageStart + pageSize
    setPageStart(next)
    setLoadingMore(true)
    try {
      const response = await api.getMessages({
        s: sortBy,
        w: searchWord,
        f: filter,
        start: next,
        end: next + pageSize
      })
      const incoming = response.data?.data || []
      setMessages((prev) => [...prev, ...incoming])
      setHasMore(incoming.length === pageSize)
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '加载失败')
    } finally {
      setLoadingMore(false)
    }
  }

  const refreshSpecificMessage = async (id) => {
    try {
      const response = await api.getMessageDetail(id)
      if (response.data?.success) {
        setMessages((items) => items.map((item) => item.id === id ? response.data.message : item))
      }
    } catch {}
  }

  const addTag = (tag) => {
    const next = tag.trim().replace(',', '')
    if (!next || publishTags.includes(next) || publishTags.length >= 8) return
    setPublishTags((items) => [...items, next])
    setTagInput('')
    setSuggestions([])
  }

  const handleTagKey = async (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addTag(tagInput)
      return
    }
    const value = event.currentTarget.value
    if (!value) {
      setSuggestions([])
      return
    }
    try {
      const response = await api.getTags()
      setSuggestions((response.data || []).filter((tag) => tag.includes(value) && !publishTags.includes(tag)).slice(0, 5))
    } catch {}
  }

  const uploadDirect = async (file) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('originalName', file.name)
    const response = await api.directUpload(formData)
    if (!response.data?.success) throw new Error(response.data?.error || '文件上传失败')
    return response.data.filenames || []
  }

  const uploadChunked = async (file) => {
    const fileKey = `${Date.now()}_${file.name}_${file.size}`
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
    for (let i = 0; i < totalChunks; i += 1) {
      const formData = new FormData()
      formData.append('chunk', file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size)))
      formData.append('chunkIndex', i)
      formData.append('totalChunks', totalChunks)
      formData.append('fileKey', fileKey)
      formData.append('originalName', file.name)
      const response = await api.chunkedUpload(formData)
      if (!response.data?.success) throw new Error(response.data?.error || '分片上传失败')
      setProgress(Math.round(((i + 1) / totalChunks) * 100))
    }
    const merged = await api.mergeChunks({ fileKey })
    if (!merged.data?.success) throw new Error(merged.data?.error || '合并文件失败')
    return merged.data.filenames || []
  }

  const submitPublish = async () => {
    if (!canPublish) {
      alert.showTopRightAlert(publishDisabledReason, 'warning', '暂时无法发布')
      return
    }
    if (user?.is_muted) {
      alert.showTopRightAlert('账号已被禁言，暂时不能发帖', 'warning', '发布失败')
      return
    }
    const cleanPollOptions = pollOptions.map((option) => option.trim()).filter(Boolean)
    if (publishMode === 'poll' && (!pollQuestion.trim() || cleanPollOptions.length < 2)) {
      alert.showTopRightAlert('请填写投票问题和至少两个选项', 'warning', '投票未完成')
      return
    }
    if (!publishText.trim() && files.length === 0 && publishMode !== 'poll') {
      alert.showTopRightAlert('请输入留言内容或上传附件', 'warning', '提示')
      return
    }
    setPublishing(true)
    setProgress(0)
    try {
      const filenames = []
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]
        setStatusText(`正在上传 (${i + 1}/${files.length}): ${file.name}`)
        const uploaded = file.size > CHUNK_SIZE ? await uploadChunked(file) : await uploadDirect(file)
        filenames.push(...uploaded)
      }
      const response = await api.submitMessage({
        text: publishText.trim(),
        tags: publishTags.join(','),
        filenames,
        anonymous: user ? publishAnonymous : true,
        pollQuestion: publishMode === 'poll' ? pollQuestion.trim() : '',
        pollOptions: publishMode === 'poll' ? cleanPollOptions : [],
        pollClosesAt: publishMode === 'poll' && pollDuration !== 'none'
          ? new Date(Date.now() + Number(pollDuration) * 86400000).toISOString()
          : ''
      })
      clearPublishDraft()
      setPublishOpen(false)
      const pendingReview = response.data?.moderation_status === 'pending'
      alert.showTopRightAlert(
        pendingReview ? '留言已提交审核，可在“我的发布”查看进度' : '留言已成功发布！',
        'success',
        pendingReview ? '等待审核' : '发布成功'
      )
      refresh()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '发布失败')
    } finally {
      setPublishing(false)
      setStatusText('')
      setProgress(0)
    }
  }

  const today = useMemo(() => {
    const date = new Date()
    return {
      day: String(date.getDate()).padStart(2, '0'),
      short: new Intl.DateTimeFormat('zh-CN', { month: 'short', weekday: 'short' }).format(date),
      full: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(date)
    }
  }, [])

  const hotTags = useMemo(() => {
    const counts = new Map()
    messages.forEach((message) => {
      const tags = message.tags || []
      tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1))
    })
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'))
      .slice(0, 5)
  }, [messages])

  const searchTag = (tag) => {
    setSearchWord(tag)
    loadMessages({ reset: true, wordValue: tag })
    document.getElementById('wall-feed')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="wall-page">
      <div className="wall-workspace">
        <aside className="wall-board-sidebar" aria-label="校园墙板块">
          <div className="wall-sidebar-sticky">
            <section className="wall-board-panel">
              <div className="wall-panel-heading">
                <span className="wall-eyebrow">THE BULLETIN</span>
                <h2>校园布告栏</h2>
              </div>
              <nav className="wall-board-nav" aria-label="按话题浏览五个板块">
                {wallBoards.map((board) => (
                  <Link
                    className="wall-board-item"
                    data-board={board.id}
                    key={board.id}
                    to={`/p/${encodeURIComponent(board.tag)}`}
                    title={`浏览 #${board.tag} 话题`}
                  >
                    <span className="wall-board-icon" aria-hidden="true">
                      <i className={`bi ${board.icon}`} />
                    </span>
                    <span className="wall-board-copy">
                      <strong>{board.name}</strong>
                      <small>{board.eyebrow}</small>
                    </span>
                    <i className="bi bi-chevron-right wall-board-arrow" aria-hidden="true" />
                  </Link>
                ))}
              </nav>
            </section>
            <section className="wall-sidebar-note" aria-label="墙边小语">
              <span className="paper-tape" aria-hidden="true" />
              <p>“愿每一句真诚的话，都能在校园里找到回声。”</p>
              <small>— 今日墙边小语</small>
            </section>
          </div>
        </aside>

        <section className="wall-feed-column" id="wall-feed" aria-label="校园墙留言列表">
          <section className="wall-feed-hero">
            <div className="wall-feed-hero-icon" aria-hidden="true">
              <i className="bi bi-chat-square-text" />
            </div>
            <div>
              <span className="wall-eyebrow">GUANLAN CAMPUS FEED</span>
              <h1>观澜校园墙</h1>
              <p>探索校园动态、分享有趣日常；支持匿名倾诉与多媒体互动。</p>
            </div>
            <span className="wall-feed-count">{messages.length} 张便笺</span>
          </section>

          {!canPublish ? (
            <div className="info-callout status-warning mt-3" role="status">
              <i className="bi bi-info-circle-fill" aria-hidden="true" />
              <span>{publishDisabledReason}</span>
              {!user && community.posting_enabled ? <Link className="ml-auto font-bold" to="/login">前往登录</Link> : null}
            </div>
          ) : null}

          {/* Filter & Search Bar */}
          <div className="search-panel wall-feed-toolbar">
            <form className="wall-search-field" role="search" onSubmit={(event) => { event.preventDefault(); refresh() }}>
              <i className="bi bi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <label className="sr-only" htmlFor="wall-search-input">搜索留言关键词或标签</label>
              <input
                id="wall-search-input"
                className="field pl-10 pr-12 w-full"
                value={searchWord}
                onChange={(event) => setSearchWord(event.target.value)}
                placeholder="搜索留言关键词或标签…"
                type="search"
              />
              {searchWord ? (
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--primary-color)] text-xs font-bold"
                  aria-label="清空搜索"
                  onClick={() => { setSearchWord(''); loadMessages({ reset: true, wordValue: '' }) }}
                >
                  清空
                </button>
              ) : null}
            </form>

            <div className="wall-filter-controls">
              <label>
                <span className="sr-only">内容筛选</span>
                <select className="field w-auto" value={filter} onChange={(event) => handleFilterChange(event.target.value)}>
                  <option value="all">全部内容</option>
                  <option value="files">有图/视频/音频</option>
                  <option value="polls">投票帖</option>
                </select>
              </label>

              <label>
                <span className="sr-only">排序方式</span>
                <select className="field w-auto" value={sortBy} onChange={(event) => handleSortChange(event.target.value)}>
                  <option value="newest">最新发布</option>
                  <option value="likes">点赞最多</option>
                  <option value="dislikes">点踩最多</option>
                </select>
              </label>

              <button className="btn btn-outline" type="button" onClick={refresh} title="刷新列表" aria-label="刷新留言列表">
                <i className="bi bi-arrow-clockwise" aria-hidden="true" />
                <span className="hidden sm:inline">刷新</span>
              </button>

              <button
                className="btn btn-primary"
                type="button"
                onClick={openPublish}
                title={canPublish ? '发布新留言' : publishDisabledReason}
                aria-disabled={!canPublish}
              >
                <i className="bi bi-pencil-square" aria-hidden="true" />
                <span>我要发帖</span>
              </button>
            </div>
          </div>

          <div className="wall-feed-result" role="status" aria-live="polite">
            <span>
              {loading
                ? '正在整理墙上的便笺…'
                : searchWord
                  ? <>关键词 <b>“{searchWord}”</b> 找到 <b>{messages.length}</b> 条留言</>
                  : `当前展示 ${messages.length} 条留言`}
            </span>
            {searchWord ? (
              <button type="button" onClick={() => { setSearchWord(''); loadMessages({ reset: true, wordValue: '' }) }}>
                清空筛选
              </button>
            ) : null}
          </div>

          {/* Loading Skeleton */}
          {loading && messages.length === 0 ? (
            <div className="wall-feed-list" role="status" aria-label="正在加载校园墙">
              {[1, 2, 3].map((item) => (
                <div key={item} className="card p-6 space-y-4" aria-hidden="true">
                  <div className="flex items-center gap-3">
                    <div className="skeleton h-11 w-11 rounded-xl shrink-0" />
                    <div className="space-y-2 flex-1">
                      <div className="skeleton h-4 w-32" />
                      <div className="skeleton h-3 w-20" />
                    </div>
                  </div>
                  <div className="skeleton h-16 w-full" />
                  <div className="skeleton h-8 w-48" />
                </div>
              ))}
            </div>
          ) : null}

          {/* Empty State */}
          {!loading && messages.length === 0 ? (
            <div className="empty-state-card" role="status">
              <i className="bi bi-chat-square-dots" aria-hidden="true" />
              <p className="mt-4 text-base font-bold text-[var(--text-primary)]">暂无相关留言</p>
              <p className="text-xs text-[var(--text-secondary)] mt-1">换个关键词或筛选条件，也可以贴上第一张便笺。</p>
              <button className="btn btn-primary mt-5" type="button" disabled={!canPublish} onClick={openPublish}>
                <i className="bi bi-pencil-square" aria-hidden="true" />
                <span>立即发帖</span>
              </button>
            </div>
          ) : null}

          {/* Messages Stream */}
          <div className="wall-feed-list" aria-busy={loading}>
            {messages.map((message) => (
              <MessageCard key={message.id} message={message} onRefresh={refreshSpecificMessage} />
            ))}
          </div>

          {/* Load More */}
          {hasMore && messages.length ? (
            <div className="text-center pt-5">
              <button
                className="btn btn-lg btn-outline min-w-48"
                type="button"
                disabled={loadingMore}
                onClick={loadMore}
                aria-busy={loadingMore}
              >
                {loadingMore ? (
                  <>
                    <div className="spinner h-4 w-4 border-2" aria-hidden="true" />
                    <span>加载中…</span>
                  </>
                ) : (
                  <>
                    <i className="bi bi-chevron-down" aria-hidden="true" />
                    <span>加载更多留言</span>
                  </>
                )}
              </button>
            </div>
          ) : null}
        </section>

        <aside className="wall-right-rail" aria-label="校园墙信息">
          <section className="wall-rail-card">
            <div className="wall-date-top">
              <div className="wall-date-block" aria-hidden="true">
                <strong>{today.day}</strong>
                <span>{today.short}</span>
              </div>
              <div className="wall-date-copy">
                <span className="wall-eyebrow">CAMPUS TODAY</span>
                <h2>今日校园</h2>
                <p>{today.full}</p>
              </div>
            </div>
            <ul className="wall-status-list">
              <li><span>当前展示</span><strong>{messages.length} 条</strong></li>
              <li><span>内容筛选</span><strong>{filter === 'files' ? '多媒体' : filter === 'polls' ? '投票帖' : '全部内容'}</strong></li>
              <li><span>排序方式</span><strong>{sortBy === 'likes' ? '点赞最多' : sortBy === 'dislikes' ? '点踩最多' : '最新发布'}</strong></li>
              <li>
                <span><i className={`wall-status-dot ${community.posting_enabled ? '' : 'is-paused'}`} aria-hidden="true" />发帖服务</span>
                <strong>{community.posting_enabled ? '开放' : '暂停'}</strong>
              </li>
            </ul>
          </section>

          <section className="wall-rail-card">
            <div className="wall-rail-heading">
              <div>
                <span className="wall-eyebrow">TRENDING NOW</span>
                <h2>大家在聊</h2>
              </div>
              <span className="wall-hot-mark" aria-hidden="true">hot!</span>
            </div>
            <div className="wall-hot-tags">
              {hotTags.length ? hotTags.map(([tag, count], index) => (
                <button key={tag} type="button" onClick={() => searchTag(tag)} title={`搜索 #${tag}`}>
                  <span className="wall-hot-index">{String(index + 1).padStart(2, '0')}</span>
                  <strong>#{tag}</strong>
                  <small>本页 {count} 条</small>
                </button>
              )) : (
                <p className="py-4 text-xs text-[var(--text-muted)]">当前便笺还没有话题标签。</p>
              )}
            </div>
          </section>

          <section className="wall-guide-card" id="wall-guide">
            <span className="paper-tape" aria-hidden="true" />
            <span className="wall-eyebrow">A KIND WALL</span>
            <h2>让这里一直友善</h2>
            <p>说具体的话，给真诚的回应；发布前请确认内容与附件符合社区公约。</p>
            <div className="wall-guide-actions">
              <button type="button" onClick={openPublish} title={canPublish ? '写一张便笺' : publishDisabledReason}>
                <i className="bi bi-plus-circle" aria-hidden="true" />
                写一张便笺
              </button>
              <Link to="/rules">
                <i className="bi bi-shield-check" aria-hidden="true" />
                查看公约
              </Link>
            </div>
          </section>
        </aside>
      </div>

      {/* Floating Action Buttons */}
      <div className="wall-floating-actions">
        <button
          className="wall-floating-button wall-floating-publish"
          type="button"
          aria-label="发布留言"
          title={canPublish ? '发帖' : publishDisabledReason}
          onClick={openPublish}
          disabled={!canPublish}
        >
          <i className="bi bi-pencil-fill text-xl" aria-hidden="true" />
        </button>
        <button
          className="wall-floating-button wall-floating-top"
          type="button"
          aria-label="返回顶部"
          title="回到顶部"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <i className="bi bi-arrow-up text-lg" aria-hidden="true" />
        </button>
      </div>

      {/* Publish Modal */}
      <Modal
        visible={publishOpen}
        title="发布新便笺"
        onClose={() => setPublishOpen(false)}
        footer={(
          <>
            <button className="btn btn-outline" type="button" onClick={() => setPublishOpen(false)}>
              取消
            </button>
            <button
              className="btn btn-primary px-6"
              type="button"
              disabled={!canPublish || publishing || user?.is_muted}
              onClick={submitPublish}
              aria-busy={publishing}
            >
              {publishing ? '正在发布...' : '确认发布'}
            </button>
          </>
        )}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--card-secondary-bg)] p-1">
            <button
              className={`btn btn-sm justify-center border-0 ${publishMode === 'post' ? 'btn-primary' : 'btn-ghost'}`}
              type="button"
              onClick={() => setPublishMode('post')}
              aria-pressed={publishMode === 'post'}
            >
              <i className="bi bi-chat-square-text" />
              普通留言
            </button>
            <button
              className={`btn btn-sm justify-center border-0 ${publishMode === 'poll' ? 'btn-primary' : 'btn-ghost'}`}
              type="button"
              onClick={() => setPublishMode('poll')}
              aria-pressed={publishMode === 'poll'}
            >
              <i className="bi bi-ui-radios-grid" />
              发起投票
            </button>
          </div>

          {/* Identity Switcher */}
          {user ? (
            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-secondary-bg)] p-4">
              <label className="flex items-center justify-between cursor-pointer gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary-light)] text-[var(--primary-color)] text-xl">
                    <i className={`bi ${publishAnonymous ? 'bi-incognito' : 'bi-person-check-fill'}`} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-[var(--text-primary)]">
                      {publishAnonymous ? '匿名发布 (保护隐私)' : `实名发布 (${user.nickname || '未设置昵称'})`}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">
                      {publishAnonymous ? '公开页面将显示为“匿名同学”' : '公开页面将展示你的昵称与头像'}
                    </div>
                  </div>
                </div>
                <input
                  className="h-5 w-5 accent-[var(--primary-color)] cursor-pointer"
                  type="checkbox"
                  checked={publishAnonymous}
                  onChange={(event) => setPublishAnonymous(event.target.checked)}
                  aria-label="匿名发布"
                />
              </label>
              {user.is_muted ? (
                <div className="status-warning mt-3 rounded-lg px-3 py-2 text-xs font-semibold">
                  <i className="bi bi-exclamation-triangle mr-1" />你的账号目前处于禁言状态，暂时无法发表内容。
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Text Area */}
          <div>
            <label className="sr-only" htmlFor="publish-message-text">
              {publishMode === 'poll' ? '投票背景或说明' : '留言内容'}
            </label>
            <textarea
              id="publish-message-text"
              className="field min-h-32 w-full text-base"
              value={publishText}
              onChange={(event) => setPublishText(event.target.value)}
              placeholder={publishMode === 'poll' ? '补充投票背景或说明（选填）...' : '分享你此刻的想法、校园新鲜事或求助问答...'}
              maxLength={2000}
            />
            <div className="text-right text-xs text-[var(--text-muted)] mt-1">
              {publishText.length} / 2000
            </div>
            {publishText.trim() || publishTags.length || pollQuestion.trim() || pollOptions.some((option) => option.trim()) ? (
              <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-[var(--text-muted)]" role="status" aria-live="polite">
                <span className="flex items-center gap-1.5">
                  <i className="bi bi-check-circle text-[var(--primary-color)]" />
                  {draftSavedAt
                    ? `草稿已自动保存 ${new Date(draftSavedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
                    : '正在保存草稿...'}
                </span>
                <button
                  className="font-bold text-[var(--primary-color)] hover:underline"
                  type="button"
                  onClick={clearPublishDraft}
                >
                  清空草稿
                </button>
              </div>
            ) : null}
          </div>

          {publishMode === 'poll' ? (
            <section className="poll-editor space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">投票设置</h3>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">每个访问者只能选择一项，投票后不可修改。</p>
                </div>
                <span className="badge">单选</span>
              </div>
              <input
                className="field w-full"
                value={pollQuestion}
                onChange={(event) => setPollQuestion(event.target.value)}
                placeholder="输入投票问题"
                maxLength={200}
                aria-label="投票问题"
              />
              <div className="space-y-2">
                {pollOptions.map((option, index) => (
                  <div className="flex items-center gap-2" key={`poll-option-${index}`}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary-light)] text-xs font-black text-[var(--primary-color)]">
                      {index + 1}
                    </span>
                    <input
                      className="field min-w-0 flex-1"
                      value={option}
                      onChange={(event) => setPollOptions((items) => items.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                      placeholder={`选项 ${index + 1}`}
                      maxLength={80}
                      aria-label={`投票选项 ${index + 1}`}
                    />
                    {pollOptions.length > 2 ? (
                      <button
                        className="btn btn-sm btn-ghost shrink-0 px-2 text-rose-500"
                        type="button"
                        title="删除选项"
                        onClick={() => setPollOptions((items) => items.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        <i className="bi bi-x-lg" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  className="btn btn-sm btn-outline"
                  type="button"
                  disabled={pollOptions.length >= 6}
                  onClick={() => setPollOptions((items) => [...items, ''])}
                >
                  <i className="bi bi-plus-circle" />
                  添加选项
                </button>
                <label className="flex items-center gap-2 text-xs font-bold text-[var(--text-secondary)]">
                  结束时间
                  <select className="field py-2 text-sm" value={pollDuration} onChange={(event) => setPollDuration(event.target.value)}>
                    <option value="1">1 天后</option>
                    <option value="3">3 天后</option>
                    <option value="7">7 天后</option>
                    <option value="none">长期有效</option>
                  </select>
                </label>
              </div>
            </section>
          ) : null}

          {/* Tags Section */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-[var(--text-secondary)]">添加标签 (最多8个):</div>
            {publishTags.length ? (
              <div className="flex flex-wrap gap-1.5">
                {publishTags.map((tag, index) => (
                  <span className="badge" key={tag}>
                    #{tag}
                    <button
                      className="tag-remove"
                      type="button"
                      aria-label={`移除标签 ${tag}`}
                      onClick={() => setPublishTags((items) => items.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <input
              className="field text-sm"
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={handleTagKey}
              placeholder="输入标签按回车确认（如：表白、日常、寻物）"
              aria-label="输入留言标签，按回车确认"
            />
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <span className="text-xs text-[var(--text-muted)] mr-1">推荐标签:</span>
              {presetTags.filter(t => !publishTags.includes(t)).map((tag) => (
                <button
                  type="button"
                  key={tag}
                  className="badge hover:bg-[var(--primary-color)] hover:text-white"
                  onClick={() => addTag(tag)}
                >
                  +{tag}
                </button>
              ))}
            </div>
            {suggestions.length ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {suggestions.map((tag) => (
                  <button className="badge" type="button" key={tag} onClick={() => addTag(tag)}>
                    #{tag}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Media Dropzone */}
          <label className="upload-dropzone flex min-h-32 cursor-pointer flex-col items-center justify-center p-5 text-center">
            <i className="bi bi-cloud-arrow-up-fill text-4xl text-[var(--primary-color)] mb-2" />
            <p className="text-sm font-bold text-[var(--text-primary)]">点击选择图片 / 视频 / 音频文件</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">支持 jpg, png, gif, mp4, mp3 等格式，单文件自动分片极速上传</p>
            <input
              className="sr-only"
              multiple
              type="file"
              accept="image/*,audio/*,video/*"
              onChange={(event) => setFiles(Array.from(event.target.files || []))}
            />
          </label>

          {/* Selected Files List */}
          {files.length ? (
            <div className="space-y-2 max-h-48 overflow-auto">
              {files.map((file, index) => (
                <div className="card-flat flex items-center justify-between p-3 text-xs" key={`${file.name}-${index}`}>
                  <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
                    <i className="bi bi-file-earmark-arrow-up text-[var(--primary-color)] text-base" />
                    <span className="truncate font-semibold">{file.name}</span>
                    <span className="text-[var(--text-muted)] shrink-0">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
                  </div>
                  <button
                    className="btn btn-sm btn-ghost text-rose-500 hover:bg-rose-500/10 shrink-0 ml-2"
                    type="button"
                    onClick={() => setFiles((items) => items.filter((_, i) => i !== index))}
                    aria-label={`移除附件 ${file.name}`}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {/* Upload Progress */}
          {statusText ? (
            <div className="space-y-1.5 pt-2" role="status" aria-live="polite">
              <div
                className="progress-track h-2"
                role="progressbar"
                aria-label="附件上传进度"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={progress}
              >
                <div
                  className="upload-progress-bar h-full bg-[var(--primary-color)] rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-center text-xs font-semibold text-[var(--text-secondary)]">{statusText}</p>
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
