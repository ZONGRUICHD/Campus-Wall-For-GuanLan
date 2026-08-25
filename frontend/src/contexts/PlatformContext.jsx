import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api from '../services/api'

const defaultRules = [
  '尊重他人，不发布人身攻击、歧视、骚扰或恶意曝光隐私的内容。',
  '不发布违法违规、低俗色情、诈骗、恶意广告或虚假信息。',
  '涉及失物招领、求助和校园通知时，请尽量提供可核实的信息。',
  '匿名不代表免责，请为自己的表达负责，共同维护友善的校园社区。'
].join('\n')

export const defaultCommunity = Object.freeze({
  posting_enabled: true,
  commenting_enabled: true,
  guest_posting_enabled: true,
  guest_commenting_enabled: true,
  require_post_approval: false,
  pause_reason: '',
  community_rules: defaultRules,
  source: 'default',
  updated_at: null,
  server_time: null,
  server_timezone: 'Asia/Shanghai',
  site_launched_at: '2026-08-24T17:48:50.000Z'
})

const PlatformContext = createContext(null)

export function PlatformProvider({ children }) {
  const [community, setCommunity] = useState(defaultCommunity)
  const [loading, setLoading] = useState(true)

  const refreshCommunity = useCallback(async () => {
    try {
      const response = await api.getCommunityConfig()
      const next = response.data?.community
      if (next) setCommunity({ ...defaultCommunity, ...next })
      return next || defaultCommunity
    } catch {
      return defaultCommunity
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshCommunity()
  }, [])

  const value = useMemo(() => ({ community, loading, refreshCommunity }), [community, loading, refreshCommunity])
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>
}

export function usePlatform() {
  const value = useContext(PlatformContext)
  if (!value) throw new Error('usePlatform must be used inside PlatformProvider')
  return value
}
