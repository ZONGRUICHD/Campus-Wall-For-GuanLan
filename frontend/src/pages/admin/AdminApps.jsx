import { useEffect, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import Modal from '../../components/Modal.jsx'
import api from '../../services/api'
import { useAlert } from '../../contexts/AlertContext.jsx'

const emptyForm = {
  name: '',
  slug: '',
  author: '',
  description: '',
  partition: '',
  url: '',
  iconBackground: 'linear-gradient(135deg, #2A5CAA, #FF7F3E)',
  status: 'published',
  sortOrder: 0,
  icon: null
}

const slugify = (value = '') => String(value || '')
  .normalize('NFKD')
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .replace(/-{2,}/g, '-')
  .slice(0, 80)

const safeExternalUrl = (value = '') => {
  try {
    const url = new URL(String(value), window.location.origin)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '#'
  } catch {
    return '#'
  }
}

function AppStatus({ status }) {
  if (status === 'hidden') return <span className="app-status-badge app-status-hidden">已下架</span>
  return <span className="app-status-badge app-status-published">展示中</span>
}

export default function AdminApps() {
  const [apps, setApps] = useState([])
  const [stats, setStats] = useState({ total: 0, published: 0, hidden: 0 })
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [slugTouched, setSlugTouched] = useState(false)
  const [iconPreview, setIconPreview] = useState('')
  const alert = useAlert()

  const load = async () => {
    setLoading(true)
    try {
      const [list, stat] = await Promise.all([api.adminGetApps({ q: query }), api.adminGetAppStats()])
      setApps(list.data?.apps || [])
      setStats(stat.data?.stats || { total: 0, published: 0, hidden: 0 })
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '加载应用失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({ ...emptyForm })
    setIconPreview('')
    setSlugTouched(false)
    setModalOpen(true)
  }

  const openEdit = (app) => {
    setEditing(app)
    setForm({
      name: app.name || '',
      slug: app.slug || '',
      author: app.author || '',
      description: app.description || app.appDescription || '',
      partition: app.partition || '',
      url: app.url || '',
      iconBackground: app.iconBackground || '',
      status: app.status || 'published',
      sortOrder: app.sortOrder || 0,
      icon: null
    })
    setIconPreview(app.iconUrl || '')
    setSlugTouched(true)
    setModalOpen(true)
  }

  const updateName = (value) => {
    setForm((current) => ({
      ...current,
      name: value,
      slug: editing || slugTouched ? current.slug : slugify(value)
    }))
  }

  const updateIcon = (file) => {
    setForm((current) => ({ ...current, icon: file || null }))
    if (file) setIconPreview(URL.createObjectURL(file))
    else setIconPreview(editing?.iconUrl || '')
  }

  const save = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      alert.showTopRightAlert('请填写应用名称和链接', 'warning', '信息不完整')
      return
    }
    try {
      if (editing) await api.adminUpdateApp(editing.id, form)
      else await api.adminCreateApp(form)
      alert.showTopRightAlert(editing ? '应用已更新' : '应用已新增', 'success', '成功')
      setModalOpen(false)
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '保存失败')
    }
  }

  const hide = async (app) => {
    if (!window.confirm(`确定下架应用「${app.name}」吗？前台将不再展示。`)) return
    await api.adminHideApp(app.id)
    await load()
  }

  const restore = async (app) => {
    await api.adminRestoreApp(app.id)
    await load()
  }

  const remove = async (app) => {
    if (!window.confirm(`彻底删除应用「${app.name}」吗？这会删除数据库记录和本地上传图标。`)) return
    if (window.prompt('输入 DELETE 确认彻底删除') !== 'DELETE') return
    await api.adminDeleteApp(app.id)
    await load()
  }

  const search = () => {
    load()
  }

  return (
    <AdminShell title="应用管理">
      <div className="admin-apps-page">
      <div className="admin-apps-stats mb-5 grid gap-3 md:grid-cols-3">
        <div className="card-flat admin-stat-card"><b>{stats.total}</b><p className="text-muted">全部应用</p></div>
        <div className="card-flat admin-stat-card"><b>{stats.published}</b><p className="text-muted">前台展示</p></div>
        <div className="card-flat admin-stat-card"><b>{stats.hidden}</b><p className="text-muted">已下架</p></div>
      </div>

      <div className="admin-apps-toolbar mb-4">
        <input className="field admin-apps-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && search()} placeholder="搜索应用名称、标识、作者或描述" />
        <button className="btn btn-primary" type="button" onClick={search}><i className="bi bi-search" />搜索</button>
        <button className="btn btn-outline" type="button" onClick={load}><i className="bi bi-arrow-clockwise" />刷新</button>
        <button className="btn btn-primary" type="button" onClick={openCreate}><i className="bi bi-plus-circle" />新增应用</button>
      </div>

      {loading ? <div className="page-center"><div className="spinner" /></div> : null}
      <div className="admin-apps-table-wrap">
        <table className="admin-apps-table">
          <colgroup>
            <col className="admin-app-col-main" />
            <col className="admin-app-col-slug" />
            <col className="admin-app-col-category" />
            <col className="admin-app-col-sort" />
            <col className="admin-app-col-status" />
            <col className="admin-app-col-link" />
            <col className="admin-app-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>应用</th>
              <th>标识</th>
              <th>分类</th>
              <th>排序</th>
              <th>状态</th>
              <th>链接</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((app) => (
              <tr key={app.id}>
                <td>
                  <div className="admin-app-cell">
                    <div className="admin-app-icon" style={{ backgroundImage: app.iconBackground || undefined }}>
                      {app.iconUrl ? <img src={app.iconUrl} alt="" /> : <i className="bi bi-app" />}
                    </div>
                    <div className="admin-app-meta">
                      <p>{app.name}</p>
                      <small className="text-muted">{app.author || '未知'} · {app.description || '暂无描述'}</small>
                    </div>
                  </div>
                </td>
                <td><span className="admin-app-mono">{app.slug}</span></td>
                <td><span className="admin-app-mono">{app.partition || '-'}</span></td>
                <td className="admin-app-sort">{app.sortOrder || 0}</td>
                <td className="admin-app-status-cell"><AppStatus status={app.status} /></td>
                <td className="admin-app-link-cell"><a className="admin-app-link" href={safeExternalUrl(app.url)} target="_blank" rel="noreferrer">打开</a></td>
                <td className="admin-app-actions-cell">
                  <div className="admin-app-actions">
                    <button className="btn btn-sm btn-outline" type="button" onClick={() => openEdit(app)}>编辑</button>
                    {app.status === 'hidden' ? <button className="btn btn-sm btn-outline" type="button" onClick={() => restore(app)}>恢复</button> : <button className="btn btn-sm btn-outline" type="button" onClick={() => hide(app)}>下架</button>}
                    <button className="btn btn-sm btn-danger" type="button" onClick={() => remove(app)}>删除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && !apps.length ? <p className="py-8 text-center text-muted">暂无应用</p> : null}
      </div>

      <Modal
        visible={modalOpen}
        title={editing ? '编辑应用' : '新增应用'}
        onClose={() => setModalOpen(false)}
        width="960px"
        footer={(
          <>
            <button className="btn btn-outline" type="button" onClick={() => setModalOpen(false)}>取消</button>
            <button className="btn btn-primary" type="button" onClick={save}>保存</button>
          </>
        )}
      >
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[140px_1fr]">
            <div>
              <div className="mb-3 flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl bg-[var(--primary-light)] text-3xl text-[var(--primary-color)]" style={{ backgroundImage: form.iconBackground || undefined }}>
                {iconPreview ? <img className="h-full w-full object-contain" src={iconPreview} alt="" /> : <i className="bi bi-app" />}
              </div>
              <label className="btn btn-sm btn-outline">
                <i className="bi bi-cloud-upload" />上传图标
                <input hidden type="file" accept=".png,.jpg,.jpeg,.webp,.svg,.ico,image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon" onChange={(event) => updateIcon(event.target.files?.[0] || null)} />
              </label>
            </div>
            <div className="space-y-4">
              <label className="block"><span className="mb-2 block text-sm font-bold">应用名称</span><input className="field" value={form.name} onChange={(event) => updateName(event.target.value)} maxLength={80} placeholder="例如：共享网盘" /></label>
              <label className="block"><span className="mb-2 block text-sm font-bold">应用标识</span><input className="field font-mono" value={form.slug} onChange={(event) => { setSlugTouched(true); setForm((current) => ({ ...current, slug: event.target.value })) }} maxLength={80} placeholder="例如：cloud-drive" /></label>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block"><span className="mb-2 block text-sm font-bold">作者/提供者</span><input className="field" value={form.author} onChange={(event) => setForm((current) => ({ ...current, author: event.target.value }))} maxLength={80} /></label>
            <label className="block"><span className="mb-2 block text-sm font-bold">分类</span><input className="field" value={form.partition} onChange={(event) => setForm((current) => ({ ...current, partition: event.target.value }))} maxLength={80} placeholder="utilities / productivity" /></label>
          </div>
          <label className="block"><span className="mb-2 block text-sm font-bold">应用链接</span><input className="field" value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://example.com" /></label>
          <label className="block"><span className="mb-2 block text-sm font-bold">图标背景</span><input className="field" value={form.iconBackground} onChange={(event) => setForm((current) => ({ ...current, iconBackground: event.target.value }))} placeholder="linear-gradient(135deg, #2A5CAA, #FF7F3E)" /></label>
          <label className="block"><span className="mb-2 block text-sm font-bold">描述</span><textarea className="field min-h-28" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={1000} /></label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block"><span className="mb-2 block text-sm font-bold">状态</span><select className="field" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="published">展示中</option><option value="hidden">已下架</option></select></label>
            <label className="block"><span className="mb-2 block text-sm font-bold">排序</span><input className="field" type="number" value={form.sortOrder} onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))} /></label>
          </div>
        </div>
      </Modal>
    </AdminShell>
  )
}
