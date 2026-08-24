import { useCallback, useEffect, useMemo, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import { useAlert } from '../../contexts/AlertContext.jsx'
import { defaultCommunity, usePlatform } from '../../contexts/PlatformContext.jsx'
import api from '../../services/api'

const providerNames = {
  none: '关闭',
  turnstile: 'Cloudflare Turnstile',
  recaptcha: 'Google reCAPTCHA'
}

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
  const [activeTab, setActiveTab] = useState('community')
  const [captchaForm, setCaptchaForm] = useState({ provider: 'none', enabled: false, site_key: '', secret_key: '', has_secret: false, source: 'database' })
  const [communityForm, setCommunityForm] = useState(communityFormValue())
  const [loading, setLoading] = useState(true)
  const [savingCaptcha, setSavingCaptcha] = useState(false)
  const [savingCommunity, setSavingCommunity] = useState(false)
  const alert = useAlert()
  const { refreshCommunity } = usePlatform()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [captchaResponse, communityResponse] = await Promise.all([
        api.adminGetCaptchaSettings(),
        api.adminGetCommunitySettings()
      ])
      setCaptchaForm({ ...(captchaResponse.data?.settings || {}), secret_key: '' })
      setCommunityForm(communityFormValue(communityResponse.data?.settings || {}))
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '设置加载失败')
    } finally {
      setLoading(false)
    }
  }, [alert])

  useEffect(() => { load() }, [load])

  const updateCaptcha = (name, value) => {
    setCaptchaForm((current) => {
      const next = { ...current, [name]: value }
      if (name === 'provider' && value === 'none') next.enabled = false
      return next
    })
  }

  const updateCommunity = (name, value) => {
    setCommunityForm((current) => ({ ...current, [name]: value }))
  }

  const saveCaptcha = async (event) => {
    event.preventDefault()
    setSavingCaptcha(true)
    try {
      const response = await api.adminUpdateCaptchaSettings({
        provider: captchaForm.provider,
        enabled: captchaForm.enabled,
        site_key: captchaForm.site_key,
        secret_key: captchaForm.secret_key
      })
      setCaptchaForm({ ...(response.data?.settings || captchaForm), secret_key: '' })
      alert.showTopRightAlert('人机验证设置已生效', 'success', '保存成功')
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '保存失败')
    } finally {
      setSavingCaptcha(false)
    }
  }

  const saveCommunity = async (event) => {
    event.preventDefault()
    setSavingCommunity(true)
    try {
      const response = await api.adminUpdateCommunitySettings({
        posting_enabled: communityForm.posting_enabled,
        commenting_enabled: communityForm.commenting_enabled,
        guest_posting_enabled: communityForm.guest_posting_enabled,
        guest_commenting_enabled: communityForm.guest_commenting_enabled,
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

  const captchaActive = captchaForm.provider !== 'none'
  const sensitiveWordCount = useMemo(() => new Set(
    String(communityForm.sensitive_words || '').split(/[\n,，]+/).map((word) => word.trim().toLowerCase()).filter(Boolean)
  ).size, [communityForm.sensitive_words])

  return (
    <AdminShell title="平台设置">
      <div className="mb-6 flex flex-wrap gap-2 border-b border-[var(--border-color)] pb-4">
        <button className={`btn btn-sm ${activeTab === 'community' ? 'btn-primary' : 'btn-outline'}`} type="button" onClick={() => setActiveTab('community')}><i className="bi bi-chat-square-dots" />社区运营</button>
        <button className={`btn btn-sm ${activeTab === 'security' ? 'btn-primary' : 'btn-outline'}`} type="button" onClick={() => setActiveTab('security')}><i className="bi bi-shield-lock" />登录安全</button>
      </div>

      {loading ? <div className="page-center"><div className="spinner" /></div> : null}

      {!loading && activeTab === 'community' ? (
        <>
          <div className="admin-settings-heading">
            <div><h2>社区运营控制</h2><p>控制公开互动权限，并维护发言规范与内容拦截词。</p></div>
            <span className={`badge ${communityForm.posting_enabled && communityForm.commenting_enabled ? 'status-success' : 'status-warning'}`}>{communityForm.posting_enabled && communityForm.commenting_enabled ? '互动开放' : '部分关闭'}</span>
          </div>

          <form className="admin-settings-form mt-5 max-w-4xl" onSubmit={saveCommunity}>
            <div className="grid gap-3 md:grid-cols-2">
              <ToggleRow label="允许发布留言" description="关闭后所有学生和游客都不能发布或编辑留言" checked={communityForm.posting_enabled} onChange={(value) => updateCommunity('posting_enabled', value)} />
              <ToggleRow label="允许发表评论" description="关闭后所有留言暂停新增评论和回复" checked={communityForm.commenting_enabled} onChange={(value) => updateCommunity('commenting_enabled', value)} />
              <ToggleRow label="允许游客发帖" description="关闭后必须登录学生账号才能发布" checked={communityForm.guest_posting_enabled} onChange={(value) => updateCommunity('guest_posting_enabled', value)} />
              <ToggleRow label="允许游客评论" description="关闭后必须登录学生账号才能评论" checked={communityForm.guest_commenting_enabled} onChange={(value) => updateCommunity('guest_commenting_enabled', value)} />
              <ToggleRow label="发帖需要审核后公开" description="开启后新留言和编辑过的留言须经管理员通过才能公开" checked={communityForm.require_post_approval} onChange={(value) => updateCommunity('require_post_approval', value)} />
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

      {!loading && activeTab === 'security' ? (
        <>
          <div className="admin-settings-heading">
            <div><h2>登录安全</h2><p>学生账号登录的人机验证</p></div>
            <span className={`badge ${captchaForm.enabled ? 'status-success' : ''}`}>{captchaForm.enabled ? '已启用' : '未启用'}</span>
          </div>

          <form className="admin-settings-form mt-5" onSubmit={saveCaptcha}>
            <label className="block space-y-2">
              <span className="font-bold">验证服务</span>
              <select className="field w-full" value={captchaForm.provider} onChange={(event) => updateCaptcha('provider', event.target.value)}>
                <option value="none">关闭</option>
                <option value="turnstile">Cloudflare Turnstile</option>
                <option value="recaptcha">Google reCAPTCHA</option>
              </select>
            </label>

            <label className={`settings-toggle-row ${!captchaActive ? 'is-disabled' : ''}`}>
              <span><b>在学生登录时启用</b><small>{captchaActive ? `当前服务：${providerNames[captchaForm.provider]}` : '选择验证服务后可启用'}</small></span>
              <input type="checkbox" checked={Boolean(captchaForm.enabled)} disabled={!captchaActive} onChange={(event) => updateCaptcha('enabled', event.target.checked)} />
              <span className="settings-switch" aria-hidden="true" />
            </label>

            <label className="block space-y-2">
              <span className="font-bold">站点密钥</span>
              <input className="field w-full" value={captchaForm.site_key || ''} disabled={!captchaActive} onChange={(event) => updateCaptcha('site_key', event.target.value)} autoComplete="off" placeholder="Site key" />
            </label>

            <label className="block space-y-2">
              <span className="flex items-center justify-between gap-3 font-bold"><span>服务端密钥</span><span className={`text-xs ${captchaForm.has_secret ? 'settings-secret-present' : 'text-muted'}`}>{captchaForm.has_secret ? '已保存' : '未保存'}</span></span>
              <input className="field w-full" type="password" value={captchaForm.secret_key || ''} disabled={!captchaActive} onChange={(event) => updateCaptcha('secret_key', event.target.value)} autoComplete="new-password" placeholder={captchaForm.has_secret ? '留空则保持原密钥' : 'Secret key'} />
            </label>

            <div className="settings-security-note"><i className="bi bi-shield-lock" /><span>服务端密钥加密保存，不会返回浏览器。</span></div>

            <div className="flex justify-end gap-2 border-t border-[var(--border-color)] pt-4">
              <button className="btn btn-outline" type="button" disabled={savingCaptcha} onClick={load}>重置</button>
              <button className="btn btn-primary" type="submit" disabled={savingCaptcha}><i className="bi bi-check-lg" />{savingCaptcha ? '保存中...' : '保存设置'}</button>
            </div>
          </form>
        </>
      ) : null}
    </AdminShell>
  )
}
