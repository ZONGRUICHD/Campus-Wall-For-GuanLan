import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

const formatTicketId = (value) => String(value || '').match(/.{1,8}/g)?.join('-') || ''

export default function HelpSuccess() {
  const [searchParams] = useSearchParams()
  const [copied, setCopied] = useState(false)
  const ticketId = String(searchParams.get('ticket') || '').replace(/[\s-]+/g, '').toLowerCase()
  const reportId = String(searchParams.get('report') || '').replace(/[\s-]+/g, '').toLowerCase()
  const isReport = searchParams.get('type') === 'report' || Boolean(reportId)
  const trackingId = isReport ? reportId : ticketId
  const itemName = isReport ? '举报' : '反馈'

  const copyTicketId = async () => {
    if (!trackingId) return
    try {
      await navigator.clipboard.writeText(trackingId)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="page-center text-center py-12">
      <section className="card max-w-lg mx-auto p-8 md:p-10 space-y-6 shadow-xl relative overflow-hidden">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 text-4xl mx-auto shadow-inner">
          <i className="bi bi-check-circle-fill" />
        </div>

        <div className="space-y-2">
          <span className="page-kicker text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full">
            <i className="bi bi-check2-all mr-1" />
            <span>已成功录入系统</span>
          </span>
          <h1 className="text-2xl md:text-3xl font-black text-[var(--text-primary)]">
            {itemName}提交成功
          </h1>
          <p className="text-xs md:text-sm text-[var(--text-secondary)] max-w-sm mx-auto leading-relaxed">
            {isReport
              ? '举报已进入核查队列。管理员处理后，你可以使用追踪码查看处理结果。'
              : '非常感谢你的反馈与配合！相关请求已进入处理队列，管理员将会在第一时间审阅与处理。'}
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 text-xs text-[var(--text-muted)] bg-[var(--card-secondary-bg)] py-2.5 px-4 rounded-xl border border-[var(--border-color)]">
          <i className="bi bi-clock-history text-amber-500" />
          <span>通常在 1-2 个工作日内核实完毕</span>
        </div>

        {trackingId ? (
          <div className="border-y border-[var(--border-color)] py-4">
            <p className="text-xs font-bold text-muted">{itemName}追踪码</p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <code className="select-all text-sm font-bold text-[var(--primary-color)]">{formatTicketId(trackingId)}</code>
              <button className="btn btn-sm btn-outline" type="button" onClick={copyTicketId} aria-label={`复制${itemName}追踪码`}>
                <i className={`bi ${copied ? 'bi-check2' : 'bi-copy'}`} />{copied ? '已复制' : '复制'}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">请妥善保存，可用于查询管理员处理进度。</p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          {trackingId ? (
            <Link className="btn btn-primary px-6" to={`/help/status?type=${isReport ? 'report' : 'feedback'}&${isReport ? 'report' : 'ticket'}=${encodeURIComponent(trackingId)}`}>
              <i className="bi bi-search" />
              <span>查询处理进度</span>
            </Link>
          ) : null}
          <Link className="btn btn-primary px-6" to="/">
            <i className="bi bi-house-door" />
            <span>返回首页</span>
          </Link>
          <Link className="btn btn-outline px-6" to="/wall">
            <i className="bi bi-chat-square-heart" />
            <span>逛逛校园墙</span>
          </Link>
        </div>
      </section>
    </div>
  )
}
