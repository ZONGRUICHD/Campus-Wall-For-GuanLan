import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useAlert } from '../contexts/AlertContext.jsx'

export default function HelpForm() {
  const [form, setForm] = useState({ category: 'bug', title: '', email: '', text: '' })
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const alert = useAlert()

  const submit = async (event) => {
    event.preventDefault()
    if (!form.text.trim()) {
      alert.showTopRightAlert('请填写详细反馈内容', 'warning', '提示')
      return
    }
    setLoading(true)
    try {
      const response = await api.submitHelp(form)
      const ticketId = response.data?.ticket_id || ''
      navigate(ticketId ? `/help/success?ticket=${encodeURIComponent(ticketId)}` : '/help/success')
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '提交失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/help" className="btn btn-sm btn-outline">
          <i className="bi bi-arrow-left" />
          <span>返回帮助中心</span>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <section className="auth-hero flex flex-col justify-center p-8 space-y-4">
          <span className="page-kicker text-xs">
            <i className="bi bi-chat-heart-fill" />
            <span>Feedback</span>
          </span>
          <h1 className="text-2xl md:text-3xl font-black text-[var(--text-primary)]">提交反馈</h1>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            感谢你对校园墙的支持。你的每一个反馈都会认真审阅，并在后续版本中持续改进。
          </p>
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-solid-bg)] p-4 text-xs text-[var(--text-muted)] space-y-1.5">
            <div className="font-bold text-[var(--text-primary)]">填写建议：</div>
            <p>1. 简要说明遇到的问题或需求</p>
            <p>2. 如有具体操作步骤可详细列出</p>
            <p>3. 留下邮箱方便管理员需要时联系你</p>
          </div>
        </section>

        <form className="card p-6 md:p-8 space-y-5" onSubmit={submit}>
          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-[var(--text-secondary)]">反馈分类</span>
            <select className="field w-full" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              <option value="bug">网站故障</option>
              <option value="feature">功能建议</option>
              <option value="account">账号问题</option>
              <option value="content">内容与社区</option>
              <option value="other">其他反馈</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-[var(--text-secondary)]">反馈主题</span>
            <input
              className="field w-full"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="例如：建议增加某某功能 / 页面加载异常"
              maxLength={200}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-[var(--text-secondary)]">联系邮箱 (选填)</span>
            <input
              className="field w-full"
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              placeholder="需要进一步沟通时，管理员可通过邮箱联系你"
              maxLength={320}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-[var(--text-secondary)]">反馈详细说明 *</span>
            <textarea
              className="field min-h-36 w-full text-sm"
              value={form.text}
              onChange={(event) => setForm({ ...form, text: event.target.value })}
              placeholder="请尽可能详细地描述你遇到的情况或改进建议..."
              maxLength={10000}
            />
            <span className="block text-right text-xs text-muted">{form.text.length}/10000</span>
          </label>

          <div className="pt-2">
            <button className="btn btn-primary px-8 shadow-md" disabled={loading} type="submit">
              <i className="bi bi-send-fill" />
              <span>{loading ? '正在提交...' : '确认提交反馈'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
