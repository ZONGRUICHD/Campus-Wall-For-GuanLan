import { useCallback, useEffect, useMemo, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import Modal from '../../components/Modal.jsx'
import { useAlert } from '../../contexts/AlertContext.jsx'
import { useUser } from '../../contexts/UserContext.jsx'
import api from '../../services/api'

const draftsFor = (providers = []) => Object.fromEntries(providers.map((provider) => [provider.id, {
  enabled: provider.enabled === true,
  webhook: '',
  secret: ''
}]))

const providerPresentation = Object.freeze({
  feishu: Object.freeze({ icon: 'bi-send', targetLabel: '机器人 Webhook', targetHint: '粘贴完整 HTTPS Webhook', targetSaved: '已安全保存；留空表示不替换', enableHint: '待审核帖子和表白便签会写入可靠队列并发送到本群' }),
  wecom: Object.freeze({ icon: 'bi-chat-dots', targetLabel: '机器人 Webhook', targetHint: '粘贴完整 HTTPS Webhook', targetSaved: '已安全保存；留空表示不替换', enableHint: '待审核帖子和表白便签会写入可靠队列并发送到本群' }),
  email: Object.freeze({ icon: 'bi-envelope', targetLabel: '收件邮箱', targetHint: '多个地址用逗号分隔', targetSaved: '已保存；留空表示不替换', enableHint: '待审核帖子和表白便签会发送到这些邮箱。SMTP 只保存在服务器环境。' })
})

function ChannelSwitch({ checked, disabled, onChange, hint }) {
  return (
    <label className={`settings-toggle-row notification-channel-switch ${disabled ? 'is-disabled' : ''}`}>
      <span><b>启用审核提醒</b><small>{hint}</small></span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="settings-switch" aria-hidden="true" />
    </label>
  )
}

export default function AdminNotifications() {
  const [providers, setProviders] = useState([])
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [savingProvider, setSavingProvider] = useState('')
  const [testingProvider, setTestingProvider] = useState('')
  const [clearProvider, setClearProvider] = useState(null)
  const alert = useAlert()
  const { hasCapability } = useUser()
  const canUpdate = hasCapability('settings.notifications.update')
  const canTest = hasCapability('settings.notifications.test')

  const applySettings = useCallback((settings = {}, { preserveDrafts = false, resetProviderId = '' } = {}) => {
    const nextProviders = Array.isArray(settings.providers) ? settings.providers : []
    setProviders(nextProviders)
    setDrafts((current) => {
      const refreshed = draftsFor(nextProviders)
      if (!preserveDrafts) return refreshed
      return Object.fromEntries(nextProviders.map((provider) => [
        provider.id,
        provider.id === resetProviderId
          ? refreshed[provider.id]
          : { ...refreshed[provider.id], ...(current[provider.id] || {}) }
      ]))
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const response = await api.adminGetNotificationSettings()
      applySettings(response.data?.settings || {})
    } catch (error) {
      setLoadError(error.message || '暂时无法读取消息提醒设置')
      alert.showTopRightAlert(error.message, 'warning', '消息提醒加载失败')
    } finally {
      setLoading(false)
    }
  }, [alert, applySettings])

  useEffect(() => { load() }, [load])

  const updateDraft = (providerId, name, value) => {
    setDrafts((current) => ({
      ...current,
      [providerId]: { ...(current[providerId] || {}), [name]: value }
    }))
  }

  const save = async (provider) => {
    if (!canUpdate || savingProvider || testingProvider) return
    const draft = drafts[provider.id] || {}
    if (draft.enabled && !provider.configured && !String(draft.webhook || '').trim()) {
      alert.showTopRightAlert(provider.id === 'email' ? '启用前请填写收件邮箱' : '启用前请粘贴机器人平台提供的完整 Webhook', 'warning', provider.id === 'email' ? '缺少邮箱' : '缺少 Webhook')
      return
    }
    setSavingProvider(provider.id)
    try {
      const response = await api.adminUpdateNotificationProvider(provider.id, {
        enabled: draft.enabled === true,
        webhook: String(draft.webhook || '').trim(),
        secret: String(draft.secret || '').trim()
      })
      applySettings(response.data?.settings || {}, { preserveDrafts: true, resetProviderId: provider.id })
      alert.showTopRightAlert(`${provider.label}设置已立即生效`, 'success', '保存成功')
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '消息提醒保存失败')
    } finally {
      setSavingProvider('')
    }
  }

  const sendTest = async (provider) => {
    if (!canTest || !provider.configured || savingProvider || testingProvider) return
    setTestingProvider(provider.id)
    try {
      await api.adminTestNotificationProvider(provider.id)
      alert.showTopRightAlert(provider.id === 'email' ? '固定测试消息已发送，请到对应邮箱确认' : '固定测试消息已发送，请到对应群聊确认', 'success', '测试成功')
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '测试发送失败')
    } finally {
      setTestingProvider('')
    }
  }

  const confirmClear = async () => {
    if (!canUpdate || !clearProvider || savingProvider || testingProvider) return
    const provider = clearProvider
    setSavingProvider(provider.id)
    try {
      const response = await api.adminClearNotificationProvider(provider.id)
      applySettings(response.data?.settings || {}, { preserveDrafts: true, resetProviderId: provider.id })
      setClearProvider(null)
      alert.showTopRightAlert(`${provider.label}凭据已清除`, 'success', '已停用')
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '清除失败')
    } finally {
      setSavingProvider('')
    }
  }

  const stats = useMemo(() => ({
    configured: providers.filter((provider) => provider.configured).length,
    enabled: providers.filter((provider) => provider.enabled).length,
    total: providers.length
  }), [providers])

  return (
    <AdminShell title="消息提醒">
      {loading ? <div className="page-center"><div className="spinner" /></div> : null}

      {!loading && loadError ? (
        <div className="notification-settings-error info-callout status-warning" role="alert">
          <i className="bi bi-exclamation-triangle" />
          <span><b>消息提醒设置未加载</b><small>{loadError}</small></span>
          <button className="btn btn-outline" type="button" onClick={load}><i className="bi bi-arrow-clockwise" />重新加载</button>
        </div>
      ) : null}

      {!loading && !loadError ? (
        <div className="notification-settings-page">
          <section className="notification-settings-intro">
            <div>
              <h2>审核通知</h2>
            </div>
            <div className="notification-settings-stats" aria-label="消息提醒状态">
              <div><strong>{stats.enabled}</strong><span>正在启用</span></div>
              <div><strong>{stats.configured}</strong><span>已配置</span></div>
              <div><strong>{stats.total}</strong><span>可用渠道</span></div>
            </div>
          </section>

          <div className="notification-provider-grid">
            {providers.map((provider) => {
              const draft = drafts[provider.id] || { enabled: false, webhook: '', secret: '' }
              const presentation = providerPresentation[provider.id] || { icon: 'bi-bell', targetLabel: '机器人 Webhook', targetHint: '粘贴完整 HTTPS Webhook', targetSaved: '已安全保存；留空表示不替换', enableHint: '待审核内容会发送到该渠道' }
              const busy = Boolean(savingProvider || testingProvider)
              const canSave = !draft.enabled || provider.configured || String(draft.webhook || '').trim()
              return (
                <section className="notification-provider-card" key={provider.id}>
                  <div className="notification-provider-heading">
                    <span className="notification-provider-icon"><i className={`bi ${presentation.icon}`} /></span>
                    <div className="min-w-0 flex-1">
                      <h3>{provider.label}</h3>
                      <p>{provider.description || '已注册消息提醒渠道'}</p>
                    </div>
                    <span className={`badge ${provider.enabled ? 'status-success' : (provider.configured ? 'status-warning' : '')}`}>
                      {provider.enabled ? '已启用' : (provider.configured ? '已配置' : '未配置')}
                    </span>
                  </div>

                  <ChannelSwitch
                    checked={draft.enabled}
                    disabled={!canUpdate || busy}
                    hint={presentation.enableHint}
                    onChange={(value) => updateDraft(provider.id, 'enabled', value)}
                  />

                  <label className="notification-secret-field">
                    <span><b>{presentation.targetLabel}</b><small>{provider.has_webhook ? presentation.targetSaved : '尚未保存'}</small></span>
                    <input
                      className="field w-full"
                      type="text"
                      value={draft.webhook}
                      maxLength={2000}
                      disabled={!canUpdate || busy}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={provider.has_webhook ? '留空保留现有配置' : presentation.targetHint}
                      onChange={(event) => updateDraft(provider.id, 'webhook', event.target.value)}
                    />
                  </label>

                  {provider.supports_signing_secret ? (
                    <label className="notification-secret-field">
                      <span><b>签名校验密钥（可选）</b><small>{provider.has_secret ? '已安全保存；留空表示不替换' : '机器人未启用签名时可留空'}</small></span>
                      <input
                        className="field w-full"
                        type="password"
                        value={draft.secret}
                        maxLength={1000}
                        disabled={!canUpdate || busy}
                        autoComplete="new-password"
                        placeholder={provider.has_secret ? '留空保留现有签名密钥' : '飞书机器人签名密钥'}
                        onChange={(event) => updateDraft(provider.id, 'secret', event.target.value)}
                      />
                    </label>
                  ) : null}

                  <div className="notification-provider-meta">
                    <span><i className="bi bi-shield-lock" />{provider.source === 'database' ? '后台加密配置' : '服务器环境配置'}</span>
                    {provider.updated_by ? <span>最近修改：{provider.updated_by}</span> : null}
                  </div>

                  {!canUpdate ? <div className="info-callout"><i className="bi bi-eye" /><span>{canTest ? '当前没有修改配置的权限；仍可向已保存渠道发送固定测试消息。' : '当前只能查看脱敏状态，没有修改或测试提醒配置的权限。'}</span></div> : null}

                  <div className="notification-provider-actions">
                    {canUpdate && provider.configured ? (
                      <button className="btn btn-danger btn-sm" type="button" disabled={busy} onClick={() => setClearProvider(provider)}>
                        <i className="bi bi-trash3" />清除
                      </button>
                    ) : <span />}
                    <div>
                      {canTest ? (
                        <button className="btn btn-outline" type="button" disabled={busy || !provider.configured} onClick={() => sendTest(provider)} title={provider.configured ? '发送固定安全测试消息' : '请先保存配置'}>
                          <i className={`bi ${testingProvider === provider.id ? 'bi-arrow-clockwise admin-spin' : 'bi-send'}`} />{testingProvider === provider.id ? '发送中' : '发送测试'}
                        </button>
                      ) : null}
                      {canUpdate ? (
                        <button className="btn btn-primary" type="button" disabled={busy || !canSave} onClick={() => save(provider)}>
                          <i className="bi bi-check-circle" />{savingProvider === provider.id ? '保存中' : '保存设置'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </section>
              )
            })}
          </div>

          <section className="notification-channel-notes">
            <div><i className="bi bi-chat-dots" /><span><b>QQ</b><small>普通 QQ 群暂无稳定的官方通用 Webhook，需要合规机器人或中继服务后再接入。</small></span></div>
            <div><i className="bi bi-chat-dots" /><span><b>个人微信</b><small>个人微信群不提供官方群机器人 Webhook；企业微信请使用上方企业微信群机器人。</small></span></div>
            <a href="https://github.com/ZONGRUICHD/Campus-Wall-For-GuanLan/blob/main/docs/NOTIFICATION_INTEGRATION.md" target="_blank" rel="noreferrer">查看完整接入文档 <i className="bi bi-arrow-up-right" /></a>
          </section>

          <div className="settings-security-note"><i className="bi bi-shield-lock" /><span>测试按钮只发送服务器生成的固定内容，不会把帖子正文、用户身份、联系方式、Webhook 或密钥写入页面、日志与审计记录。</span></div>
        </div>
      ) : null}

      <Modal
        visible={Boolean(clearProvider)}
        title={`清除${clearProvider?.label || ''}配置`}
        onClose={() => savingProvider ? null : setClearProvider(null)}
        width="480px"
        footer={(
          <>
            <button className="btn btn-outline" type="button" disabled={Boolean(savingProvider)} onClick={() => setClearProvider(null)}>取消</button>
            <button className="btn btn-danger" type="button" disabled={Boolean(savingProvider)} onClick={confirmClear}><i className="bi bi-trash3" />确认清除</button>
          </>
        )}
      >
        <p className="leading-relaxed text-[var(--text-secondary)]">该渠道会立即停用，已保存的收件信息将被清除。之后如需恢复，必须重新填写。</p>
      </Modal>
    </AdminShell>
  )
}
