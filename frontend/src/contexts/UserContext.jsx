import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api from '../services/api'

const UserContext = createContext(null)

export function UserProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [favoriteIds, setFavoriteIds] = useState(() => new Set())
  const [notificationUnread, setNotificationUnread] = useState(0)

  const refreshFavorites = useCallback(async () => {
    try {
      const response = await api.userFavoriteIds()
      const ids = new Set((response.data?.ids || []).map(Number))
      setFavoriteIds(ids)
      return ids
    } catch {
      setFavoriteIds(new Set())
      return new Set()
    }
  }, [])

  const refreshNotificationCount = useCallback(async () => {
    try {
      const response = await api.userNotificationUnreadCount()
      const unread = Math.max(0, Number(response.data?.unread) || 0)
      setNotificationUnread(unread)
      return unread
    } catch {
      setNotificationUnread(0)
      return 0
    }
  }, [])

  const refreshMe = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.userSession()
      const nextUser = response.data?.user || null
      setUser(nextUser)
      if (nextUser) await Promise.all([refreshFavorites(), refreshNotificationCount()])
      else {
        setFavoriteIds(new Set())
        setNotificationUnread(0)
      }
      return nextUser
    } catch {
      setUser(null)
      setFavoriteIds(new Set())
      setNotificationUnread(0)
      return null
    } finally {
      setLoading(false)
    }
  }, [refreshFavorites, refreshNotificationCount])

  useEffect(() => {
    refreshMe()
  }, [refreshMe])

  const login = useCallback(async (credentials) => {
    const response = await api.userLogin(credentials)
    const nextUser = response.data?.user || null
    setUser(nextUser)
    if (nextUser) await Promise.all([refreshFavorites(), refreshNotificationCount()])
    return nextUser
  }, [refreshFavorites, refreshNotificationCount])

  const logout = useCallback(async () => {
    try {
      await api.userLogout()
    } finally {
      setUser(null)
      setFavoriteIds(new Set())
      setNotificationUnread(0)
    }
  }, [])

  const isFavorite = useCallback((messageId) => favoriteIds.has(Number(messageId)), [favoriteIds])
  const hasCapability = useCallback(
    (capability) => Array.isArray(user?.capabilities) && user.capabilities.includes(String(capability || '')),
    [user]
  )

  const toggleFavorite = useCallback(async (messageId) => {
    if (!user) throw new Error('登录后才能收藏留言')
    const id = Number(messageId)
    const favorited = favoriteIds.has(id)
    if (favorited) await api.userUnfavoriteMessage(id)
    else await api.userFavoriteMessage(id)
    setFavoriteIds((current) => {
      const next = new Set(current)
      if (favorited) next.delete(id)
      else next.add(id)
      return next
    })
    return !favorited
  }, [favoriteIds, user])

  useEffect(() => {
    if (!user) return undefined
    const timer = window.setInterval(refreshNotificationCount, 60000)
    return () => window.clearInterval(timer)
  }, [refreshNotificationCount, user])

  const value = useMemo(() => ({
    user,
    loading,
    login,
    logout,
    refreshMe,
    setUser,
    hasCapability,
    favoriteIds,
    isFavorite,
    toggleFavorite,
    refreshFavorites,
    notificationUnread,
    setNotificationUnread,
    refreshNotificationCount
  }), [user, loading, login, logout, refreshMe, hasCapability, favoriteIds, isFavorite, toggleFavorite, refreshFavorites, notificationUnread, refreshNotificationCount])

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

export function useUser() {
  const value = useContext(UserContext)
  if (!value) throw new Error('useUser must be used inside UserProvider')
  return value
}
