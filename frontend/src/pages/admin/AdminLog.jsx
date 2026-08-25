import { useEffect, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import api from '../../services/api'
import { useAlert } from '../../contexts/AlertContext.jsx'
import { csvDateStamp, downloadCsv } from '../../utils/csv.js'

export default function AdminLog({ type = 'admin' }) {
  const [query, setQuery] = useState('')
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const alert = useAlert()

  const load = async (nextQuery = query) => {
    setLoading(true)
    try {
      const response = type === 'error' ? await api.adminGetLog(nextQuery) : await api.adminGetAdminLog(nextQuery)
      setLogs(response.data?.log_content || [])
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '加载日志失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [type])
  const title = type === 'error' ? '错误日志' : '管理员日志'

  const exportLogs = async () => {
    setExporting(true)
    try {
      const search = query.trim()
      const response = type === 'error' ? await api.adminGetLog(search) : await api.adminGetAdminLog(search)
      const rows = (response.data?.log_content || []).map((line, index) => [index + 1, line])
      downloadCsv(`${title}-${csvDateStamp()}.csv`, ['序号', '日志内容'], rows)
      alert.showTopRightAlert(`已导出最近最多 1000 行中的 ${rows.length} 行${search ? '筛选后' : ''}日志`, 'success', '导出完成')
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '导出日志失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <AdminShell title={title}>
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <div className="card-flat admin-stat-card"><b>{logs.length}</b><p className="text-muted">当前行数</p></div>
        <div className="card-flat admin-stat-card"><b>{type === 'error' ? 'ERROR' : 'ADMIN'}</b><p className="text-muted">日志类型</p></div>
        <div className="card-flat admin-stat-card"><b>{query ? '已筛选' : '最近记录'}</b><p className="text-muted">最多 1000 行</p></div>
      </div>
      <div className="admin-toolbar mb-4">
        <input className="field admin-toolbar-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && load()} placeholder="搜索日志" />
        <button className="btn btn-primary" type="button" onClick={() => load()}><i className="bi bi-search" />搜索</button>
        <button className="btn btn-outline" onClick={() => { setQuery(''); load('') }}><i className="bi bi-arrow-counterclockwise" />重置</button>
        <button className="btn btn-outline" type="button" disabled={loading || exporting} onClick={exportLogs}><i className="bi bi-download" />{exporting ? '导出中...' : '导出当前结果'}</button>
      </div>
      <section className="card log-viewer p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="page-kicker"><i className="bi bi-terminal" />{title}</span>
          {loading ? <span className="text-sm text-muted">加载中...</span> : null}
        </div>
        {logs.length ? <pre className="code-panel">{logs.join('\n')}</pre> : <div className="empty-state-card"><i className="bi bi-file-earmark-text text-6xl" /><p className="mt-3">暂无日志</p></div>}
      </section>
    </AdminShell>
  )
}
