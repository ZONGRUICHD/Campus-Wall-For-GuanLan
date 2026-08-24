import { useEffect, useMemo, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import Modal from '../../components/Modal.jsx'
import { useAlert } from '../../contexts/AlertContext.jsx'
import api from '../../services/api'

const typeOptions = [
  { value: 'all', label: '全部', icon: 'bi-collection' },
  { value: 'message', label: '留言', icon: 'bi-chat-quote' },
  { value: 'comment', label: '评论', icon: 'bi-chat-left-dots' }
]

const itemKey = (item) => `${item.type}:${item.message_id}:${item.comment_id || ''}`
const itemTarget = (item) => ({
  type: item.type,
  message_id: item.message_id,
  comment_id: item.comment_id || ''
})

const originLabel = (origin) => ({
  user: '用户自行删除',
  admin: '后台操作',
  report: '举报处置'
}[origin] || '系统迁移')

export default function AdminTrash() {
  const [items, setItems] = useState([])
  const [counts, setCounts] = useState({ all: 0, messages: 0, comments: 0 })
  const [type, setType] = useState('all')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [selectedKeys, setSelectedKeys] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [purgeTarget, setPurgeTarget] = useState(null)
  const alert = useAlert()

  const load = async () => {
    setLoading(true)
    try {
      const response = await api.adminGetTrash({ type, q: appliedQuery, page, page_size: 20 })
      const data = response.data || {}
      setItems(data.items || [])
      setCounts(data.counts || { all: 0, messages: 0, comments: 0 })
      setTotal(data.total || 0)
      setTotalPages(data.total_pages || 0)
      setSelectedKeys([])
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '回收站加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [type, page, appliedQuery])

  const selectedItems = useMemo(() => items.filter((item) => selectedKeys.includes(itemKey(item))), [items, selectedKeys])
  const allPageSelected = items.length > 0 && items.every((item) => selectedKeys.includes(itemKey(item)))

  const changeType = (nextType) => {
    setType(nextType)
    setPage(1)
  }

  const submitSearch = () => {
    setAppliedQuery(query.trim())
    setPage(1)
  }

  const toggleItem = (item) => {
    const key = itemKey(item)
    setSelectedKeys((keys) => keys.includes(key) ? keys.filter((value) => value !== key) : [...keys, key])
  }

  const togglePage = () => setSelectedKeys(allPageSelected ? [] : items.map(itemKey))

  const restoreOne = async (item) => {
    setBusy(true)
    try {
      const response = item.type === 'message'
        ? await api.adminRestoreTrashMessage(item.message_id)
        : await api.adminRestoreTrashComment(item.message_id, item.comment_id)
      if (!response.data?.success) throw new Error(response.data?.error || '恢复失败')
      alert.showTopRightAlert(`${item.type === 'message' ? '留言' : '评论'}已恢复`, 'success', '操作完成')
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '恢复失败')
    } finally {
      setBusy(false)
    }
  }

  const runBulk = async (action) => {
    if (!selectedItems.length) return
    setBusy(true)
    try {
      const response = await api.adminBulkTrash({
        action,
        confirm: action === 'purge' ? 'PURGE' : undefined,
        targets: selectedItems.map(itemTarget)
      })
      const data = response.data || {}
      if (!data.success) throw new Error(data.error || '批量操作失败')
      alert.showTopRightAlert(`成功处理 ${data.succeeded || 0} 项`, data.failed ? 'warning' : 'success', data.failed ? '部分完成' : '操作完成')
      setPurgeTarget(null)
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '批量操作失败')
    } finally {
      setBusy(false)
    }
  }

  const purgeOne = async (item) => {
    setBusy(true)
    try {
      const response = item.type === 'message'
        ? await api.adminPurgeTrashMessage(item.message_id)
        : await api.adminPurgeTrashComment(item.message_id, item.comment_id)
      if (!response.data?.success) throw new Error(response.data?.error || '彻底删除失败')
      alert.showTopRightAlert('内容已彻底删除', 'success', '操作完成')
      setPurgeTarget(null)
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '彻底删除失败')
    } finally {
      setBusy(false)
    }
  }

  const confirmPurge = () => purgeTarget?.bulk ? runBulk('purge') : purgeOne(purgeTarget)

  return (
    <AdminShell title="内容回收站">
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="回收站类型筛选">
        {typeOptions.map((option) => {
          const count = option.value === 'all' ? counts.all : counts[`${option.value}s`]
          return (
            <button className={`btn btn-sm ${type === option.value ? 'btn-primary' : 'btn-outline'}`} type="button" role="tab" aria-selected={type === option.value} key={option.value} onClick={() => changeType(option.value)}>
              <i className={`bi ${option.icon}`} /><span>{option.label}</span><span className="badge">{count || 0}</span>
            </button>
          )
        })}
      </div>

      <div className="admin-toolbar mb-4">
        <input className="field admin-toolbar-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submitSearch()} placeholder="搜索内容、账号、操作者或原因..." />
        <button className="btn btn-primary" type="button" onClick={submitSearch}><i className="bi bi-search" />搜索</button>
        <button className="btn btn-outline" type="button" onClick={load}><i className="bi bi-arrow-clockwise" />刷新</button>
      </div>

      <div className="admin-selection-bar mb-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-bold"><input type="checkbox" checked={allPageSelected} onChange={togglePage} /><span>本页全选</span></label>
        <span className="text-sm text-muted">当前筛选 {total} 项，已选 {selectedKeys.length} 项</span>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-sm btn-success" type="button" disabled={!selectedKeys.length || busy} onClick={() => runBulk('restore')}><i className="bi bi-arrow-counterclockwise" />批量恢复</button>
          <button className="btn btn-sm btn-danger" type="button" disabled={!selectedKeys.length || busy} onClick={() => setPurgeTarget({ bulk: true, count: selectedKeys.length })}><i className="bi bi-trash3" />批量彻底删除</button>
        </div>
      </div>

      {loading ? <div className="page-center"><div className="spinner" /></div> : null}
      {!loading && !items.length ? <div className="empty-state-card"><i className="bi bi-trash3" /><h2 className="mt-3 text-lg font-bold">回收站为空</h2></div> : null}

      <div className="admin-trash-list">
        {items.map((item) => (
          <article className="admin-trash-item" key={itemKey(item)}>
            <input className="mt-1 h-5 w-5 shrink-0" type="checkbox" checked={selectedKeys.includes(itemKey(item))} onChange={() => toggleItem(item)} aria-label={`选择${item.type === 'message' ? '留言' : '评论'} ${item.id}`} />
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge status-danger"><i className={`bi ${item.type === 'message' ? 'bi-chat-quote' : 'bi-chat-left-dots'}`} />{item.type === 'message' ? '留言' : '评论'}</span>
                <span className="badge">留言 #{item.message_id}{item.floor ? ` · ${item.floor} 楼` : ''}</span>
                <span className="badge">{originLabel(item.deletion_origin)}</span>
                <span className="text-xs text-muted">{item.deleted_at ? new Date(item.deleted_at).toLocaleString('zh-CN') : '未知时间'}</span>
              </div>
              <p className="message-text text-sm">{item.text || '附件内容'}</p>
              {item.type === 'comment' ? <p className="truncate text-sm text-muted">原帖：{item.message_preview || '附件留言'}</p> : null}
              <div className="flex flex-wrap gap-2 text-xs text-muted">
                <span>操作者：{item.deleted_by || '-'}</span>
                <span>原因：{item.deletion_reason || '-'}</span>
                {item.user_id ? <span>绑定账号：{item.user?.username || item.username || item.user_id}</span> : <span>游客内容</span>}
                {(item.files || []).length ? <span>附件：{item.files.length}</span> : null}
              </div>
            </div>
            <div className="admin-trash-actions">
              <button className="btn btn-sm btn-success" type="button" disabled={busy} onClick={() => restoreOne(item)}><i className="bi bi-arrow-counterclockwise" />恢复</button>
              <button className="btn btn-sm btn-danger" type="button" disabled={busy} onClick={() => setPurgeTarget(item)}><i className="bi bi-trash3" />彻底删除</button>
            </div>
          </article>
        ))}
      </div>

      {totalPages > 1 ? (
        <div className="mt-5 flex items-center justify-center gap-3">
          <button className="btn btn-sm btn-outline" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><i className="bi bi-chevron-left" />上一页</button>
          <span className="text-sm text-muted">第 {page} / {totalPages} 页</span>
          <button className="btn btn-sm btn-outline" type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>下一页<i className="bi bi-chevron-right" /></button>
        </div>
      ) : null}

      <Modal visible={Boolean(purgeTarget)} title={purgeTarget?.bulk ? `彻底删除 ${purgeTarget.count || selectedItems.length} 项内容` : '彻底删除内容'} onClose={() => !busy && setPurgeTarget(null)} footer={<><button className="btn btn-outline" disabled={busy} onClick={() => setPurgeTarget(null)}>取消</button><button className="btn btn-danger" disabled={busy} onClick={confirmPurge}>确认永久删除</button></>}>
        <div className="info-callout status-danger"><i className="bi bi-exclamation-triangle" /><span>数据库记录、互动关系和无其他引用的附件将被永久清理，操作无法撤销。</span></div>
      </Modal>
    </AdminShell>
  )
}
