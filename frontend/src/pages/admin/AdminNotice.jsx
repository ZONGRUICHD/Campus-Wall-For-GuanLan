import { useEffect, useMemo, useRef, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import Modal from '../../components/Modal.jsx'
import NoticeCard from '../../components/NoticeCard.jsx'
import api from '../../services/api'
import { useAlert } from '../../contexts/AlertContext.jsx'
import { useUser } from '../../contexts/UserContext.jsx'

const defaultLimits = Object.freeze({ title: 80, summary: 200, content: 10000 })
const emptyForm = Object.freeze({
  title: '',
  summary: '',
  content: '',
  priority: 'normal',
  scheduleMode: 'now',
  publishAt: '',
  remindOnUpdate: false
})

const priorityOptions = Object.freeze([
  { value: 'normal', label: '普通', detail: '仅在首页展示', icon: 'bi-megaphone' },
  { value: 'important', label: '重要', detail: '首次发布时自动提醒', icon: 'bi-exclamation-circle-fill' },
  { value: 'urgent', label: '紧急', detail: '用于需要立即关注的信息', icon: 'bi-exclamation-triangle-fill' }
])

const statusLabels = Object.freeze({
  all: '全部',
  published: '已发布',
  scheduled: '定时中',
  draft: '草稿',
  archived: '已归档'
})

const noticeId = (notice) => notice.id || String(notice._index)
const noticeDateTime = (value) => value ? String(value).replace(' ', 'T') : undefined
const parsedTime = (value) => Date.parse(String(value || ''))
const isFutureTime = (value) => Number.isFinite(parsedTime(value)) && parsedTime(value) > Date.now()
const noticeBucket = (notice) => notice.status === 'published' && isFutureTime(notice.publish_at)
  ? 'scheduled'
  : (notice.status || 'published')

const toDateTimeLocal = (value) => {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

const scheduledDefault = () => {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0)
  return toDateTimeLocal(date)
}

const payloadForNotice = (notice, overrides = {}) => ({
  title: notice.title || '',
  summary: notice.summary || '',
  content: notice.content || '',
  priority: notice.priority || 'normal',
  status: notice.status || 'published',
  publish_at: notice.publish_at || notice.timestamp || '',
  ...overrides
})

export default function AdminNotice() {
  const [notices, setNotices] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingNotice, setEditingNotice] = useState(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [workingId, setWorkingId] = useState('')
  const [archiveTarget, setArchiveTarget] = useState(null)
  const [filter, setFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [limits, setLimits] = useState(defaultLimits)
  const composerRef = useRef(null)
  const alert = useAlert()
  const { hasCapability } = useUser()
  const canCreate = hasCapability('notice.create')
  const canUpdate = hasCapability('notice.update')
  const canDelete = hasCapability('notice.delete')
  const canUseComposer = editingNotice ? canUpdate : canCreate

  const load = async () => {
    setLoading(true)
    try {
      const response = await api.adminGetNotice()
      const items = Array.isArray(response.data?.content) ? response.data.content : []
      const contentLimit = Number(response.data?.max_length)
      setLimits({
        title: Number(response.data?.limits?.title) || defaultLimits.title,
        summary: Number(response.data?.limits?.summary) || defaultLimits.summary,
        content: Number.isSafeInteger(contentLimit) && contentLimit > 0 ? contentLimit : defaultLimits.content
      })
      setNotices(items.map((notice, index) => ({ ...notice, _index: index })))
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '加载公告失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }))

  const resetComposer = () => {
    setEditingNotice(null)
    setForm(emptyForm)
  }

  const startEdit = (notice) => {
    if (!canUpdate) return
    const scheduled = isFutureTime(notice.publish_at)
    setEditingNotice(notice)
    setForm({
      title: notice.title || '',
      summary: notice.summary || '',
      content: notice.content || '',
      priority: notice.priority || 'normal',
      scheduleMode: scheduled ? 'scheduled' : 'now',
      publishAt: scheduled ? toDateTimeLocal(notice.publish_at) : '',
      remindOnUpdate: false
    })
    window.requestAnimationFrame(() => composerRef.current?.scrollIntoView({ block: 'start' }))
  }

  const submit = async (status) => {
    if ((editingNotice && !canUpdate) || (!editingNotice && !canCreate)) return
    if (!form.title.trim() || !form.content.trim()) return
    if (status === 'published' && form.scheduleMode === 'scheduled' && !form.publishAt) {
      alert.showTopRightAlert('请选择计划发布时间', 'warning', '无法保存')
      return
    }
    if (status === 'published' && form.scheduleMode === 'scheduled'
      && (!Number.isFinite(parsedTime(form.publishAt)) || parsedTime(form.publishAt) <= Date.now())) {
      alert.showTopRightAlert('计划发布时间需要晚于当前时间', 'warning', '无法保存')
      return
    }
    const publishAt = status === 'published'
      ? (form.scheduleMode === 'scheduled' ? new Date(form.publishAt).toISOString() : new Date().toISOString())
      : (form.scheduleMode === 'scheduled' && form.publishAt ? new Date(form.publishAt).toISOString() : (editingNotice?.publish_at || ''))
    const data = {
      title: form.title.trim(),
      summary: form.summary.trim(),
      content: form.content.trim(),
      priority: form.priority,
      status,
      publish_at: publishAt,
      remind_on_update: form.remindOnUpdate
    }
    setSubmitting(true)
    try {
      const response = editingNotice
        ? await api.adminUpdateNotice(noticeId(editingNotice), data)
        : await api.adminPostNotice(data)
      if (!response.data?.success) throw new Error(response.data?.error || '公告保存失败')
      const action = status === 'draft' ? '草稿已保存' : (form.scheduleMode === 'scheduled' ? '公告已安排定时发布' : '公告已发布')
      alert.showTopRightAlert(action, 'success', '成功')
      resetComposer()
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const archive = async () => {
    if (!canDelete || !archiveTarget) return
    const id = noticeId(archiveTarget)
    setWorkingId(id)
    try {
      const response = await api.adminDeleteNotice(id)
      if (!response.data?.success) throw new Error(response.data?.error || '公告归档失败')
      if (noticeId(editingNotice || {}) === id) resetComposer()
      setArchiveTarget(null)
      alert.showTopRightAlert('公告已归档，可随时恢复', 'success', '已归档')
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '归档失败')
    } finally {
      setWorkingId('')
    }
  }

  const restore = async (notice) => {
    if (!canUpdate) return
    const id = noticeId(notice)
    setWorkingId(id)
    try {
      const response = await api.adminUpdateNotice(id, payloadForNotice(notice, { status: 'published' }))
      if (!response.data?.success) throw new Error(response.data?.error || '公告恢复失败')
      alert.showTopRightAlert('公告已恢复', 'success', '成功')
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '恢复失败')
    } finally {
      setWorkingId('')
    }
  }

  const stats = useMemo(() => notices.reduce((result, notice) => {
    const bucket = noticeBucket(notice)
    result[bucket] = (result[bucket] || 0) + 1
    return result
  }, { published: 0, scheduled: 0, draft: 0, archived: 0 }), [notices])

  const visibleNotices = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase()
    return notices.filter((notice) => {
      if (filter !== 'all' && noticeBucket(notice) !== filter) return false
      if (priorityFilter !== 'all' && notice.priority !== priorityFilter) return false
      if (!keyword) return true
      return [notice.title, notice.summary, notice.content].some((value) => String(value || '').toLocaleLowerCase().includes(keyword))
    })
  }, [filter, notices, priorityFilter, query])

  const previewStatus = form.scheduleMode === 'scheduled'
    ? 'scheduled'
    : (editingNotice?.status || 'published')
  const preview = {
    title: form.title || '公告标题会显示在这里',
    summary: form.summary || '用一句简短摘要帮助大家快速理解公告。',
    content: form.content || '在左侧填写公告正文，预览会同步更新。',
    priority: form.priority,
    status: previewStatus,
    publish_at: form.scheduleMode === 'scheduled' && form.publishAt
      ? new Date(form.publishAt).toISOString()
      : new Date().toISOString()
  }

  return (
    <AdminShell title="公告管理">
      <div className="notice-admin-page space-y-5">
        <section className="notice-admin-stats" aria-label="公告状态概览">
          <div className="card-flat admin-stat-card"><b>{stats.published}</b><p className="text-muted">正在展示</p></div>
          <div className="card-flat admin-stat-card"><b>{stats.scheduled}</b><p className="text-muted">定时发布</p></div>
          <div className="card-flat admin-stat-card"><b>{stats.draft}</b><p className="text-muted">草稿</p></div>
          <div className="card-flat admin-stat-card"><b>{stats.archived}</b><p className="text-muted">已归档</p></div>
        </section>

        {canUseComposer ? (
        <section ref={composerRef} className="card notice-composer" aria-labelledby="notice-composer-title">
          <header className="notice-composer-header">
            <div>
              <span className="page-kicker"><i className="bi bi-megaphone" />公告工作台</span>
              <h2 id="notice-composer-title">{editingNotice ? '编辑公告' : '创建公告'}</h2>
              <p>{editingNotice ? '修改内容不会默认再次弹窗；需要重新提醒时请手动勾选。' : '先完善信息并预览，再保存草稿、立即发布或安排定时发布。'}</p>
            </div>
            {editingNotice ? <button className="btn btn-sm btn-outline" type="button" disabled={submitting} onClick={resetComposer}>取消编辑</button> : null}
          </header>

          <div className="notice-composer-layout">
            <div className="notice-form-column">
              <label className="notice-field-label" htmlFor="notice-title-input">
                <span>标题 <b>必填</b></span>
                <small>{form.title.length}/{limits.title}</small>
              </label>
              <input id="notice-title-input" className="field w-full" value={form.title} maxLength={limits.title} onChange={(event) => updateForm('title', event.target.value)} placeholder="例如：运动会期间校门开放时间调整" />

              <label className="notice-field-label" htmlFor="notice-summary-input">
                <span>摘要 <em>选填</em></span>
                <small>{form.summary.length}/{limits.summary}</small>
              </label>
              <textarea id="notice-summary-input" className="field w-full min-h-20" value={form.summary} maxLength={limits.summary} onChange={(event) => updateForm('summary', event.target.value)} placeholder="用一两句话说明重点，首页会优先展示摘要" />

              <label className="notice-field-label" htmlFor="notice-content-input">
                <span>正文 <b>必填</b></span>
                <small>{form.content.length}/{limits.content}</small>
              </label>
              <textarea id="notice-content-input" className="field w-full min-h-52" value={form.content} maxLength={limits.content} onChange={(event) => updateForm('content', event.target.value)} placeholder="输入公告正文，支持分段换行；内容将按纯文本安全展示" />

              <fieldset className="notice-option-group">
                <legend>优先级</legend>
                <div className="notice-priority-options">
                  {priorityOptions.map((option) => (
                    <label className={`notice-priority-option is-${option.value}${form.priority === option.value ? ' is-selected' : ''}`} key={option.value}>
                      <input type="radio" name="notice-priority" value={option.value} checked={form.priority === option.value} onChange={() => updateForm('priority', option.value)} />
                      <i className={`bi ${option.icon}`} aria-hidden="true" />
                      <span><b>{option.label}</b><small>{option.detail}</small></span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="notice-option-group">
                <legend>发布时间</legend>
                <div className="notice-schedule-options">
                  <label className={form.scheduleMode === 'now' ? 'is-selected' : ''}>
                    <input type="radio" name="notice-schedule" checked={form.scheduleMode === 'now'} onChange={() => updateForm('scheduleMode', 'now')} />
                    <span><i className="bi bi-lightning-charge-fill" />立即发布</span>
                  </label>
                  <label className={form.scheduleMode === 'scheduled' ? 'is-selected' : ''}>
                    <input type="radio" name="notice-schedule" checked={form.scheduleMode === 'scheduled'} onChange={() => setForm((current) => ({ ...current, scheduleMode: 'scheduled', publishAt: current.publishAt || scheduledDefault() }))} />
                    <span><i className="bi bi-clock" />定时发布</span>
                  </label>
                </div>
                {form.scheduleMode === 'scheduled' ? (
                  <label className="notice-schedule-time" htmlFor="notice-publish-at">
                    <span>计划发布时间</span>
                    <input id="notice-publish-at" className="field w-full" type="datetime-local" min={toDateTimeLocal(new Date())} value={form.publishAt} onChange={(event) => updateForm('publishAt', event.target.value)} />
                  </label>
                ) : null}
              </fieldset>

              {editingNotice && ['important', 'urgent'].includes(form.priority) ? (
                <label className="notice-reminder-option">
                  <input type="checkbox" checked={form.remindOnUpdate} onChange={(event) => updateForm('remindOnUpdate', event.target.checked)} />
                  <span><b>将这次更新作为新提醒</b><small>勾选后，未读用户会再次看到自动弹窗；默认不勾选。</small></span>
                </label>
              ) : null}

              <div className="notice-composer-actions">
                <button className="btn btn-outline" type="button" disabled={submitting || !form.title.trim() || !form.content.trim()} onClick={() => submit('draft')}>
                  <i className="bi bi-file-earmark" />{submitting ? '保存中...' : '保存草稿'}
                </button>
                <button className="btn btn-primary" type="button" disabled={submitting || !form.title.trim() || !form.content.trim()} onClick={() => submit('published')}>
                  <i className={`bi ${form.scheduleMode === 'scheduled' ? 'bi-clock-history' : 'bi-send'}`} />
                  {submitting ? '保存中...' : (form.scheduleMode === 'scheduled' ? '安排发布' : (editingNotice ? '保存并发布' : '立即发布'))}
                </button>
              </div>
            </div>

            <aside className="notice-preview-column" aria-label="公告预览">
              <div className="notice-preview-heading"><span>实时预览</span><small>首页与弹窗会使用相同信息层级</small></div>
              <NoticeCard notice={preview} showStatus />
            </aside>
          </div>
        </section>
        ) : (
          <section className="card notice-readonly-panel" aria-label="公告只读权限提示">
            <i className="bi bi-eye" aria-hidden="true" />
            <div>
              <b>{canUpdate ? '从历史记录选择一条公告开始编辑' : '当前为只读模式'}</b>
              <p>{canUpdate ? '你拥有编辑权限，但不能新建公告。' : '你可以查看和筛选公告历史，但没有创建或编辑公告的权限。'}</p>
            </div>
          </section>
        )}

        <section className="notice-history" aria-labelledby="notice-history-title">
          <div className="admin-toolbar notice-history-toolbar">
            <div className="mr-auto">
              <h2 id="notice-history-title" className="text-lg font-bold"><i className="bi bi-collection mr-2" />历史公告</h2>
              <p className="text-sm text-muted">共 {notices.length} 条，归档后不会公开展示但仍可恢复。</p>
            </div>
            <button className="btn btn-sm btn-outline" type="button" disabled={loading} onClick={load}><i className="bi bi-arrow-clockwise" />刷新</button>
          </div>

          <div className="notice-history-filters" role="search">
            <label><span className="sr-only">搜索公告</span><i className="bi bi-search" /><input className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、摘要或正文" /></label>
            <select className="field" aria-label="按状态筛选" value={filter} onChange={(event) => setFilter(event.target.value)}>
              {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
            <select className="field" aria-label="按优先级筛选" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
              <option value="all">全部优先级</option>
              <option value="normal">普通</option>
              <option value="important">重要</option>
              <option value="urgent">紧急</option>
            </select>
          </div>

          {loading ? <div className="page-center"><div className="spinner" /></div> : null}
          {!loading && visibleNotices.length === 0 ? <div className="empty-state-card"><i className="bi bi-inbox text-6xl" /><p className="mt-3">没有符合条件的公告</p></div> : null}
          <div className="notice-history-list">
            {visibleNotices.map((notice) => {
              const id = noticeId(notice)
              const bucket = noticeBucket(notice)
              return (
                <article className="card notice-history-item" key={id}>
                  <div className="notice-history-main">
                    <div className="notice-history-meta">
                      <span className={`notice-status-badge is-${bucket}`}>{statusLabels[bucket]}</span>
                      <span className={`notice-priority-badge is-${notice.priority || 'normal'}`}>{priorityOptions.find((item) => item.value === notice.priority)?.label || '普通'}</span>
                      <time dateTime={noticeDateTime(notice.publish_at || notice.timestamp)}>{notice.publish_at || notice.timestamp || '未设置发布时间'}</time>
                      {notice.updated_at ? <time dateTime={noticeDateTime(notice.updated_at)}>编辑于 {notice.updated_at}</time> : null}
                    </div>
                    <h3>{notice.title || '校园公告'}</h3>
                    {notice.summary ? <p className="notice-history-summary">{notice.summary}</p> : null}
                    <p className="notice-history-content">{notice.content}</p>
                  </div>
                  <div className="notice-history-actions">
                    {canUpdate ? <button className="btn btn-sm btn-outline" type="button" disabled={Boolean(workingId)} onClick={() => startEdit(notice)}><i className="bi bi-pencil" />编辑</button> : null}
                    {notice.status === 'archived' && canUpdate ? (
                      <button className="btn btn-sm btn-primary" type="button" disabled={Boolean(workingId)} onClick={() => restore(notice)}><i className="bi bi-arrow-counterclockwise" />{workingId === id ? '恢复中...' : '恢复'}</button>
                    ) : null}
                    {notice.status !== 'archived' && canDelete ? (
                      <button className="btn btn-sm btn-danger" type="button" disabled={Boolean(workingId)} onClick={() => setArchiveTarget(notice)}><i className="bi bi-archive" />归档</button>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      </div>

      <Modal
        visible={canDelete && Boolean(archiveTarget)}
        title="归档公告"
        onClose={() => !workingId && setArchiveTarget(null)}
        footer={(
          <>
            <button className="btn btn-outline" type="button" disabled={Boolean(workingId)} onClick={() => setArchiveTarget(null)}>取消</button>
            <button className="btn btn-danger" type="button" disabled={Boolean(workingId)} onClick={archive}>
              <i className="bi bi-archive" />{workingId ? '正在归档...' : '确认归档'}
            </button>
          </>
        )}
      >
        <p className="text-sm text-muted">归档后公告会立即从首页移除，但记录会保留在历史列表中，之后可以恢复。</p>
      </Modal>
    </AdminShell>
  )
}
