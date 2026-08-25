import { useCallback, useEffect, useMemo, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import { useAlert } from '../../contexts/AlertContext.jsx'
import { defaultCommunity, usePlatform } from '../../contexts/PlatformContext.jsx'
import { useUser } from '../../contexts/UserContext.jsx'
import api from '../../services/api'

const communityFormValue = (settings = {}) => ({
  ...defaultCommunity,
  ...settings,
  sensitive_words: Array.isArray(settings.sensitive_words)
    ? settings.sensitive_words.join('\n')
    : String(settings.sensitive_words || '')
})

const captchaFormValue = (settings = {}) => ({
  enabled: settings.enabled === true,
  provider: ['turnstile', 'recaptcha'].includes(settings.provider) ? settings.provider : 'none',
  site_key: String(settings.site_key || ''),
  secret_key: '',
  has_secret: settings.has_secret === true,
  source: settings.source || 'environment'
})

function ToggleRow({ checked, description, disabled = false, label, onChange }) {
  return (
    <label className="settings-toggle-row">
      <span><b>{label}</b><small>{description}</small></span>
      <input type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="settings-switch" aria-hidden="true" />
    </label>
  )
}

export default function AdminSettings() {
  const [communityForm, setCommunityForm] = useState(communityFormValue())
  const [captchaForm, setCaptchaForm] = useState(captchaFormValue())
  const [loading, setLoading] = useState(true)
  const [savingCommunity, setSavingCommunity] = useState(false)
  const [savingCaptcha, setSavingCaptcha] = useState(false)
  const alert = useAlert()
  const { refreshCommunity } = usePlatform()
  const { hasCapability } = useUser()
  const canUpdateCommunity = hasCapability('settings.community.update')
  const canUpdateCaptcha = hasCapability('settings.captcha.update')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [communityResponse, captchaResponse] = await Promise.all([
        api.adminGetCommunitySettings(),
        api.adminGetCaptchaSettings()
      ])
      setCommunityForm(communityFormValue(communityResponse.data?.settings || {}))
      setCaptchaForm(captchaFormValue(captchaResponse.data?.settings || {}))
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

  const updateCaptcha = (name, value) => {
    setCaptchaForm((current) => ({ ...current, [name]: value }))
  }

  const saveCommunity = async (event) => {
    event.preventDefault()
    if (!canUpdateCommunity) return
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
  const captchaReady = !captchaForm.enabled || (
    captchaForm.provider !== 'none'
    && captchaForm.site_key.trim()
    && (captchaForm.has_secret || captchaForm.secret_key.trim())
  )

  const saveCaptcha = async (event) => {
    event.preventDefault()
    if (!canUpdateCaptcha || !captchaReady) return
    setSavingCaptcha(true)
    try {
      const response = await api.adminUpdateCaptchaSettings({
        enabled: captchaForm.enabled,
        provider: captchaForm.provider,
        site_key: captchaForm.site_key.trim(),
        secret_key: captchaForm.secret_key.trim()
      })
      setCaptchaForm(captchaFormValue(response.data?.settings || captchaForm))
      alert.showTopRightAlert('人机验证设置已生效', 'success', '保存成功')
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '人机验证保存失败')
    } finally {
      setSavingCaptcha(false)
    }
  }

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
              <ToggleRow label="允许发布留言" description="关闭后所有访客都不能发布留言" checked={communityForm.posting_enabled} disabled={!canUpdateCommunity || savingCommunity} onChange={(value) => updateCommunity('posting_enabled', value)} />
              <ToggleRow label="允许发表评论" description="关闭后所有留言暂停新增评论和回复" checked={communityForm.commenting_enabled} disabled={!canUpdateCommunity || savingCommunity} onChange={(value) => updateCommunity('commenting_enabled', value)} />
              <div className="info-callout"><i className="bi bi-incognito" /><span><b>游客匿名发帖默认开放</b><br />账号登录不再作为发帖前置；仍可通过“允许发布留言”暂停全站发布。</span></div>
              <div className="info-callout"><i className="bi bi-chat-dots" /><span><b>游客评论默认开放</b><br />仍可通过“允许发表评论”暂停全站评论与回复。</span></div>
              <ToggleRow label="普通动态与表白需要审核" description="适用于游客和普通用户；管理角色发布的内容与登录后的失物招领仍会立即公开" checked={communityForm.require_post_approval} disabled={!canUpdateCommunity || savingCommunity} onChange={(value) => updateCommunity('require_post_approval', value)} />
            </div>

            <label className="block space-y-2">
              <span className="font-bold">暂停说明</span>
              <input className="field w-full" value={communityForm.pause_reason || ''} maxLength={300} disabled={!canUpdateCommunity || savingCommunity} onChange={(event) => updateCommunity('pause_reason', event.target.value)} placeholder="例如：系统维护中，预计今晚 22:00 恢复" />
              <span className="block text-right text-xs text-muted">{String(communityForm.pause_reason || '').length}/300</span>
            </label>

            <label className="block space-y-2">
              <span className="flex items-center justify-between gap-3 font-bold"><span>社区公约</span><span className="text-xs text-muted">每行一条规则</span></span>
              <textarea className="field min-h-48 w-full" value={communityForm.community_rules || ''} maxLength={10000} disabled={!canUpdateCommunity || savingCommunity} onChange={(event) => updateCommunity('community_rules', event.target.value)} />
              <span className="block text-right text-xs text-muted">{String(communityForm.community_rules || '').length}/10000</span>
            </label>

            <label className="block space-y-2">
              <span className="flex items-center justify-between gap-3 font-bold"><span>敏感词拦截</span><span className={`text-xs ${sensitiveWordCount > 200 ? 'text-rose-500' : 'text-muted'}`}>{sensitiveWordCount}/200</span></span>
              <textarea className="field min-h-40 w-full font-mono text-sm" value={communityForm.sensitive_words || ''} disabled={!canUpdateCommunity || savingCommunity} onChange={(event) => updateCommunity('sensitive_words', event.target.value)} placeholder="每行一个词，也支持使用逗号分隔" />
              <span className="text-xs text-muted">命中后由后端拒绝发布，不会向公开配置接口返回词表。</span>
            </label>

            <div className="settings-security-note"><i className="bi bi-shield-check" /><span>开关和敏感词在后端强制执行，不能通过绕过前端按钮规避。</span></div>

            {!canUpdateCommunity ? <div className="info-callout"><i className="bi bi-eye" /><span><b>当前为只读模式</b><br />你可以查看社区设置，但没有修改社区设置的权限。</span></div> : null}

            <div className="flex justify-end gap-2 border-t border-[var(--border-color)] pt-4">
              <button className="btn btn-outline" type="button" disabled={savingCommunity} onClick={load}>重置</button>
              {canUpdateCommunity ? <button className="btn btn-primary" type="submit" disabled={savingCommunity || sensitiveWordCount > 200}><i className="bi bi-check-lg" />{savingCommunity ? '保存中...' : '保存社区设置'}</button> : null}
            </div>
          </form>

          <div className="mt-8 border-t border-[var(--border-color)] pt-7">
            <div className="admin-settings-heading">
              <div><h2>人机验证</h2><p className="mt-1 text-sm text-muted">用于登录、注册等高风险入口，服务端密钥只会加密保存。</p></div>
              <span className={`badge ${captchaForm.enabled ? 'status-success' : 'status-warning'}`}>{captchaForm.enabled ? '已启用' : '未启用'}</span>
            </div>

            <form className="admin-settings-form mt-5 max-w-4xl" onSubmit={saveCaptcha}>
              <ToggleRow
                label="启用人机验证"
                description="启用前需要配置服务商、站点密钥和服务端密钥"
                checked={captchaForm.enabled}
                disabled={!canUpdateCaptcha || savingCaptcha}
                onChange={(value) => updateCaptcha('enabled', value)}
              />

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block space-y-2">
                  <span className="font-bold">验证服务商</span>
                  <select className="field w-full" value={captchaForm.provider} disabled={!canUpdateCaptcha || savingCaptcha} onChange={(event) => updateCaptcha('provider', event.target.value)}>
                    <option value="none">不使用</option>
                    <option value="turnstile">Cloudflare Turnstile</option>
                    <option value="recaptcha">Google reCAPTCHA</option>
                  </select>
                </label>
                <label className="block space-y-2">
                  <span className="font-bold">站点密钥</span>
                  <input className="field w-full" value={captchaForm.site_key} maxLength={500} disabled={!canUpdateCaptcha || savingCaptcha} onChange={(event) => updateCaptcha('site_key', event.target.value)} autoComplete="off" placeholder="Site key" />
                </label>
              </div>

              <label className="block space-y-2">
                <span className="flex flex-wrap items-center justify-between gap-2 font-bold"><span>服务端密钥</span><span className="text-xs text-muted">{captchaForm.has_secret ? '已保存；留空表示不替换' : '尚未保存'}</span></span>
                <input className="field w-full" type="password" value={captchaForm.secret_key} maxLength={1000} disabled={!canUpdateCaptcha || savingCaptcha} onChange={(event) => updateCaptcha('secret_key', event.target.value)} autoComplete="new-password" placeholder={captchaForm.has_secret ? '留空保留已有密钥' : 'Secret key'} />
              </label>

              <div className="settings-security-note"><i className="bi bi-shield-lock" /><span>当前配置来源：{captchaForm.source === 'database' ? '后台数据库' : '服务器环境变量'}。后台不会回显服务端密钥原文。</span></div>
              {!canUpdateCaptcha ? <div className="info-callout"><i className="bi bi-eye" /><span>当前为只读模式；需要 <code>settings.captcha.update</code> 才能修改人机验证配置。</span></div> : null}

              <div className="flex justify-end gap-2 border-t border-[var(--border-color)] pt-4">
                <button className="btn btn-outline" type="button" disabled={savingCaptcha} onClick={load}>重置</button>
                {canUpdateCaptcha ? <button className="btn btn-primary" type="submit" disabled={savingCaptcha || !captchaReady}><i className="bi bi-shield-check" />{savingCaptcha ? '保存中...' : '保存人机验证'}</button> : null}
              </div>
            </form>
          </div>
        </>
      ) : null}

    </AdminShell>
  )
}
