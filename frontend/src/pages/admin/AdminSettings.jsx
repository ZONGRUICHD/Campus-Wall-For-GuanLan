import { useCallback, useEffect, useMemo, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import { useAlert } from '../../contexts/AlertContext.jsx'
import { defaultCommunity, usePlatform } from '../../contexts/PlatformContext.jsx'
import api from '../../services/api'

const communityFormValue = (settings = {}) => ({
  ...defaultCommunity,
  ...settings,
  sensitive_words: Array.isArray(settings.sensitive_words)
    ? settings.sensitive_words.join('\n')
    : String(settings.sensitive_words || '')
})

function ToggleRow({ checked, description, label, onChange }) {
  return (
    <label className="settings-toggle-row">
      <span><b>{label}</b><small>{description}</small></span>
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} />
      <span className="settings-switch" aria-hidden="true" />
    </label>
  )
}

export default function AdminSettings() {
  const [communityForm, setCommunityForm] = useState(communityFormValue())
  const [loading, setLoading] = useState(true)
  const [savingCommunity, setSavingCommunity] = useState(false)
  const alert = useAlert()
  const { refreshCommunity } = usePlatform()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const communityResponse = await api.adminGetCommunitySettings()
      setCommunityForm(communityFormValue(communityResponse.data?.settings || {}))
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '设置加载失败')
    } finally {
      setLoading(false)
    }
  }, [alert])

  useEffect(() => { load() }, [load])

  const updateCommunity = (name, value) => {
    setCommunityForm((current) => ({ ...current, [name]: value }))
  }

  const saveCommunity = async (event) => {
    event.preventDefault()
    setSavingCommunity(true)
    try {
      const response = await api.adminUpdateCommunitySettings({
        posting_enabled: communityForm.posting_enabled,
        commenting_enabled: communityForm.commenting_enabled,
        guest_posting_enabled: true,
        guest_commenting_enabled: true,
        require_post_approval: communityForm.require_post_approval,
        pause_reason: communityForm.pause_reason,
        community_rules: communityForm.community_rules,
        sensitive_words: communityForm.sensitive_words
      })
      setCommunityForm(communityFormValue(response.data?.settings || communityForm))
      await refreshCommunity()
      const released = Number(response.data?.released_pending || 0)
      alert.showTopRightAlert(released ? `设置已生效，${released} 条待审留言已公开` : '社区运营设置已同步到前台', 'success', '保存成功')
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '保存失败')
    } finally {
      setSavingCommunity(false)
    }
  }

  const sensitiveWordCount = useMemo(() => new Set(
    String(communityForm.sensitive_words || '').split(/[\n,，]+/).map((word) => word.trim().toLowerCase()).filter(Boolean)
  ).size, [communityForm.sensitive_words])

  return (
    <AdminShell title="平台设置">
      {loading ? <div className="page-center"><div className="spinner" /></div> : null}

      {!loading ? (
        <>
          <div className="admin-settings-heading">
            <div><h2>社区运营控制</h2></div>
            <span className={`badge ${communityForm.posting_enabled && communityForm.commenting_enabled ? 'status-success' : 'status-warning'}`}>{communityForm.posting_enabled && communityForm.commenting_enabled ? '互动开放' : '部分关闭'}</span>
          </div>

          <form className="admin-settings-form mt-5 max-w-4xl" onSubmit={saveCommunity}>
            <div className="grid gap-3 md:grid-cols-2">
              <ToggleRow label="允许发布留言" description="关闭后所有访客都不能发布留言" checked={communityForm.posting_enabled} onChange={(value) => updateCommunity('posting_enabled', value)} />
              <ToggleRow label="允许发表评论" description="关闭后所有留言暂停新增评论和回复" checked={communityForm.commenting_enabled} onChange={(value) => updateCommunity('commenting_enabled', value)} />
              <div className="info-callout"><i className="bi bi-incognito" /><span><b>游客匿名发帖默认开放</b><br />账号登录不再作为发帖前置；仍可通过“允许发布留言”暂停全站发布。</span></div>
              <div className="info-callout"><i className="bi bi-chat-dots" /><span><b>游客评论默认开放</b><br />仍可通过“允许发表评论”暂停全站评论与回复。</span></div>
              <ToggleRow label="普通动态需要审核后公开" description="适用于游客和普通用户的普通动态；管理角色、表白墙与失物招领发布后立即公开" checked={communityForm.require_post_approval} onChange={(value) => updateCommunity('require_post_approval', value)} />
            </div>

            <label className="block space-y-2">
              <span className="font-bold">暂停说明</span>
              <input className="field w-full" value={communityForm.pause_reason || ''} maxLength={300} onChange={(event) => updateCommunity('pause_reason', event.target.value)} placeholder="例如：系统维护中，预计今晚 22:00 恢复" />
              <span className="block text-right text-xs text-muted">{String(communityForm.pause_reason || '').length}/300</span>
            </label>

            <label className="block space-y-2">
              <span className="flex items-center justify-between gap-3 font-bold"><span>社区公约</span><span className="text-xs text-muted">每行一条规则</span></span>
              <textarea className="field min-h-48 w-full" value={communityForm.community_rules || ''} maxLength={10000} onChange={(event) => updateCommunity('community_rules', event.target.value)} />
              <span className="block text-right text-xs text-muted">{String(communityForm.community_rules || '').length}/10000</span>
            </label>

            <label className="block space-y-2">
              <span className="flex items-center justify-between gap-3 font-bold"><span>敏感词拦截</span><span className={`text-xs ${sensitiveWordCount > 200 ? 'text-rose-500' : 'text-muted'}`}>{sensitiveWordCount}/200</span></span>
              <textarea className="field min-h-40 w-full font-mono text-sm" value={communityForm.sensitive_words || ''} onChange={(event) => updateCommunity('sensitive_words', event.target.value)} placeholder="每行一个词，也支持使用逗号分隔" />
              <span className="text-xs text-muted">命中后由后端拒绝发布，不会向公开配置接口返回词表。</span>
            </label>

            <div className="settings-security-note"><i className="bi bi-shield-check" /><span>开关和敏感词在后端强制执行，不能通过绕过前端按钮规避。</span></div>

            <div className="flex justify-end gap-2 border-t border-[var(--border-color)] pt-4">
              <button className="btn btn-outline" type="button" disabled={savingCommunity} onClick={load}>重置</button>
              <button className="btn btn-primary" type="submit" disabled={savingCommunity || sensitiveWordCount > 200}><i className="bi bi-check-lg" />{savingCommunity ? '保存中...' : '保存社区设置'}</button>
            </div>
          </form>
        </>
      ) : null}

    </AdminShell>
  )
}
