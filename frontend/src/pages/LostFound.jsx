import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import MessageCard from '../components/MessageCard.jsx'
import { useAlert } from '../contexts/AlertContext.jsx'
import { usePlatform } from '../contexts/PlatformContext.jsx'
import api from '../services/api'

const filters = [
  { value: 'all', label: '全部', tag: '失物招领' },
  { value: 'lost', label: '寻物启事', tag: '寻物启事' },
  { value: 'found', label: '招领启事', tag: '招领启事' },
  { value: 'resolved', label: '已找回', tag: '已找回' }
]

const initialForm = {
  kind: 'lost',
  item: '',
  location: '',
  time: '',
  details: '',
  contact: '',
  resolved: false
}

const messageTags = (message) => {
  if (Array.isArray(message?.tags)) {
    return message.tags.map((tag) => typeof tag === 'string' ? tag : (tag?.tag || tag?.name || '')).filter(Boolean)
  }
  return String(message?.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean)
}

export default function LostFound() {
  const [activeFilter, setActiveFilter] = useState('all')
  const [messages, setMessages] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(initialForm)
  const [submitting, setSubmitting] = useState(false)
  const loadSequence = useRef(0)
  const alert = useAlert()
  const { community } = usePlatform()
  const canPublish = community.posting_enabled
  const disabledReason = community.pause_reason || '管理员暂时关闭了发帖功能'
  const selectedFilter = useMemo(
    () => filters.find((filter) => filter.value === activeFilter) || filters[0],
    [activeFilter]
  )

  const loadMessages = useCallback(async () => {
    const sequence = ++loadSequence.current
    setLoading(true)
    try {
      const response = await api.userGetLostFound({
        filter: selectedFilter.value,
        tag: selectedFilter.tag,
        page,
        page_size: 24
      })
      if (sequence === loadSequence.current) {
        const nextTotalPages = Math.max(1, Number(response.data?.total_pages) || 1)
        if (page > nextTotalPages) {
          setPage(nextTotalPages)
          return
        }
        setMessages(response.data?.messages || response.data?.data || [])
        setTotalPages(nextTotalPages)
      }
    } catch (error) {
      if (sequence === loadSequence.current) alert.showTopRightAlert(error.message, 'warning', '失物信息加载失败')
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [alert, page, selectedFilter.tag, selectedFilter.value])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!canPublish) {
      alert.showTopRightAlert(disabledReason, 'warning', '暂时无法发布')
      return
    }
    if (!form.item.trim() || !form.location.trim()) {
      alert.showTopRightAlert('请填写物品名称和相关地点', 'warning', '信息还不完整')
      return
    }

    const subtype = form.kind === 'lost' ? '寻物启事' : '招领启事'
    const status = form.resolved ? '已找回' : (form.kind === 'lost' ? '待找回' : '待认领')
    const lines = [
      `【${subtype}】`,
      `物品：${form.item.trim()}`,
      `地点：${form.location.trim()}`,
      form.time.trim() ? `时间：${form.time.trim()}` : '',
      form.details.trim() ? `特征与说明：${form.details.trim()}` : '',
      `联系：${form.contact.trim() || '请在评论区留言'}`,
      `状态：${status}`
    ].filter(Boolean)

    setSubmitting(true)
    try {
      const response = await api.userSubmitLostFound({
        kind: form.kind,
        item: form.item.trim(),
        location: form.location.trim(),
        time: form.time.trim(),
        details: form.details.trim(),
        contact: form.contact.trim(),
        resolved: form.resolved,
        text: lines.join('\n'),
        tags: ['失物招领', subtype, status]
      })
      const pendingReview = response.data?.moderation_status === 'pending'
      alert.showTopRightAlert(
        pendingReview ? '启事已提交审核，请稍后回来查看' : '启事已发布到失物招领专区',
        'success',
        pendingReview ? '等待审核' : '发布成功'
      )
      setForm((current) => ({ ...initialForm, kind: current.kind }))
      if (activeFilter === 'all' && page === 1) await loadMessages()
      else {
        setActiveFilter('all')
        setPage(1)
      }
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '发布失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="lost-found-page space-y-6">
      <section className="lost-found-hero">
        <div>
          <span className="page-kicker"><i className="bi bi-search" />Campus Lost &amp; Found</span>
          <h1>失物招领</h1>
        </div>
        <a className="btn btn-primary" href="#lost-found-publish"><i className="bi bi-pencil-square" />发布启事</a>
      </section>

      <div className="lost-found-compose-grid">
        <form id="lost-found-publish" className="card lost-found-form" onSubmit={submit}>
          <div className="section-heading">
            <span className="badge"><i className="bi bi-chat-square-text" />快速发布</span>
            <h2>发生了什么？</h2>
            <p>失物招领仅向登录用户开放；账号用于发布和持续管理启事，公开联系方式可以留空。</p>
          </div>

          {!canPublish ? <div className="info-callout status-warning"><i className="bi bi-info-circle-fill" /><span>{disabledReason}</span></div> : null}

          <fieldset className="lost-found-kind" disabled={!canPublish || submitting}>
            <legend className="sr-only">启事类型</legend>
            <label className={form.kind === 'lost' ? 'is-selected' : ''}>
              <input type="radio" name="lost-found-kind" value="lost" checked={form.kind === 'lost'} onChange={() => updateForm('kind', 'lost')} />
              <i className="bi bi-search" /><span><b>我丢了物品</b></span>
            </label>
            <label className={form.kind === 'found' ? 'is-selected' : ''}>
              <input type="radio" name="lost-found-kind" value="found" checked={form.kind === 'found'} onChange={() => updateForm('kind', 'found')} />
              <i className="bi bi-inbox" /><span><b>我捡到物品</b></span>
            </label>
          </fieldset>

          <div className="lost-found-fields">
            <label><span>物品名称 *</span><input className="field" maxLength={60} required disabled={!canPublish || submitting} value={form.item} onChange={(event) => updateForm('item', event.target.value)} placeholder="例如：蓝色水杯" /></label>
            <label><span>相关地点 *</span><input className="field" maxLength={80} required disabled={!canPublish || submitting} value={form.location} onChange={(event) => updateForm('location', event.target.value)} placeholder="例如：教学楼二楼连廊" /></label>
            <label><span>大致时间</span><input className="field" maxLength={60} disabled={!canPublish || submitting} value={form.time} onChange={(event) => updateForm('time', event.target.value)} placeholder="例如：周二午休前后" /></label>
            <label><span>公开联系方式</span><input className="field" maxLength={80} disabled={!canPublish || submitting} value={form.contact} onChange={(event) => updateForm('contact', event.target.value)} placeholder="可留空，改用评论区沟通" /></label>
            <label className="lost-found-details"><span>特征与说明</span><textarea className="field" maxLength={500} disabled={!canPublish || submitting} value={form.details} onChange={(event) => updateForm('details', event.target.value)} placeholder="描述颜色、型号或不宜公开的核验线索提示；请勿填写身份证号等敏感信息。" /></label>
          </div>

          <label className="lost-found-resolved">
            <input type="checkbox" checked={form.resolved} disabled={!canPublish || submitting} onChange={(event) => updateForm('resolved', event.target.checked)} />
            <span><b>这是“已找回”状态更新</b><small>勾选后启事会进入已找回筛选，提醒大家停止扩散。</small></span>
          </label>

          <div className="lost-found-form-footer">
            <p><i className="bi bi-shield-check" />请保留一项未公开特征，用于领取时核验。</p>
            <button className="btn btn-primary" type="submit" disabled={!canPublish || submitting || !form.item.trim() || !form.location.trim()}>
              <i className="bi bi-send-fill" />{submitting ? '提交中…' : '提交启事'}
            </button>
          </div>
        </form>

        <aside className="card lost-found-guide" aria-labelledby="lost-found-guide-title">
          <span className="badge"><i className="bi bi-lightning-charge" />处理指南</span>
          <h2 id="lost-found-guide-title">让线索更快闭环</h2>
          <ol>
            <li><span>1</span><div><b>写清时间地点</b><p>描述能帮助同学判断是否相关。</p></div></li>
            <li><span>2</span><div><b>领取前先核验</b><p>请对方说出未公开的物品特征。</p></div></li>
            <li><span>3</span><div><b>找回后更新状态</b><p>可发布带 #已找回 的简短更新，提醒大家停止扩散。</p></div></li>
          </ol>
          <Link className="btn btn-outline" to="/rules"><i className="bi bi-shield-check" />查看社区公约</Link>
        </aside>
      </div>

      <section className="lost-found-feed" aria-labelledby="lost-found-feed-title">
        <div className="lost-found-feed-heading">
          <div>
            <span className="badge"><i className="bi bi-inbox" />最新线索</span>
            <h2 id="lost-found-feed-title">校内启事</h2>
          </div>
          <div className="lost-found-filters" role="tablist" aria-label="失物招领筛选">
            {filters.map((filter) => (
              <button className={`btn btn-sm ${activeFilter === filter.value ? 'btn-primary' : 'btn-outline'}`} type="button" role="tab" aria-selected={activeFilter === filter.value} key={filter.value} onClick={() => { setActiveFilter(filter.value); setPage(1) }}>{filter.label}</button>
            ))}
          </div>
        </div>

        {loading ? <div className="page-center"><div className="spinner" /><p className="text-sm text-muted">正在寻找最新线索…</p></div> : null}
        {!loading && !messages.length ? (
          <div className="empty-state-card">
            <i className="bi bi-inbox" />
            <h3>暂时没有{selectedFilter.label === '全部' ? '' : selectedFilter.label}</h3>
            <p>如果你有相关信息，可以在上方发布第一条启事。</p>
          </div>
        ) : null}
        <div className="lost-found-message-list">
          {messages.map((message) => {
            const tags = messageTags(message)
            const kind = message.lost_found?.kind || (tags.includes('招领启事') ? 'found' : 'lost')
            const status = message.lost_found?.resolved || tags.includes('已找回') ? '已找回' : (kind === 'found' ? '待认领' : '寻找中')
            return (
              <div className="lost-found-message" key={message.id}>
                <div className="lost-found-message-status">
                  <span className={`badge ${status === '已找回' ? 'status-success' : 'status-warning'}`}>{status}</span>
                  <span>{kind === 'found' ? '招领启事' : '寻物启事'}</span>
                  {message.lost_found?.contact ? <span><i className="bi bi-chat-dots mr-1" />联系：{message.lost_found.contact}</span> : null}
                </div>
                <MessageCard message={message} onRefresh={loadMessages} />
              </div>
            )
          })}
        </div>
        {totalPages > 1 ? (
          <nav className="mt-5 flex items-center justify-center gap-3" aria-label="失物招领分页">
            <button className="btn btn-sm btn-outline" type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
            <span className="text-sm text-muted">第 {page} / {totalPages} 页</span>
            <button className="btn btn-sm btn-outline" type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button>
          </nav>
        ) : null}
      </section>
    </div>
  )
}
