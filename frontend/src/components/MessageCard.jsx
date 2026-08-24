import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import api from '../services/api'
import { fileType, fileUrl, messageAuthor } from '../utils/user'
import UserCard from './UserCard.jsx'
import FilePreviewModal from './FilePreviewModal.jsx'
import Modal from './Modal.jsx'
import { useAlert } from '../contexts/AlertContext.jsx'
import { useUser } from '../contexts/UserContext.jsx'
import { usePlatform } from '../contexts/PlatformContext.jsx'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const visualBoards = [
  { id: 'daily', tags: ['日常', '校园日常'] },
  { id: 'lost-found', tags: ['寻物', '失物', '失物招领'] },
  { id: 'confession', tags: ['表白', '表白墙'] },
  { id: 'tree-hole', tags: ['树洞'] },
  { id: 'news', tags: ['公告', '通知', '校园公告'] }
]

function messageVisualBoard(message) {
  const tags = new Set((message.tags || []).map((tag) => String(tag).trim()))
  return visualBoards.find((board) => board.tags.some((tag) => tags.has(tag)))?.id || 'news'
}

function Attachment({ file, index, onClick }) {
  const type = fileType(file)
  if (type === 'image') {
    return (
      <button
        className="attachment-preview group relative aspect-square cursor-pointer"
        type="button"
        onClick={onClick}
        aria-label={`预览第 ${index + 1} 个图片附件`}
      >
        <img
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 group-hover:brightness-105"
          src={fileUrl(file, true)}
          alt=""
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/20 opacity-0 transition-opacity group-hover:opacity-100 flex items-center justify-center text-white text-lg" aria-hidden="true">
          <i className="bi bi-zoom-in drop-shadow" />
        </div>
      </button>
    )
  }
  if (type === 'video') {
    return (
      <button
        className="attachment-preview group relative aspect-square cursor-pointer bg-slate-900 flex items-center justify-center"
        type="button"
        onClick={onClick}
        aria-label={`预览第 ${index + 1} 个视频附件`}
      >
        <video className="h-full w-full object-cover opacity-80" muted playsInline>
          <source src={fileUrl(file, true)} />
        </video>
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/20 transition-all" aria-hidden="true">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-md transition-transform group-hover:scale-110">
            <i className="bi bi-play-fill text-xl ml-0.5" />
          </div>
        </div>
      </button>
    )
  }
  if (type === 'audio') {
    return (
      <button
        className="btn btn-outline flex flex-col items-center justify-center gap-1.5 aspect-square rounded-xl p-2 text-xs"
        type="button"
        onClick={onClick}
        aria-label={`播放第 ${index + 1} 个音频附件`}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--primary-light)] text-[var(--primary-color)]">
          <i className="bi bi-music-note-beamed text-lg" />
        </div>
        <span className="truncate max-w-[80px] font-medium">音频播放</span>
      </button>
    )
  }
  return (
    <button
      className="btn btn-outline flex flex-col items-center justify-center gap-1.5 aspect-square rounded-xl p-2 text-xs"
      type="button"
      onClick={onClick}
      aria-label={`查看第 ${index + 1} 个附件`}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--primary-light)] text-[var(--primary-color)]">
        <i className="bi bi-file-earmark-text text-lg" />
      </div>
      <span className="truncate max-w-[80px] font-medium">查看附件</span>
    </button>
  )
}

function PollBlock({ poll, busy, onVote }) {
  if (!poll) return null
  const totalVotes = Number(poll.total_votes || 0)
  const hasVoted = Boolean(poll.has_voted || poll.selected_option_id)
  const isClosed = Boolean(poll.is_closed || (poll.closes_at && dayjs(poll.closes_at).isBefore(dayjs())))
  const showResults = hasVoted || isClosed

  return (
    <section className="poll-card" aria-label={`投票：${poll.question}`} aria-busy={busy}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--primary-color)]">
            <i className="bi bi-ui-radios-grid" />
            单选投票
          </div>
          <h3 className="mt-1.5 text-base font-black leading-snug text-[var(--text-primary)]">{poll.question}</h3>
        </div>
        <span className={`badge ${isClosed ? 'status-warning' : 'status-success'}`}>{isClosed ? '已结束' : '进行中'}</span>
      </div>
      <div className="mt-3 space-y-2">
        {(poll.options || []).map((option) => {
          const selected = poll.selected_option_id === option.id
          const percent = totalVotes > 0 ? Math.round((Number(option.votes || 0) / totalVotes) * 100) : 0
          return (
            <button
              className={`poll-option ${selected ? 'selected' : ''}`}
              type="button"
              key={option.id}
              disabled={busy || hasVoted || isClosed}
              aria-pressed={selected}
              onClick={() => onVote(option.id)}
            >
              {showResults ? <span className="poll-option-bar" style={{ width: `${percent}%` }} /> : null}
              <span className="poll-option-content">
                <span className="flex min-w-0 items-center gap-2">
                  <i className={`bi ${selected ? 'bi-check-circle' : 'bi-ui-radios-grid'} shrink-0`} />
                  <span className="truncate">{option.text}</span>
                </span>
                {showResults ? <b className="shrink-0 tabular-nums">{percent}%</b> : null}
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
        <span>{totalVotes} 人参与{!showResults && !isClosed ? '，选择一项后查看结果' : ''}</span>
        {poll.closes_at ? <span>{isClosed ? '结束于' : '截止'} {dayjs(poll.closes_at).format('MM月DD日 HH:mm')}</span> : <span>长期有效</span>}
      </div>
    </section>
  )
}

export default function MessageCard({ message, compact = false, onRefresh, onFavoriteChange, onEditRequest, onDeleteRequest }) {
  const [item, setItem] = useState(message)
  const [commentOpen, setCommentOpen] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentFiles, setCommentFiles] = useState([])
  const [replyTarget, setReplyTarget] = useState(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewFiles, setPreviewFiles] = useState([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [commentToDelete, setCommentToDelete] = useState(null)
  const [deletingComment, setDeletingComment] = useState(false)
  const commentInputRef = useRef(null)
  const commentsId = useId()
  const [busy, setBusy] = useState(false)
  const [pollBusy, setPollBusy] = useState(false)
  const alert = useAlert()
  const { user: sessionUser, isFavorite, toggleFavorite } = useUser()
  const { community } = usePlatform()

  useEffect(() => {
    setItem(message)
  }, [message])

  const files = item.files || []
  const comments = item.comments || []
  const author = useMemo(() => messageAuthor(item), [item])
  const visualBoard = useMemo(() => messageVisualBoard(item), [item])
  const favorited = isFavorite(item.id)
  const isHidden = item.moderation_status === 'hidden'
  const isPending = item.moderation_status === 'pending'
  const isUnavailable = isHidden || isPending
  const unavailableActionText = isPending ? '待审核的留言暂时不能互动' : '已下架的留言不能互动'
  const canComment = community.commenting_enabled && (Boolean(sessionUser) || community.guest_commenting_enabled)
  const commentDisabledReason = !community.commenting_enabled
    ? (community.pause_reason || '管理员暂时关闭了评论功能')
    : '当前仅登录学生可以评论'

  const doLike = async () => {
    try {
      const res = await api.likeMessage(item.id)
      if (res.data?.success) {
        const reaction = Number(res.data.reaction || 0)
        setItem((prev) => ({
          ...prev,
          likes: res.data.likes ?? prev.likes,
          dislikes: res.data.dislikes ?? prev.dislikes,
          liked: reaction === 1,
          disliked: reaction === -1
        }))
      }
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '点赞失败')
    }
  }

  const doDislike = async () => {
    try {
      const res = await api.dislikeMessage(item.id)
      if (res.data?.success) {
        const reaction = Number(res.data.reaction || 0)
        setItem((prev) => ({
          ...prev,
          likes: res.data.likes ?? prev.likes,
          dislikes: res.data.dislikes ?? prev.dislikes,
          liked: reaction === 1,
          disliked: reaction === -1
        }))
      }
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '点踩失败')
    }
  }

  const handleShare = async () => {
    const url = `${window.location.origin}/wall/message/${item.id}`
    try {
      if (navigator.share) {
        await navigator.share({
          title: '观澜校园墙留言',
          text: String(item.text || '分享一条观澜校园墙留言').slice(0, 100),
          url
        })
        return
      }
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url)
        alert.showTopRightAlert('留言链接已复制到剪贴板', 'success', '分享成功')
      } else {
        alert.showTopRightAlert(url, 'info', '分享链接')
      }
    } catch (error) {
      if (error?.name === 'AbortError') return
      alert.showTopRightAlert(url, 'info', '分享链接')
    }
  }

  const handleFavorite = async () => {
    if (!sessionUser) {
      alert.showTopRightAlert('登录学生账号后即可收藏留言', 'info', '需要登录')
      return
    }
    try {
      const next = await toggleFavorite(item.id)
      alert.showTopRightAlert(next ? '已加入我的收藏' : '已从收藏中移除', 'success', next ? '收藏成功' : '已取消收藏')
      onFavoriteChange?.(next, item.id)
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '收藏失败')
    }
  }

  const votePoll = async (optionId) => {
    if (pollBusy) return
    setPollBusy(true)
    try {
      const response = await api.votePoll(item.id, optionId)
      const data = response.data || {}
      if (data.poll) {
        setItem((previous) => ({
          ...previous,
          poll: {
            ...data.poll,
            selected_option_id: data.selected_option_id || null,
            has_voted: Boolean(data.selected_option_id),
            is_closed: Boolean(data.poll.closes_at && dayjs(data.poll.closes_at).isBefore(dayjs()))
          }
        }))
      }
      if (data.success) alert.showTopRightAlert('投票成功，结果已更新', 'success', '已投票')
      else alert.showTopRightAlert(data.error || '投票失败', 'warning', '无法投票')
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '投票失败')
    } finally {
      setPollBusy(false)
    }
  }

  const submitComment = async () => {
    if (!canComment) {
      alert.showTopRightAlert(commentDisabledReason, 'warning', '暂时无法评论')
      return
    }
    if (!commentText.trim() && commentFiles.length === 0) {
      alert.showTopRightAlert('评论内容不能为空', 'warning', '提示')
      return
    }
    setBusy(true)
    try {
      const res = await api.commentMessage(item.id, {
        text: commentText.trim(),
        files: commentFiles,
        refer_id: replyTarget?.id || ''
      })
      if (res.data?.success) {
        setItem((prev) => ({ ...prev, comments: [...(prev.comments || []), res.data.comment] }))
        setCommentText('')
        setCommentFiles([])
        setReplyTarget(null)
        alert.showTopRightAlert('评论成功', 'success', '成功')
        onRefresh?.(item.id)
      }
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '评论失败')
    } finally {
      setBusy(false)
    }
  }

  const openFilePreview = (targetFiles, index) => {
    setPreviewFiles(targetFiles)
    setPreviewIndex(index)
    setPreviewOpen(true)
  }

  const startReply = (comment, index) => {
    setReplyTarget({
      id: comment.id,
      floor: index + 1,
      text: String(comment.text || '附件评论').trim() || '附件评论'
    })
    setCommentOpen(true)
    window.setTimeout(() => commentInputRef.current?.focus(), 0)
  }

  const replyFloor = (commentId) => {
    const index = comments.findIndex((comment) => String(comment.id) === String(commentId))
    return index >= 0 ? `#${index + 1} 楼` : '一条已删除的评论'
  }

  const deleteOwnComment = async () => {
    if (!commentToDelete) return
    setDeletingComment(true)
    try {
      const response = await api.userDeleteComment(item.id, commentToDelete.id)
      if (response.data?.success) {
        setItem((previous) => ({
          ...previous,
          comments: (previous.comments || []).filter((comment) => comment.id !== commentToDelete.id)
        }))
        if (replyTarget?.id === commentToDelete.id) setReplyTarget(null)
        setCommentToDelete(null)
        alert.showTopRightAlert('评论已删除', 'success', '操作成功')
        onRefresh?.(item.id)
      }
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '删除失败')
    } finally {
      setDeletingComment(false)
    }
  }

  return (
    <article className="card message-card" data-board={visualBoard} aria-busy={busy || pollBusy || deletingComment}>
      <div className="message-card-body p-5 md:p-6 space-y-4">
        {/* Author Header */}
        <div className="flex items-center justify-between gap-3">
          <UserCard user={author} compact />
          <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs text-[var(--text-muted)] shrink-0">
            {item.pinned ? <span className="badge status-warning"><i className="bi bi-pin-angle" />置顶</span> : null}
            {item.featured ? <span className="badge status-success"><i className="bi bi-star-fill" />精华</span> : null}
            <span className="flex items-center gap-1.5">
              <i className="bi bi-clock text-[0.8rem]" />
              <span>{item.timestamp ? dayjs(item.timestamp).fromNow() : ''}</span>
            </span>
            {item.edited_at ? <span className="badge" title={`编辑于 ${item.edited_at}`}>已编辑</span> : null}
          </div>
        </div>

        {isUnavailable ? (
          <div className="message-hidden-notice" role="status">
            <i className={`bi ${isPending ? 'bi-hourglass-split' : 'bi-eye-slash'}`} />
            <div>
              <b>{isPending ? '这条留言正在等待审核' : '这条留言已被管理员下架'}</b>
              <p>{isPending ? '通过后才会出现在公开页面。' : (item.hidden_reason || '违反社区规范')}</p>
            </div>
          </div>
        ) : null}

        {/* Message Content */}
        {item.text ? (
          <p className={`message-text text-[0.98rem] md:text-[1.02rem] leading-relaxed text-[var(--text-primary)] ${compact ? 'line-clamp-3' : ''}`}>
            {item.text}
          </p>
        ) : null}

        <PollBlock poll={item.poll} busy={pollBusy} onVote={votePoll} />

        {/* Tags */}
        {item.tags?.length ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {item.tags.map((tag) => (
              <Link className="badge" key={tag} to={`/p/${encodeURIComponent(tag)}`}>
                #{tag}
              </Link>
            ))}
          </div>
        ) : null}

        {/* Media Grid */}
        {files.length ? (
          <div className="message-attachments pt-1">
            {files.map((file, index) => (
              <Attachment
                key={`${file}-${index}`}
                file={file}
                index={index}
                onClick={() => openFilePreview(files, index)}
              />
            ))}
          </div>
        ) : null}

        {/* Action Toolbar */}
        <div className="message-actions mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-color)] pt-3">
          <div className="flex items-center gap-2">
            <button
              className={`btn btn-sm ${item.liked ? 'btn-primary' : 'btn-outline'}`}
              type="button"
              onClick={doLike}
              disabled={isUnavailable}
              title={isUnavailable ? unavailableActionText : '点赞'}
              aria-label={item.liked ? `取消点赞，当前 ${item.likes || 0} 个赞` : `点赞，当前 ${item.likes || 0} 个赞`}
              aria-pressed={Boolean(item.liked)}
            >
              <i className={`bi ${item.liked ? 'bi-hand-thumbs-up-fill' : 'bi-hand-thumbs-up'}`} />
              <span>{item.likes || 0}</span>
            </button>
            <button
              className={`btn btn-sm ${item.disliked ? 'btn-primary' : 'btn-outline'}`}
              type="button"
              onClick={doDislike}
              disabled={isUnavailable}
              title={isUnavailable ? unavailableActionText : '点踩'}
              aria-label={item.disliked ? `取消点踩，当前 ${item.dislikes || 0} 次` : `点踩，当前 ${item.dislikes || 0} 次`}
              aria-pressed={Boolean(item.disliked)}
            >
              <i className={`bi ${item.disliked ? 'bi-hand-thumbs-down-fill' : 'bi-hand-thumbs-down'}`} />
              <span>{item.dislikes || 0}</span>
            </button>
            <button
              className={`btn btn-sm ${commentOpen ? 'bg-[var(--primary-light)] text-[var(--primary-color)]' : 'btn-outline'}`}
              type="button"
              onClick={() => setCommentOpen((open) => !open)}
              disabled={isUnavailable || !canComment}
              title={isUnavailable ? (isPending ? '待审核的留言不能评论' : '已下架的留言不能评论') : (canComment ? '评论' : commentDisabledReason)}
              aria-controls={commentsId}
              aria-expanded={commentOpen}
            >
              <i className="bi bi-chat-dots" />
              <span>评论 {comments.length ? `(${comments.length})` : ''}</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 ml-auto">
            <button
              className={`btn btn-sm ${favorited ? 'bg-[var(--primary-light)] text-[var(--primary-color)]' : 'btn-ghost'} px-2.5`}
              type="button"
              onClick={handleFavorite}
              title={favorited ? '取消收藏' : '收藏留言'}
              aria-label={favorited ? '取消收藏留言' : '收藏留言'}
              aria-pressed={favorited}
            >
              <i className={`bi ${favorited ? 'bi-heart-fill' : 'bi-heart'} text-sm`} />
              <span className="hidden sm:inline">{favorited ? '已收藏' : '收藏'}</span>
            </button>
            <button
              className="btn btn-sm btn-ghost p-2 text-[var(--text-secondary)]"
              type="button"
              onClick={handleShare}
              disabled={isUnavailable}
              title={isUnavailable ? '留言公开后才能分享' : '分享链接'}
              aria-label="分享留言链接"
            >
              <i className="bi bi-share text-sm" />
            </button>
            {!isUnavailable ? (
              <>
                <Link
                  className="btn btn-sm btn-outline text-xs px-2.5"
                  to={`/wall/message/${item.id}`}
                  title="查看详情"
                >
                  <i className="bi bi-arrow-up-right" />
                  <span>详情</span>
                </Link>
                <Link
                  className="btn btn-sm btn-ghost p-2 text-[var(--text-muted)] hover:text-rose-500"
                  to={`/help/report/${item.id}`}
                  title="举报违规"
                  aria-label="举报这条留言"
                >
                  <i className="bi bi-flag text-xs" />
                </Link>
              </>
            ) : null}
            {onDeleteRequest ? (
              <button
                className="btn btn-sm btn-ghost p-2 text-[var(--text-muted)] hover:text-rose-500"
                type="button"
                onClick={() => onDeleteRequest(item)}
                title="删除我的留言"
                aria-label="删除我的留言"
              >
                <i className="bi bi-trash text-sm" />
              </button>
            ) : null}
            {onEditRequest ? (
              <button
                className="btn btn-sm btn-ghost p-2 text-[var(--text-muted)] hover:text-[var(--primary-color)]"
                type="button"
                onClick={() => onEditRequest(item)}
                title="编辑我的留言"
                aria-label="编辑我的留言"
              >
                <i className="bi bi-pencil text-sm" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Comment Drawer */}
        {comments.length || commentOpen ? (
          <div className="space-y-3 pt-2" id={commentsId}>
            {comments.length ? (
              <div className="comment-panel space-y-2.5" aria-label={`${comments.length} 条评论`}>
                <div className="flex items-center justify-between text-xs font-bold text-[var(--text-secondary)] pb-1 border-b border-[var(--border-color)]">
                  <span className="flex items-center gap-1.5">
                    <i className="bi bi-chat-left-text-fill text-[var(--primary-color)]" />
                    <span>全部评论</span>
                  </span>
                  <span className="badge">{comments.length} 条</span>
                </div>
                <div className="space-y-2">
                  {comments.map((comment, index) => (
                    <div key={comment.id || index} className="comment-item space-y-2">
                      <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                        <span className="flex items-center gap-2 font-semibold text-[var(--text-secondary)]">
                          <span>#{index + 1} 楼</span>
                          {comment.owned ? <span className="badge">我的评论</span> : null}
                        </span>
                        <span className="flex items-center gap-2">
                          <span>{comment.timestamp}</span>
                          {comment.owned ? (
                            <button
                              className="comment-delete-button"
                              type="button"
                              title="删除我的评论"
                              aria-label={`删除第 ${index + 1} 楼我的评论`}
                              onClick={() => setCommentToDelete(comment)}
                            >
                              <i className="bi bi-trash" />
                            </button>
                          ) : null}
                        </span>
                      </div>
                      {comment.refer_id ? (
                        <div className="comment-reference">
                          <i className="bi bi-reply-fill" />
                          <b>回复 {replyFloor(comment.refer_id)}</b>
                          <span>{comment.refer || '评论内容已不可见'}</span>
                        </div>
                      ) : null}
                      {comment.text ? <p className="message-text text-xs md:text-sm text-[var(--text-primary)]">{comment.text}</p> : null}
                      {comment.files?.length ? (
                        <div className="comment-attachments">
                          {comment.files.map((file, fileIndex) => (
                            <Attachment
                              file={file}
                              index={fileIndex}
                              key={`${comment.id || index}-${file}-${fileIndex}`}
                              onClick={() => openFilePreview(comment.files, fileIndex)}
                            />
                          ))}
                        </div>
                      ) : null}
                      {!isUnavailable ? (
                        <div className="flex justify-end gap-2">
                          {comment.id ? (
                            <Link
                              className="comment-reply-button"
                              to={`/help/report/${item.id}/comment/${encodeURIComponent(comment.id)}`}
                              title={`举报第 ${index + 1} 楼评论`}
                              aria-label={`举报第 ${index + 1} 楼评论`}
                            >
                              <i className="bi bi-flag" />
                              <span>举报</span>
                            </Link>
                          ) : null}
                          <button className="comment-reply-button" type="button" disabled={!canComment} title={canComment ? '回复评论' : commentDisabledReason} onClick={() => startReply(comment, index)}>
                            <i className="bi bi-reply" />
                            <span>回复</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {commentOpen && !isUnavailable && !canComment ? (
              <div className="info-callout status-warning" role="status"><i className="bi bi-info-circle-fill" /><span>{commentDisabledReason}</span></div>
            ) : null}

            {commentOpen && !isUnavailable && canComment ? (
              <div className="comment-composer">
                {replyTarget ? (
                  <div className="reply-target-banner">
                    <span className="min-w-0">
                      <b>正在回复 #{replyTarget.floor} 楼</b>
                      <span>{replyTarget.text}</span>
                    </span>
                    <button type="button" title="取消回复" aria-label="取消回复" onClick={() => setReplyTarget(null)}>
                      <i className="bi bi-x-lg" />
                    </button>
                  </div>
                ) : null}
                <label className="sr-only" htmlFor={`${commentsId}-composer`}>评论内容</label>
                <textarea
                  id={`${commentsId}-composer`}
                  ref={commentInputRef}
                  className="field min-h-20 w-full text-sm"
                  value={commentText}
                  onChange={(event) => setCommentText(event.target.value)}
                  placeholder={replyTarget ? `回复 #${replyTarget.floor} 楼...` : '友善表达，写下你的精彩评论...'}
                  maxLength={500}
                />
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                  <label className="btn btn-sm btn-outline cursor-pointer">
                    <i className="bi bi-paperclip" />
                    <span>附件</span>
                    <input
                      className="sr-only"
                      multiple
                      type="file"
                      accept="image/*,audio/*,video/*"
                      onChange={(event) => setCommentFiles(Array.from(event.target.files || []))}
                    />
                  </label>
                  {commentFiles.map((file) => (
                    <span className="badge" key={file.name}>
                      <i className="bi bi-file-earmark" />
                      {file.name}
                    </span>
                  ))}
                  <button
                    className="btn btn-sm btn-primary ml-auto"
                    type="button"
                    disabled={busy || (!commentText.trim() && commentFiles.length === 0)}
                    onClick={submitComment}
                    aria-busy={busy}
                  >
                    <i className="bi bi-send" />
                    <span>{busy ? '发送中...' : '发表评论'}</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <FilePreviewModal
        files={previewFiles}
        index={previewIndex}
        visible={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onIndexChange={setPreviewIndex}
      />
      <Modal
        visible={Boolean(commentToDelete)}
        title="删除我的评论"
        onClose={() => !deletingComment && setCommentToDelete(null)}
        footer={(
          <>
            <button className="btn btn-outline" type="button" disabled={deletingComment} onClick={() => setCommentToDelete(null)}>取消</button>
            <button className="btn bg-rose-600 text-white hover:bg-rose-700" type="button" disabled={deletingComment} onClick={deleteOwnComment}>
              <i className="bi bi-trash" />
              <span>{deletingComment ? '删除中...' : '确认删除'}</span>
            </button>
          </>
        )}
      >
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">删除后评论会立即从公开页面和你的评论列表中移除，留言作者收到的历史通知仍会保留。</p>
      </Modal>
    </article>
  )
}
