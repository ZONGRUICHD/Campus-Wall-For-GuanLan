import { useEffect, useMemo, useRef, useState } from 'react'
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
import { usePlatform } from '../contexts/PlatformContext.jsx'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

function Attachment({ file, index, onClick, moments = false, remaining = 0 }) {
  const type = fileType(file)
  const mediaClass = moments ? 'moments-media-item' : ''
  if (type === 'image') {
    return (
      <button
        className={`group relative aspect-square overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-secondary-bg)] cursor-pointer ${mediaClass}`}
        type="button"
        onClick={onClick}
        aria-label={`预览第 ${index + 1} 张图片`}
      >
        <img
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 group-hover:brightness-105"
          src={fileUrl(file, true)}
          alt={`留言图片 ${index + 1}`}
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/20 opacity-0 transition-opacity group-hover:opacity-100 flex items-center justify-center text-white text-lg">
          <i className="bi bi-zoom-in" aria-hidden="true" />
        </div>
        {remaining > 0 ? <span className="moments-media-more">+{remaining}</span> : null}
      </button>
    )
  }
  if (type === 'video') {
    return (
      <button
        className={`group relative aspect-square overflow-hidden rounded-xl border border-[var(--border-color)] bg-slate-900 cursor-pointer flex items-center justify-center ${mediaClass}`}
        type="button"
        onClick={onClick}
        aria-label={`预览第 ${index + 1} 个视频`}
      >
        <video className="h-full w-full object-cover opacity-80" muted playsInline>
          <source src={fileUrl(file, true)} />
        </video>
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/20 transition-all">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-md transition-transform group-hover:scale-110">
            <i className="bi bi-play-fill text-xl ml-0.5" aria-hidden="true" />
          </div>
        </div>
        {remaining > 0 ? <span className="moments-media-more">+{remaining}</span> : null}
      </button>
    )
  }
  if (type === 'audio') {
    return (
      <button
        className={`btn btn-outline flex flex-col items-center justify-center gap-1.5 aspect-square rounded-xl p-2 text-xs ${mediaClass}`}
        type="button"
        onClick={onClick}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--primary-light)] text-[var(--primary-color)]">
          <i className="bi bi-music-note-beamed text-lg" />
        </div>
        <span className="truncate max-w-[80px] font-medium">音频播放</span>
        {remaining > 0 ? <span className="moments-media-more">+{remaining}</span> : null}
      </button>
    )
  }
  return (
    <button
      className={`btn btn-outline flex flex-col items-center justify-center gap-1.5 aspect-square rounded-xl p-2 text-xs ${mediaClass}`}
      type="button"
      onClick={onClick}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--primary-light)] text-[var(--primary-color)]">
        <i className="bi bi-file-earmark-text text-lg" />
      </div>
      <span className="truncate max-w-[80px] font-medium">查看附件</span>
      {remaining > 0 ? <span className="moments-media-more">+{remaining}</span> : null}
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
    <section className="poll-card" aria-label={`投票：${poll.question}`}>
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

export default function MessageCard({ message, compact = false, variant = 'default', onRefresh, onEditRequest, onDeleteRequest }) {
  const [item, setItem] = useState(message)
  const [commentOpen, setCommentOpen] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [replyTarget, setReplyTarget] = useState(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewFiles, setPreviewFiles] = useState([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [commentToDelete, setCommentToDelete] = useState(null)
  const [deletingComment, setDeletingComment] = useState(false)
  const commentInputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [pollBusy, setPollBusy] = useState(false)
  const alert = useAlert()
  const { community } = usePlatform()

  useEffect(() => {
    setItem(message)
  }, [message])

  const files = item.files || []
  const isMoments = variant === 'moments'
  const visibleFiles = isMoments ? files.slice(0, 9) : files
  const comments = item.comments || []
  const author = useMemo(() => messageAuthor(item), [item])
  const isHidden = item.moderation_status === 'hidden'
  const isPending = item.moderation_status === 'pending'
  const isUnavailable = isHidden || isPending
  const unavailableActionText = isPending ? '待审核的留言暂时不能互动' : '已下架的留言不能互动'
  const canComment = community.commenting_enabled
  const commentDisabledReason = community.pause_reason || '管理员暂时关闭了评论功能'

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
          title: '校园墙留言',
          text: String(item.text || '分享一条校园墙留言').slice(0, 100),
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
    if (!commentText.trim()) {
      alert.showTopRightAlert('评论内容不能为空', 'warning', '提示')
      return
    }
    setBusy(true)
    try {
      const res = await api.commentMessage(item.id, {
        text: commentText.trim(),
        refer_id: replyTarget?.id || ''
      })
      if (res.data?.success) {
        setItem((prev) => ({ ...prev, comments: [...(prev.comments || []), res.data.comment] }))
        setCommentText('')
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
    <article className={`card message-card ${isMoments ? 'is-moments' : ''}`}>
      <div className="message-card-body p-5 md:p-6">
        {/* Author Header */}
        <div className="message-card-header flex items-center justify-between gap-3">
          <UserCard user={author} compact />
          <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs text-[var(--text-muted)] shrink-0">
            {item.pinned ? <span className="badge status-warning"><i className="bi bi-pin-angle" />置顶</span> : null}
            {item.featured ? <span className="badge status-success"><i className="bi bi-star-fill" />精华</span> : null}
            {!isMoments ? (
              <>
                <span className="flex items-center gap-1.5">
                  <i className="bi bi-clock text-[0.8rem]" />
                  <span>{item.timestamp ? dayjs(item.timestamp).fromNow() : ''}</span>
                </span>
                {item.edited_at ? <span className="badge" title={`编辑于 ${item.edited_at}`}>已编辑</span> : null}
              </>
            ) : null}
          </div>
        </div>

        <div className="message-card-content">

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
          <div className={`message-attachments pt-1 ${isMoments ? `moments-media-grid moments-media-count-${Math.min(files.length, 9)}` : ''}`}>
            {visibleFiles.map((file, index) => (
              <Attachment
                key={`${file}-${index}`}
                file={file}
                index={index}
                moments={isMoments}
                remaining={isMoments && index === 8 ? Math.max(0, files.length - 9) : 0}
                onClick={() => openFilePreview(files, index)}
              />
            ))}
          </div>
        ) : null}

        {isMoments ? (
          <div className="moments-post-meta">
            <span>{item.timestamp ? dayjs(item.timestamp).fromNow() : '刚刚'}</span>
            {item.edited_at ? <span title={`编辑于 ${item.edited_at}`}>已编辑</span> : null}
            <span className="moments-post-visibility"><i className="bi bi-incognito" aria-hidden="true" />匿名动态</span>
          </div>
        ) : null}

        {/* Action Toolbar */}
        <div className={`message-actions mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-color)] pt-3 ${isMoments ? 'moments-action-bar' : ''}`}>
          <div className="flex items-center gap-2">
            <button
              className={`btn btn-sm ${item.liked ? 'btn-primary' : 'btn-outline'}`}
              type="button"
              onClick={doLike}
              disabled={isUnavailable}
              title={isUnavailable ? unavailableActionText : '点赞'}
            >
              <i className={`bi ${item.liked ? 'bi-hand-thumbs-up-fill' : 'bi-hand-thumbs-up'}`} />
              <span>{isMoments ? '赞' : (item.likes || 0)}</span>
            </button>
            <button
              className={`btn btn-sm ${item.disliked ? 'btn-primary' : 'btn-outline'}`}
              type="button"
              onClick={doDislike}
              disabled={isUnavailable}
              title={isUnavailable ? unavailableActionText : '点踩'}
            >
              <i className={`bi ${item.disliked ? 'bi-hand-thumbs-down-fill' : 'bi-hand-thumbs-down'}`} />
              <span>{isMoments ? '踩' : (item.dislikes || 0)}</span>
            </button>
            <button
              className={`btn btn-sm ${commentOpen ? 'bg-[var(--primary-light)] text-[var(--primary-color)]' : 'btn-outline'}`}
              type="button"
              onClick={() => setCommentOpen((open) => !open)}
              disabled={isUnavailable || !canComment}
              title={isUnavailable ? (isPending ? '待审核的留言不能评论' : '已下架的留言不能评论') : (canComment ? '评论' : commentDisabledReason)}
            >
              <i className="bi bi-chat-dots" />
              <span>评论{!isMoments && comments.length ? ` (${comments.length})` : ''}</span>
            </button>
          </div>

          {isMoments ? (
            <details className="moments-overflow ml-auto">
              <summary aria-label="更多动态操作" title="更多操作"><span aria-hidden="true">•••</span></summary>
              <div className="moments-overflow-menu">
                <button type="button" onClick={handleShare} disabled={isUnavailable}>
                  <i className="bi bi-share" aria-hidden="true" /><span>分享动态</span>
                </button>
                {!isUnavailable ? (
                  <>
                    <Link to={`/wall/message/${item.id}`}><i className="bi bi-arrow-up-right" aria-hidden="true" /><span>查看详情</span></Link>
                    <Link to={`/help/report/${item.id}`}><i className="bi bi-flag" aria-hidden="true" /><span>举报违规</span></Link>
                  </>
                ) : null}
                {onEditRequest ? (
                  <button type="button" onClick={() => onEditRequest(item)}><i className="bi bi-pencil" aria-hidden="true" /><span>编辑动态</span></button>
                ) : null}
                {onDeleteRequest ? (
                  <button className="is-danger" type="button" onClick={() => onDeleteRequest(item)}><i className="bi bi-trash" aria-hidden="true" /><span>删除动态</span></button>
                ) : null}
              </div>
            </details>
          ) : (
            <div className="flex items-center gap-1.5 ml-auto">
              <button
                className="btn btn-sm btn-ghost p-2 text-[var(--text-secondary)]"
                type="button"
                onClick={handleShare}
                disabled={isUnavailable}
                title={isUnavailable ? '留言公开后才能分享' : '分享链接'}
              >
                <i className="bi bi-share text-sm" />
              </button>
              {!isUnavailable ? (
                <>
                  <Link className="btn btn-sm btn-outline text-xs px-2.5" to={`/wall/message/${item.id}`} title="查看详情">
                    <i className="bi bi-arrow-up-right" /><span>详情</span>
                  </Link>
                  <Link className="btn btn-sm btn-ghost p-2 text-[var(--text-muted)] hover:text-rose-500" to={`/help/report/${item.id}`} title="举报违规">
                    <i className="bi bi-flag text-xs" />
                  </Link>
                </>
              ) : null}
              {onDeleteRequest ? (
                <button className="btn btn-sm btn-ghost p-2 text-[var(--text-muted)] hover:text-rose-500" type="button" onClick={() => onDeleteRequest(item)} title="删除我的留言">
                  <i className="bi bi-trash text-sm" />
                </button>
              ) : null}
              {onEditRequest ? (
                <button className="btn btn-sm btn-ghost p-2 text-[var(--text-muted)] hover:text-[var(--primary-color)]" type="button" onClick={() => onEditRequest(item)} title="编辑我的留言">
                  <i className="bi bi-pencil text-sm" />
                </button>
              ) : null}
            </div>
          )}
        </div>

        {isMoments && (Number(item.likes || 0) > 0 || Number(item.dislikes || 0) > 0 || comments.length > 0) ? (
          <div className="moments-reaction-summary">
            {Number(item.likes || 0) > 0 ? (
              <span><i className="bi bi-hand-thumbs-up-fill" aria-hidden="true" />{item.likes} 人觉得很赞</span>
            ) : null}
            {Number(item.dislikes || 0) > 0 ? (
              <span><i className="bi bi-hand-thumbs-down" aria-hidden="true" />{item.dislikes} 人有不同看法</span>
            ) : null}
            {comments.length > 0 ? (
              <button type="button" onClick={() => setCommentOpen(true)}>
                <i className="bi bi-chat-square-text" aria-hidden="true" />{comments.length} 条讨论
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Comment Drawer */}
        {comments.length || commentOpen ? (
          <div className="space-y-3 pt-2">
            {comments.length ? (
              <div className="comment-panel space-y-2.5">
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
              <div className="info-callout status-warning"><i className="bi bi-info-circle-fill" /><span>{commentDisabledReason}</span></div>
            ) : null}

            {commentOpen && !isUnavailable && canComment ? (
              <div className="comment-composer">
                {replyTarget ? (
                  <div className="reply-target-banner">
                    <span className="min-w-0">
                      <b>正在回复 #{replyTarget.floor} 楼</b>
                      <span>{replyTarget.text}</span>
                    </span>
                    <button type="button" title="取消回复" onClick={() => setReplyTarget(null)}>
                      <i className="bi bi-x-lg" />
                    </button>
                  </div>
                ) : null}
                <textarea
                  ref={commentInputRef}
                  className="field min-h-20 w-full text-sm"
                  value={commentText}
                  onChange={(event) => setCommentText(event.target.value)}
                  placeholder={replyTarget ? `回复 #${replyTarget.floor} 楼...` : '友善表达，写下你的精彩评论...'}
                  maxLength={500}
                />
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                  <button
                    className="btn btn-sm btn-primary ml-auto"
                    type="button"
                    disabled={busy || !commentText.trim()}
                    onClick={submitComment}
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
