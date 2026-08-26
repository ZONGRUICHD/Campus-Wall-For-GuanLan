import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import api from '../services/api'
import MessageCard from '../components/MessageCard.jsx'
import Modal from '../components/Modal.jsx'
import UserCard from '../components/UserCard.jsx'
import { useAlert } from '../contexts/AlertContext.jsx'
import { usePlatform } from '../contexts/PlatformContext.jsx'
import { useUser } from '../contexts/UserContext.jsx'
import { anonymousUser } from '../utils/user.js'

const CHUNK_SIZE = 5 * 1024 * 1024
const MAX_POST_FILES = 20
const presetTags = ['日常', '表白', '树洞', '提问', '吐槽', '寻物', '学习', '互助']
const DRAFT_STORAGE_PREFIX = 'campus-wall-publish-draft-v1'
const EMPTY_POLL_OPTIONS = ['', '']
const getScrollBehavior = () => (
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
)

function SelectedMediaTile({ file, index, onRemove }) {
  const [previewUrl, setPreviewUrl] = useState('')
  const isImage = file.type.startsWith('image/')
  const isVideo = file.type.startsWith('video/')
  const isAudio = file.type.startsWith('audio/')

  useEffect(() => {
    if (!isImage && !isVideo) {
      setPreviewUrl('')
      return undefined
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file, isImage, isVideo])

  return (
    <div className="moments-compose-media-item">
      {isImage && previewUrl ? <img src={previewUrl} alt={`待上传图片 ${index + 1}`} /> : null}
      {isVideo && previewUrl ? <video src={previewUrl} muted playsInline aria-label={`待上传视频 ${index + 1}`} /> : null}
      {!isImage && !isVideo ? (
        <span className="moments-compose-file-symbol" aria-hidden="true">
          <i className={`bi ${isAudio ? 'bi-music-note-beamed' : 'bi-file-earmark'}`} />
        </span>
      ) : null}
      {isVideo ? <span className="moments-compose-video-badge"><i className="bi bi-play-fill" />视频</span> : null}
      <button
        className="moments-compose-remove"
        type="button"
        aria-label={`移除 ${file.name}`}
        title={`移除 ${file.name}`}
        onClick={onRemove}
      >
        <i className="bi bi-x-lg" aria-hidden="true" />
      </button>
      <span className="moments-compose-file-name">{file.name}</span>
    </div>
  )
}

export default function Wall() {
  const location = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const { community } = usePlatform()
  const { user } = useUser()
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
  const [publishAnonymous, setPublishAnonymous] = useState(true)
  const [publishText, setPublishText] = useState('')
  const [publishTags, setPublishTags] = useState([])
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
  const draftKey = `${DRAFT_STORAGE_PREFIX}:guest`
  const canPublish = community.posting_enabled
  const publishDisabledReason = community.pause_reason || '管理员暂时关闭了发帖功能'

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
          setPublishMode(saved.mode === 'poll' ? 'poll' : 'post')
          setPollQuestion(String(saved.pollQuestion || '').slice(0, 200))
          setPollOptions(Array.isArray(saved.pollOptions) && saved.pollOptions.length >= 2
            ? saved.pollOptions.slice(0, 6).map((option) => String(option || '').slice(0, 80))
            : EMPTY_POLL_OPTIONS)
          setPollDuration(['1', '3', '7', 'none'].includes(saved.pollDuration) ? saved.pollDuration : '3')
          if (typeof saved.anonymous === 'boolean') setPublishAnonymous(saved.anonymous)
          setDraftSavedAt(saved.savedAt || '')
        }
      } catch {}
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
    if (!location.state?.openPublish) return
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null })
    openPublish()
  }, [location.hash, location.pathname, location.search, location.state, navigate, openPublish])

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
          mode: publishMode,
          pollQuestion,
          pollOptions,
          pollDuration,
          anonymous: publishAnonymous,
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

  const handleFileSelection = (event) => {
    const existing = new Set(files.map((file) => `${file.name}:${file.size}:${file.lastModified}`))
    const selected = Array.from(event.target.files || []).filter((file) => {
      const key = `${file.name}:${file.size}:${file.lastModified}`
      if (existing.has(key)) return false
      existing.add(key)
      return true
    })
    const available = Math.max(0, MAX_POST_FILES - files.length)
    const accepted = selected.slice(0, available)
    if (selected.length > available) {
      alert.showTopRightAlert(`每条动态最多添加 ${MAX_POST_FILES} 个媒体文件`, 'warning', `已保留前 ${MAX_POST_FILES} 项`)
    }
    if (accepted.length) setFiles((items) => [...items, ...accepted])
    event.target.value = ''
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
    const fileKey = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`
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
        anonymous: Boolean(user) ? publishAnonymous : true,
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
        pendingReview ? '留言已提交审核，请稍后在校园动态中查看' : '留言已成功发布！',
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

  return (
    <div className="wall-page space-y-6">
      {/* Wall Header Overview */}
      <section className="wall-overview p-6 md:p-8">
        <div className="wall-overview-copy space-y-2">
          <h1 className="text-3xl font-black tracking-tight text-[var(--text-primary)] md:text-4xl">
            观澜中学校园动态
          </h1>
        </div>
      </section>

      {!canPublish ? (
        <div className="info-callout status-warning">
          <i className="bi bi-info-circle-fill" />
          <span>{publishDisabledReason}</span>
        </div>
      ) : null}

      {/* Filter & Search Bar */}
      <div className="search-panel">
        <form className="min-w-64 flex-1" onSubmit={(event) => { event.preventDefault(); refresh() }}>
          <label className="sr-only" htmlFor="wall-search">搜索留言关键词或标签</label>
          <div className="relative">
            <i className="bi bi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              id="wall-search"
              className="field pl-10 w-full"
              value={searchWord}
              onChange={(event) => setSearchWord(event.target.value)}
              placeholder="搜索留言关键词或标签..."
            />
            {searchWord ? (
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                onClick={() => { setSearchWord(''); loadMessages({ reset: true, wordValue: '' }) }}
                aria-label="清空搜索关键词"
              >
                <i className="bi bi-x-circle-fill" />
              </button>
            ) : null}
          </div>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="wall-content-filter">内容类型</label>
          <select id="wall-content-filter" className="field w-auto" value={filter} onChange={(e) => handleFilterChange(e.target.value)}>
            <option value="all">全部内容</option>
            <option value="files">有图/视频/音频</option>
            <option value="polls">投票帖</option>
          </select>

          <label className="sr-only" htmlFor="wall-sort-order">排序方式</label>
          <select id="wall-sort-order" className="field w-auto" value={sortBy} onChange={(e) => handleSortChange(e.target.value)}>
            <option value="newest">最新发布</option>
            <option value="likes">点赞最多</option>
            <option value="dislikes">点踩最多</option>
          </select>

          <button className="btn btn-outline" type="button" onClick={refresh} title="刷新列表">
            <i className="bi bi-arrow-clockwise" />
            <span className="hidden sm:inline">刷新</span>
          </button>

          <button className="btn btn-primary" type="button" onClick={openPublish}>
            <i className="bi bi-pencil-square" />
            <span>我要发帖</span>
          </button>
        </div>
      </div>

      {searchWord ? (
        <div className="flex items-center justify-between rounded-[var(--radius-md)] bg-[var(--primary-light)] px-4 py-3 text-sm text-[var(--text-primary)]">
          <span>找到关键词 <b>"{searchWord}"</b> 相关的 <b>{messages.length}</b> 条留言</span>
          <button
            className="text-xs text-[var(--primary-color)] hover:underline font-bold"
            type="button"
            onClick={() => { setSearchWord(''); loadMessages({ reset: true, wordValue: '' }) }}
          >
            清空搜索
          </button>
        </div>
      ) : null}

      {/* Loading Skeleton */}
      {loading && messages.length === 0 ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="skeleton h-11 w-11 rounded-full shrink-0" />
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
        <div className="empty-state-card">
          <i className="bi bi-chat-square-dots" />
          <p className="mt-4 text-base font-bold text-[var(--text-primary)]">暂无相关留言</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">来发表第一条内容，开启大家的讨论吧！</p>
          <button className="btn btn-primary mt-5" type="button" disabled={!canPublish} onClick={openPublish}>
            <i className="bi bi-pencil-square" />
            <span>立即发帖</span>
          </button>
        </div>
      ) : null}

      {/* Messages Stream */}
      <div className="space-y-5">
        {messages.map((message) => (
          <MessageCard key={message.id} message={message} variant="moments" onRefresh={refreshSpecificMessage} />
        ))}
      </div>

      {/* Load More */}
      {hasMore && messages.length ? (
        <div className="text-center pt-4">
          <button
            className="btn btn-lg btn-outline min-w-48"
            disabled={loadingMore}
            onClick={loadMore}
          >
            {loadingMore ? (
              <>
                <div className="spinner h-4 w-4 border-2" />
                <span>加载中...</span>
              </>
            ) : (
              <>
                <i className="bi bi-chevron-down" />
                <span>加载更多留言</span>
              </>
            )}
          </button>
        </div>
      ) : null}

      {/* Floating Action Buttons */}
      <div className="floating-actions">
        <button
          className="floating-action-primary"
          type="button"
          aria-label="发布留言"
          title="发帖"
          onClick={openPublish}
          disabled={!canPublish}
        >
          <i className="bi bi-pencil-fill text-xl" />
        </button>
        <button
          className="floating-action-secondary"
          type="button"
          aria-label="返回顶部"
          title="回到顶部"
          onClick={() => window.scrollTo({ top: 0, behavior: getScrollBehavior() })}
        >
          <i className="bi bi-arrow-up text-lg" />
        </button>
      </div>

      {/* Publish Modal */}
      <Modal
        visible={publishOpen}
        title="发布校园动态"
        width="760px"
        onClose={() => setPublishOpen(false)}
        footer={(
          <>
            <button className="btn btn-outline" type="button" onClick={() => setPublishOpen(false)}>
              取消
            </button>
            <button
              className="btn btn-primary px-6"
              type="button"
              disabled={!canPublish || publishing}
              onClick={submitPublish}
            >
              {publishing ? '正在发布...' : '发布'}
            </button>
          </>
        )}
      >
        <div className="moments-composer">
          <div className="moments-composer-identity">
            <UserCard
              user={(!user || publishAnonymous) ? anonymousUser : { ...user, description: user.bio }}
              compact
            />
            {user ? (
              <button
                className="moments-composer-privacy"
                type="button"
                aria-pressed={!publishAnonymous}
                onClick={() => setPublishAnonymous((current) => !current)}
              >
                <i className={`bi ${publishAnonymous ? 'bi-incognito' : 'bi-person-badge'}`} aria-hidden="true" />
                {publishAnonymous ? '匿名发布' : '展示昵称'}
              </button>
            ) : (
              <span className="moments-composer-privacy">
                <i className="bi bi-incognito" aria-hidden="true" />
                游客仅能匿名发布
              </span>
            )}
          </div>

          <div className="moments-composer-mode" role="group" aria-label="动态类型">
            <button
              className={publishMode === 'post' ? 'is-active' : ''}
              type="button"
              aria-pressed={publishMode === 'post'}
              onClick={() => setPublishMode('post')}
            >
              <i className="bi bi-chat-square-text" />
              图文动态
            </button>
            <button
              className={publishMode === 'poll' ? 'is-active' : ''}
              type="button"
              aria-pressed={publishMode === 'poll'}
              onClick={() => setPublishMode('poll')}
            >
              <i className="bi bi-ui-radios-grid" />
              发起投票
            </button>
          </div>

          <section className="moments-composer-surface" aria-label="动态内容">
            <textarea
              className="moments-composer-textarea"
              value={publishText}
              onChange={(event) => setPublishText(event.target.value)}
              placeholder={publishMode === 'poll' ? '补充投票背景或说明（选填）' : '这一刻，想和大家分享什么？'}
              maxLength={2000}
            />

            <div className={`moments-compose-media-grid ${files.length === 1 ? 'has-single' : ''}`}>
              {files.map((file, index) => (
                <SelectedMediaTile
                  file={file}
                  index={index}
                  key={`${file.name}-${file.lastModified}-${index}`}
                  onRemove={() => setFiles((items) => items.filter((_, itemIndex) => itemIndex !== index))}
                />
              ))}
              {files.length < MAX_POST_FILES ? (
                <label className="moments-compose-add-media">
                  <i className="bi bi-plus-lg" aria-hidden="true" />
                  <span>{files.length ? '继续添加' : '媒体文件'}</span>
                  <small>{files.length}/{MAX_POST_FILES}</small>
                  <input
                    hidden
                    multiple
                    type="file"
                    accept="image/*,audio/*,video/*"
                    onChange={handleFileSelection}
                  />
                </label>
              ) : null}
            </div>

            <div className="moments-composer-counter">{publishText.length} / 2000</div>
            {publishText.trim() || publishTags.length || pollQuestion.trim() || pollOptions.some((option) => option.trim()) ? (
              <div className="moments-draft-status">
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
          </section>

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
          <section className="moments-composer-options" aria-labelledby="publish-tags-title">
            <div className="moments-composer-option-heading">
              <span id="publish-tags-title"><i className="bi bi-hash" aria-hidden="true" /> 添加话题</span>
              <small>最多 8 个</small>
            </div>
            {publishTags.length ? (
              <div className="flex flex-wrap gap-1.5 px-4 pt-3">
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
              className="moments-composer-tag-input"
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={handleTagKey}
              placeholder="输入标签按回车确认（如：表白、日常、寻物）"
            />
            <div className="moments-composer-tag-suggestions">
              {presetTags.filter(t => !publishTags.includes(t)).map((tag) => (
                <button
                  type="button"
                  key={tag}
                  className="badge hover:bg-[var(--action-fill)] hover:text-white"
                  onClick={() => addTag(tag)}
                >
                  +{tag}
                </button>
              ))}
            </div>
            {suggestions.length ? (
              <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                {suggestions.map((tag) => (
                  <button className="badge" type="button" key={tag} onClick={() => addTag(tag)}>
                    #{tag}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          {/* Upload Progress */}
          {statusText ? (
            <div className="moments-upload-progress">
              <div className="progress-track h-2">
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
