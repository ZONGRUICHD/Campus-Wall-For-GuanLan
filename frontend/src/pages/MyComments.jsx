import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import api from '../services/api'
import FilePreviewModal from '../components/FilePreviewModal.jsx'
import Modal from '../components/Modal.jsx'
import { useAlert } from '../contexts/AlertContext.jsx'
import { useUser } from '../contexts/UserContext.jsx'
import { fileType } from '../utils/user'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const PAGE_SIZE = 20

const attachmentIcon = (file) => {
  const type = fileType(file)
  if (type === 'image') return 'bi-image'
  if (type === 'video') return 'bi-camera-video'
  if (type === 'audio') return 'bi-music-note-beamed'
  if (type === 'pdf') return 'bi-file-earmark-pdf'
  return 'bi-paperclip'
}

export default function MyComments() {
  const { user, loading: userLoading } = useUser()
  const [comments, setComments] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [previewFiles, setPreviewFiles] = useState([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [previewOpen, setPreviewOpen] = useState(false)
  const alert = useAlert()

  const loadComments = async (nextPage = 1, append = false) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    try {
      const response = await api.userComments({ page: nextPage, page_size: PAGE_SIZE })
      const incoming = response.data?.comments || []
      setComments((current) => append ? [...current, ...incoming] : incoming)
      setPage(response.data?.page || nextPage)
      setTotal(response.data?.total || 0)
      setTotalPages(response.data?.total_pages || 0)
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '评论记录加载失败')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    if (user) loadComments(1, false)
  }, [user?.id])

  if (userLoading) {
    return <div className="page-center"><div className="spinner" /></div>
  }
  if (!user) return <Navigate to="/login" replace />

  const openPreview = (files, index) => {
    setPreviewFiles(files)
    setPreviewIndex(index)
    setPreviewOpen(true)
  }

  const deleteComment = async () => {
    if (!selected) return
    setDeleting(true)
    try {
      const response = await api.userDeleteComment(selected.message_id, selected.id)
      if (response.data?.success) {
        setComments((items) => items.filter((comment) => comment.id !== selected.id))
        setTotal((value) => Math.max(value - 1, 0))
        setSelected(null)
        alert.showTopRightAlert('评论已删除', 'success', '操作成功')
      }
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="wall-overview p-6 md:p-8">
        <div className="wall-overview-copy space-y-2">
          <span className="page-kicker">
            <i className="bi bi-chat-left-text-fill text-[var(--primary-color)]" />
            <span>My comments</span>
          </span>
          <h1 className="text-3xl font-black text-[var(--text-primary)]">我的评论</h1>
          <p className="max-w-xl text-sm leading-relaxed text-[var(--text-secondary)]">
            汇总当前账号在不同留言下发表的评论与回复，匿名身份不会因此在公开页面暴露。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="wall-stat-card min-w-28"><b>{total}</b><span>评论总数</span></div>
          <Link className="btn btn-outline" to="/me">
            <i className="bi bi-person" />
            <span>返回个人中心</span>
          </Link>
        </div>
      </section>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((item) => <div className="card p-6 space-y-3" key={item}><div className="skeleton h-5 w-36" /><div className="skeleton h-16 w-full" /></div>)}
        </div>
      ) : null}

      {!loading && comments.length === 0 ? (
        <section className="empty-state-card">
          <i className="bi bi-chat-left-text" />
          <h2 className="mt-4 text-lg font-bold text-[var(--text-primary)]">还没有评论记录</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">参与一场友善讨论后，你的评论会汇总在这里。</p>
          <Link className="btn btn-primary mt-5" to="/wall"><i className="bi bi-chat-dots" /><span>去校园墙看看</span></Link>
        </section>
      ) : null}

      <div className="space-y-4">
        {comments.map((comment) => {
          const files = Array.isArray(comment.files) ? comment.files : []
          const destination = comment.message_hidden ? (comment.message_owned ? '/me/posts' : '') : `/wall/message/${comment.message_id}`
          return (
            <article className={`card my-comment-card ${comment.comment_hidden ? 'admin-message-hidden' : ''}`} key={`${comment.message_id}-${comment.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-color)] px-5 py-3 text-xs text-[var(--text-muted)]">
                <span className="flex items-center gap-2">
                  <i className="bi bi-clock" />
                  <span>{comment.timestamp ? dayjs(comment.timestamp).fromNow() : '未知时间'}</span>
                  {comment.refer_id ? <span className="badge"><i className="bi bi-reply-fill" />回复</span> : <span className="badge">评论</span>}
                  {comment.comment_hidden ? <span className="badge status-danger"><i className="bi bi-eye-slash" />已下架</span> : null}
                </span>
                <button className="comment-delete-button" type="button" title="删除这条评论" aria-label="删除这条评论" onClick={() => setSelected(comment)}>
                  <i className="bi bi-trash" />
                </button>
              </div>

              <div className="space-y-4 p-5">
                {comment.comment_hidden ? (
                  <div className="info-callout status-danger">
                    <i className="bi bi-eye-slash" />
                    <span>这条评论已被管理员下架：{comment.hidden_reason || '违反社区规范'}</span>
                  </div>
                ) : null}
                <div className={`comment-origin ${comment.message_hidden ? 'is-hidden' : ''}`}>
                  <i className={`bi ${comment.message_hidden ? 'bi-eye-slash' : 'bi-journal-text'}`} />
                  <div className="min-w-0 flex-1">
                    <b>{comment.message_hidden ? '原帖已下架' : '来自原帖'}</b>
                    <p>{comment.message_preview || (comment.message_owned ? '可前往“我的发布”查看下架原因' : '原帖当前无法公开访问')}</p>
                  </div>
                  {destination ? (
                    <Link className="btn btn-sm btn-outline shrink-0" to={destination}>
                      <span>{comment.message_hidden ? '我的发布' : '查看原帖'}</span>
                      <i className="bi bi-arrow-up-right" />
                    </Link>
                  ) : null}
                </div>

                {comment.refer_id ? (
                  <div className="comment-reference">
                    <i className="bi bi-reply-fill" />
                    <b>{comment.refer_floor ? `回复 #${comment.refer_floor} 楼` : '回复一条已删除的评论'}</b>
                    <span>{comment.refer || '评论内容已不可见'}</span>
                  </div>
                ) : null}

                {comment.text ? <p className="message-text text-sm leading-relaxed text-[var(--text-primary)]">{comment.text}</p> : null}

                {files.length ? (
                  <div className="flex flex-wrap gap-2">
                    {files.map((file, index) => (
                      <button className="comment-file-chip" type="button" key={`${file}-${index}`} onClick={() => openPreview(files, index)}>
                        <i className={`bi ${attachmentIcon(file)}`} />
                        <span>{file}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>

      {page < totalPages ? (
        <div className="text-center">
          <button className="btn btn-outline min-w-44" type="button" disabled={loadingMore} onClick={() => loadComments(page + 1, true)}>
            <i className="bi bi-plus-circle" />
            <span>{loadingMore ? '加载中...' : '加载更多评论'}</span>
          </button>
        </div>
      ) : null}

      <FilePreviewModal files={previewFiles} index={previewIndex} visible={previewOpen} onClose={() => setPreviewOpen(false)} onIndexChange={setPreviewIndex} />
      <Modal
        visible={Boolean(selected)}
        title="删除我的评论"
        onClose={() => !deleting && setSelected(null)}
        footer={(
          <>
            <button className="btn btn-outline" type="button" disabled={deleting} onClick={() => setSelected(null)}>取消</button>
            <button className="btn bg-rose-600 text-white hover:bg-rose-700" type="button" disabled={deleting} onClick={deleteComment}>
              <i className="bi bi-trash" />
              <span>{deleting ? '删除中...' : '确认删除'}</span>
            </button>
          </>
        )}
      >
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">删除后评论会立即从公开页面和你的评论列表中移除，由管理员在回收站中统一保留或清理。</p>
      </Modal>
    </div>
  )
}
