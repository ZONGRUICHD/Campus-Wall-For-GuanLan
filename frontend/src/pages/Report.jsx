import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import api from '../services/api'
import { useAlert } from '../contexts/AlertContext.jsx'

export default function Report() {
  const { id, commentId } = useParams()
  const [message, setMessage] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState({ category: 'abuse', email: '', text: '' })
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const alert = useAlert()

  useEffect(() => {
    setLoaded(false)
    api.getMessageDetail(id).then((response) => {
      if (response.data?.success) setMessage(response.data.message)
    }).catch(() => {
      setMessage(null)
    }).finally(() => setLoaded(true))
  }, [id])

  const targetComment = commentId
    ? (message?.comments || []).find((comment) => String(comment.id) === String(commentId))
    : null
  const targetMissing = loaded && (!message || (commentId && !targetComment))
  const targetTypeText = commentId ? '评论' : '留言'
  const targetExcerpt = commentId
    ? String(targetComment?.text || ((targetComment?.files || []).length ? '附件评论' : ''))
    : String(message?.text || ((message?.files || []).length ? '附件留言' : ''))

  const submit = async (event) => {
    event.preventDefault()
    if (!form.text.trim()) {
      alert.showTopRightAlert('请填写详细举报理由', 'warning', '提示')
      return
    }
    if (targetMissing) {
      alert.showTopRightAlert(`被举报${targetTypeText}已不存在`, 'warning', '无法提交')
      return
    }
    setSubmitting(true)
    try {
      const response = commentId
        ? await api.submitCommentReport(id, commentId, form)
        : await api.submitReport(id, form)
      const reportId = response.data?.report_id
      navigate(reportId ? `/help/success?type=report&report=${encodeURIComponent(reportId)}` : '/help/success?type=report')
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '举报提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Link to={`/wall/message/${id}`} className="btn btn-sm btn-outline">
          <i className="bi bi-arrow-left" />
          <span>返回留言详情</span>
        </Link>
      </div>

      <div className="hero-section hero-section-compact text-center">
        <div className="hero-content space-y-2">
          <span className="page-kicker hero-kicker">
            <i className="bi bi-shield-fill-exclamation text-rose-300" />
            <span>Community Report</span>
          </span>
          <h1>举报违规{targetTypeText} #{id}</h1>
          <p className="hero-subtitle max-w-md mx-auto">
            共同守护健康友善的校园交流社区。我们将严格保密举报人信息并及时核实处理。
          </p>
        </div>
      </div>

      {loaded && targetMissing ? (
        <div className="status-warning rounded-2xl p-5 text-sm">
          <i className="bi bi-exclamation-triangle mr-2" />
          被举报{targetTypeText}已删除或暂时不可访问，无法继续提交举报。
        </div>
      ) : null}

      {!targetMissing && (message || targetComment) ? (
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-secondary-bg)] p-5 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-secondary)]">
            <i className="bi bi-quote text-[var(--primary-color)] text-lg" />
            <span>被举报的{targetTypeText}内容原样摘要：</span>
          </div>
          <p className="text-xs text-[var(--text-primary)] leading-relaxed pl-6 border-l-2 border-[var(--primary-color)]">
            {targetExcerpt || '该内容仅包含附件'}
          </p>
        </div>
      ) : null}

      <form className="card p-6 md:p-8 space-y-5" onSubmit={submit}>
        <label className="block space-y-1.5">
          <span className="text-xs font-bold text-[var(--text-secondary)]">违规分类</span>
          <select
            className="field w-full"
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
          >
            <option value="abuse">辱骂攻击 / 恶意人肉 / 骚扰</option>
            <option value="spam">广告推销 / 刷屏刷榜</option>
            <option value="porn">色情低俗 / 违法违禁信息</option>
            <option value="rumor">虚假造谣 / 不实传闻</option>
            <option value="other">其它违规情况</option>
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-bold text-[var(--text-secondary)]">联系邮箱 (选填)</span>
          <input
            className="field w-full"
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            placeholder="填写你的邮箱以便获取处理进度反馈"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-bold text-[var(--text-secondary)]">举报详细说明 *</span>
          <textarea
            className="field min-h-36 w-full text-sm"
            value={form.text}
            onChange={(event) => setForm({ ...form, text: event.target.value })}
            placeholder="请详细描述具体的违规事实或理由..."
            maxLength={1000}
          />
        </label>

        <div className="pt-2">
          <button className="btn btn-primary px-8" type="submit" disabled={submitting || targetMissing}>
            <i className="bi bi-shield-fill-check" />
            <span>{submitting ? '正在提交...' : '确认提交举报'}</span>
          </button>
        </div>
      </form>
    </div>
  )
}
