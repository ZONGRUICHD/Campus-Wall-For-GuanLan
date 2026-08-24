import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api from '../services/api'

const statusMeta = {
  pending: { label: '待处理', icon: 'bi-hourglass-split', className: 'status-warning' },
  in_progress: { label: '处理中', icon: 'bi-arrow-repeat', className: '' },
  resolved: { label: '已解决', icon: 'bi-check2-circle', className: 'status-success' },
  closed: { label: '已关闭', icon: 'bi-archive', className: '' },
  processed: { label: '已处理', icon: 'bi-shield-check', className: 'status-success' }
}

const normalizeTicketId = (value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '')
const formatTicketId = (value) => normalizeTicketId(value).match(/.{1,8}/g)?.join('-') || ''

export default function HelpStatus() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialMode = searchParams.get('type') === 'report' ? 'report' : 'feedback'
  const [mode, setMode] = useState(initialMode)
  const [ticketId, setTicketId] = useState(searchParams.get(initialMode === 'report' ? 'report' : 'ticket') || '')
  const [record, setRecord] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const initialLookup = useRef(false)

  const lookup = async (rawValue = ticketId, updateUrl = true, lookupMode = mode) => {
    const normalized = normalizeTicketId(rawValue)
    setError('')
    setRecord(null)
    if (!/^[a-f0-9]{32}$/.test(normalized)) {
      setError('追踪码格式不正确，请检查后重新输入')
      return
    }
    setLoading(true)
    try {
      const response = lookupMode === 'report'
        ? await api.getReportStatus(normalized)
        : await api.getHelpStatus(normalized)
      setRecord(lookupMode === 'report' ? response.data?.report : response.data?.ticket)
      setTicketId(formatTicketId(normalized))
      if (updateUrl) {
        const key = lookupMode === 'report' ? 'report' : 'ticket'
        setSearchParams({ type: lookupMode, [key]: normalized }, { replace: true })
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const key = initialMode === 'report' ? 'report' : 'ticket'
    const initial = searchParams.get(key)
    if (!initial || initialLookup.current) return
    initialLookup.current = true
    lookup(initial, false, initialMode)
  }, [])

  const switchMode = (nextMode) => {
    if (nextMode === mode) return
    setMode(nextMode)
    setTicketId('')
    setRecord(null)
    setError('')
    setSearchParams({ type: nextMode }, { replace: true })
  }

  const meta = statusMeta[record?.status] || statusMeta.pending
  const isReport = mode === 'report'
  const pendingReply = isReport
    ? '举报已进入核查队列，请耐心等待管理员处理。'
    : '工单已进入队列，请耐心等待管理员处理。'
  const resultText = record?.public_reply || record?.resolution_label || pendingReply

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link className="btn btn-sm btn-outline" to="/help"><i className="bi bi-arrow-left" />返回帮助中心</Link>
      </div>

      <section className="hero-section px-8 py-10 text-center">
        <div className="hero-content space-y-2">
          <span className="page-kicker hero-kicker"><i className="bi bi-life-preserver" />Tracking Center</span>
          <h1 className="text-2xl font-black text-white md:text-3xl">查询处理进度</h1>
          <p className="hero-subtitle mx-auto max-w-md text-sm">使用提交成功后获得的追踪码，查看反馈工单或内容举报的最新状态。</p>
        </div>
      </section>

      <section className="card p-5">
        <div className="mb-4 inline-flex rounded-xl border border-[var(--border-color)] bg-[var(--card-secondary-bg)] p-1" role="tablist" aria-label="追踪类型">
          <button className={`btn btn-sm ${!isReport ? 'btn-primary' : 'btn-ghost'}`} type="button" role="tab" aria-selected={!isReport} onClick={() => switchMode('feedback')}>
            <i className="bi bi-chat-left-heart-fill" />反馈工单
          </button>
          <button className={`btn btn-sm ${isReport ? 'btn-primary' : 'btn-ghost'}`} type="button" role="tab" aria-selected={isReport} onClick={() => switchMode('report')}>
            <i className="bi bi-shield-exclamation" />内容举报
          </button>
        </div>
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); lookup() }}>
          <input
            className="field min-w-0 flex-1 font-mono"
            value={ticketId}
            onChange={(event) => setTicketId(event.target.value)}
            placeholder="例如：12345678-12345678-12345678-12345678"
            aria-label={`${isReport ? '举报' : '反馈'}追踪码`}
            autoComplete="off"
            maxLength={40}
          />
          <button className="btn btn-primary justify-center" type="submit" disabled={loading}>
            <i className={`bi ${loading ? 'bi-arrow-repeat admin-spin' : 'bi-search'}`} />{loading ? '查询中...' : '查询进度'}
          </button>
        </form>
      </section>

      {error ? <div className="info-callout status-danger"><i className="bi bi-exclamation-circle mr-2" />{error}</div> : null}

      {record ? (
        <article className="card overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-color)] px-5 py-4">
            <div>
              <p className="text-xs text-muted">{isReport ? '举报' : '反馈'}追踪码</p>
              <code className="text-sm font-bold text-[var(--primary-color)]">{formatTicketId(record.id)}</code>
            </div>
            <span className={`badge ${meta.className}`}><i className={`bi ${meta.icon} mr-1`} />{record.status_label || meta.label}</span>
          </header>
          <div className="space-y-5 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><p className="text-xs font-bold text-muted">{isReport ? '举报分类' : '反馈分类'}</p><p className="mt-1">{record.category_label || record.category || '其他'}</p></div>
              <div><p className="text-xs font-bold text-muted">提交时间</p><p className="mt-1">{record.timestamp || '-'}</p></div>
              {isReport ? <div><p className="text-xs font-bold text-muted">举报对象</p><p className="mt-1">{record.target_type_label || '内容'} · 留言 #{record.message_id}</p></div> : null}
              {isReport && record.processed_at ? <div><p className="text-xs font-bold text-muted">处理时间</p><p className="mt-1">{record.processed_at}</p></div> : null}
            </div>
            {!isReport && record.title ? <div><p className="text-xs font-bold text-muted">反馈主题</p><p className="mt-1 font-semibold">{record.title}</p></div> : null}
            <div className="border-t border-[var(--border-color)] pt-4">
              <p className="text-xs font-bold text-muted">{isReport ? '处理结果' : '管理员回复'}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{resultText}</p>
              {!isReport && record.updated_at ? <p className="mt-2 text-xs text-muted">最后更新：{record.updated_at}</p> : null}
            </div>
          </div>
        </article>
      ) : null}
    </div>
  )
}
