import { emailWebhookProvider } from './providers/emailWebhook.js'
import { feishuWebhookProvider } from './providers/feishuWebhook.js'
import { wecomWebhookProvider } from './providers/wecomWebhook.js'

const providerMethods = Object.freeze(['readConfig', 'validateTarget', 'buildMessage', 'classifyResponse'])

export const createNotificationProviderRegistry = (providerList = []) => {
  const registry = new Map()
  for (const provider of providerList) {
    const id = String(provider?.id || '').trim().toLowerCase()
    if (!/^[a-z][a-z0-9_-]{1,47}$/.test(id)) throw new TypeError('Notification provider has an invalid id')
    if (registry.has(id)) throw new TypeError(`Duplicate notification provider: ${id}`)
    if (!String(provider?.label || '').trim() || !provider?.capabilities || !Number.isFinite(provider?.minIntervalMs)) {
      throw new TypeError(`Notification provider ${id} has an incomplete descriptor`)
    }
    for (const method of providerMethods) {
      if (typeof provider[method] !== 'function') throw new TypeError(`Notification provider ${id} is missing ${method}`)
    }
    registry.set(id, provider)
  }
  return registry
}

const providers = createNotificationProviderRegistry([
  feishuWebhookProvider,
  wecomWebhookProvider,
  emailWebhookProvider
])

export const getNotificationProvider = (providerId) => providers.get(String(providerId || '').trim().toLowerCase()) || null

export const listNotificationProviders = () => [...providers.values()]

export const notificationProviderManifest = () => listNotificationProviders().map((provider) => ({
  id: provider.id,
  label: provider.label,
  description: String(provider.description || '消息提醒渠道'),
  capabilities: { ...provider.capabilities },
  min_interval_ms: provider.minIntervalMs
}))

export const validateNotificationTarget = ({ provider, ...target } = {}) => {
  const adapter = getNotificationProvider(provider)
  if (!adapter) return { valid: false, reason: 'unsupported_provider' }
  return adapter.validateTarget(target)
}
