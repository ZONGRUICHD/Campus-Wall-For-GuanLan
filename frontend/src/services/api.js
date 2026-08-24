const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || ''
const REQUEST_TIMEOUT_MS = 30000
let cachedAdmin

const buildUrl = (path, params) => {
  const base = API_BASE_URL.replace(/\/$/, '')
  const pathname = path.startsWith('/') ? path : `/${path}`
  const url = `${base}${pathname}`

  if (!params || Object.keys(params).length === 0) return url

  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== '') searchParams.append(key, item)
      })
      return
    }
    searchParams.append(key, value)
  })

  const query = searchParams.toString()
  return query ? `${url}?${query}` : url
}

const isFormData = (value) => typeof FormData !== 'undefined' && value instanceof FormData

const parseResponse = async (response) => {
  if (response.status === 204) return null
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return response.json()
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const request = async (method, path, { params, data, headers } = {}) => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const requestHeaders = new Headers(headers || {})

  let body
  if (data !== undefined && data !== null && method !== 'GET') {
    if (isFormData(data)) {
      requestHeaders.delete('Content-Type')
      body = data
    } else {
      requestHeaders.set('Content-Type', requestHeaders.get('Content-Type') || 'application/json')
      body = JSON.stringify(data)
    }
  }

  try {
    const response = await fetch(buildUrl(path, params), {
      method,
      headers: requestHeaders,
      body,
      credentials: 'include',
      signal: controller.signal
    })
    const responseData = await parseResponse(response)

    if (!response.ok) {
      throw new Error(responseData?.error || responseData?.message || '请求失败')
    }

    return {
      data: responseData,
      status: response.status,
      headers: response.headers
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('请求超时，请稍后再试')
    if (error instanceof TypeError) throw new Error('网络连接失败，请检查网络设置')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

const http = {
  get(path, options = {}) {
    return request('GET', path, options)
  },
  post(path, data, options = {}) {
    return request('POST', path, { ...options, data })
  },
  put(path, data, options = {}) {
    return request('PUT', path, { ...options, data })
  },
  delete(path, data, options = {}) {
    return request('DELETE', path, { ...options, data })
  }
}

const toMessageFormData = (data) => {
  const formData = new FormData()
  if (data.text) formData.append('text', data.text)
  if (data.tags) formData.append('tags', data.tags)
  if (data.anonymous !== undefined) formData.append('anonymous', data.anonymous ? 'true' : 'false')
  if (data.pollQuestion) formData.append('poll_question', data.pollQuestion)
  if (Array.isArray(data.pollOptions)) {
    data.pollOptions.forEach((option) => formData.append('poll_options', option))
  }
  if (data.pollClosesAt) formData.append('poll_closes_at', data.pollClosesAt)
  if (Array.isArray(data.filenames)) {
    data.filenames.forEach((filename) => formData.append('filenames', filename))
  }
  return formData
}

const toAppFormData = (data = {}) => {
  const formData = new FormData()
  formData.append('name', data.name || '')
  formData.append('slug', data.slug || '')
  formData.append('author', data.author || '')
  formData.append('description', data.description || '')
  formData.append('partition', data.partition || '')
  formData.append('url', data.url || '')
  formData.append('icon_background', data.iconBackground || data.icon_background || '')
  formData.append('status', data.status || 'published')
  formData.append('sort_order', data.sortOrder ?? data.sort_order ?? 0)
  if (data.icon instanceof File) formData.append('icon', data.icon)
  return formData
}

const api = {
  getMessages(params) {
    return http.get('/api/get_messages', { params })
  },
  getHotMessages() {
    return http.post('/api/get_hot_messages')
  },
  getMessageDetail(id) {
    return http.post(`/api/get_message_details/${id}`)
  },
  getMessagePartitions(id) {
    return http.post(`/api/get_message_partitions/${id}`)
  },
  submitMessage(data) {
    return http.post('/api/wall/submit', toMessageFormData(data))
  },
  likeMessage(id) {
    return http.post(`/api/wall/like/${id}`)
  },
  dislikeMessage(id) {
    return http.post(`/api/wall/dislike/${id}`)
  },
  votePoll(id, optionId) {
    return http.post(`/api/wall/poll/${id}/vote`, { option_id: optionId })
  },
  commentMessage(id, data) {
    const formData = new FormData()
    formData.append('text', data.text || '')
    if (data.refer) formData.append('refer', data.refer)
    if (data.refer_id) formData.append('refer_id', data.refer_id)
    if (Array.isArray(data.files)) data.files.forEach((file) => formData.append('file', file))
    return http.post(`/api/wall/comment/${id}`, formData)
  },
  chunkedUpload(formData) {
    return http.post('/api/chunked_upload', formData)
  },
  mergeChunks(data) {
    return http.post('/api/merge_chunks', data)
  },
  directUpload(formData) {
    return http.post('/api/direct_upload', formData)
  },
  getTags() {
    return http.post('/api/get_tags')
  },
  getPartitionMessages(partition) {
    return http.post('/api/get_partition_messages', { partition })
  },
  getNotice() {
    return http.post('/api/notice')
  },
  getApps() {
    return http.post('/api/apps')
  },
  getCommunityConfig() {
    return http.get('/api/community/config')
  },
  submitHelp(data) {
    const formData = new FormData()
    formData.append('category', data.category || 'other')
    formData.append('title', data.title || '')
    formData.append('email', data.email || '')
    formData.append('text', data.text || '')
    return http.post('/api/help/form', formData)
  },
  getHelpStatus(ticketId) {
    return http.get(`/api/help/status/${encodeURIComponent(ticketId)}`)
  },
  getReportStatus(reportId) {
    return http.get(`/api/help/report/status/${encodeURIComponent(reportId)}`)
  },
  submitReport(messageId, data) {
    const formData = new FormData()
    formData.append('text', data.text || '')
    formData.append('email', data.email || '')
    formData.append('category', data.category || 'other')
    return http.post(`/api/help/report/${messageId}`, formData)
  },
  submitCommentReport(messageId, commentId, data) {
    const formData = new FormData()
    formData.append('text', data.text || '')
    formData.append('email', data.email || '')
    formData.append('category', data.category || 'other')
    return http.post(`/api/help/report/${messageId}/comment/${encodeURIComponent(commentId)}`, formData)
  },
  getCaptchaConfig() {
    return http.get('/api/user/captcha/config')
  },
  userLogin(data) {
    const formData = new FormData()
    formData.append('username', data.username || '')
    formData.append('password', data.password || '')
    formData.append('captcha_token', data.captcha_token || '')
    return http.post('/api/user/login', formData)
  },
  userLogout() {
    return http.post('/api/user/logout')
  },
  userMe() {
    return http.get('/api/user/me')
  },
  userSession() {
    return http.get('/api/user/session')
  },
  userUpdateProfile(data) {
    const formData = new FormData()
    formData.append('nickname', data.nickname || '')
    formData.append('gender', data.gender ?? 0)
    formData.append('bio', data.bio || '')
    return http.put('/api/user/me/profile', formData)
  },
  userChangePassword(data) {
    const formData = new FormData()
    formData.append('current_password', data.current_password || '')
    formData.append('new_password', data.new_password || '')
    return http.post('/api/user/me/password', formData)
  },
  userUploadAvatar(file) {
    const formData = new FormData()
    formData.append('avatar', file)
    return http.post('/api/user/me/avatar', formData)
  },
  userFavoriteIds() {
    return http.get('/api/user/me/favorites/ids')
  },
  userFavorites(params = {}) {
    return http.get('/api/user/me/favorites', { params })
  },
  userFavoriteMessage(messageId) {
    return http.post(`/api/user/me/favorites/${messageId}`)
  },
  userUnfavoriteMessage(messageId) {
    return http.delete(`/api/user/me/favorites/${messageId}`)
  },
  userMessages(params = {}) {
    return http.get('/api/user/me/messages', { params })
  },
  userUpdateMessage(messageId, data) {
    const formData = new FormData()
    formData.append('text', data.text || '')
    formData.append('tags', data.tags || '')
    formData.append('anonymous', String(data.anonymous !== false))
    return http.put(`/api/user/me/messages/${messageId}`, formData)
  },
  userDeleteMessage(messageId) {
    return http.delete(`/api/user/me/messages/${messageId}`)
  },
  userDeleteComment(messageId, commentId) {
    return http.delete(`/api/user/me/comments/${messageId}/${encodeURIComponent(commentId)}`)
  },
  userComments(params = {}) {
    return http.get('/api/user/me/comments', { params })
  },
  userNotificationUnreadCount() {
    return http.get('/api/user/me/notifications/unread-count')
  },
  userNotifications(params = {}) {
    return http.get('/api/user/me/notifications', { params })
  },
  userMarkNotificationRead(notificationId) {
    return http.post(`/api/user/me/notifications/${notificationId}/read`)
  },
  userMarkAllNotificationsRead() {
    return http.post('/api/user/me/notifications/read-all')
  },
  userDeleteNotification(notificationId) {
    return http.delete(`/api/user/me/notifications/${notificationId}`)
  },
  userClearNotifications() {
    return http.delete('/api/user/me/notifications')
  },
  getUserProfile(userId) {
    return http.get(`/api/user/${userId}/profile`)
  },
  getUserMessages(userId) {
    return http.get(`/api/user/${userId}/messages`)
  },
  adminLogin(data) {
    const formData = new FormData()
    formData.append('username', data.username || '')
    formData.append('password', data.password || '')
    cachedAdmin = undefined
    return http.post('/api/admin/login', formData).then((response) => {
      cachedAdmin = response.data?.success ? response.data.admin || null : null
      return response
    })
  },
  adminLogout() {
    cachedAdmin = null
    return http.post('/api/admin/logout')
  },
  adminVerify() {
    return http.get('/api/admin/verify').then((response) => {
      cachedAdmin = response.data?.success ? response.data.admin || null : null
      return response
    }, (error) => {
      cachedAdmin = null
      throw error
    })
  },
  adminGetCachedAdmin() {
    return cachedAdmin
  },
  adminGetDashboardStats() {
    return http.get('/api/admin/dashboard/stats')
  },
  adminGetManagers() {
    return http.get('/api/admin/managers')
  },
  adminCreateManager(data) {
    return http.post('/api/admin/managers', data)
  },
  adminUpdateManager(username, data) {
    return http.put(`/api/admin/managers/${encodeURIComponent(username)}`, data)
  },
  adminResetManagerPassword(username, password) {
    return http.post(`/api/admin/managers/${encodeURIComponent(username)}/reset_password`, { password })
  },
  adminChangeOwnPassword(data) {
    return http.post('/api/admin/managers/me/password', data)
  },
  adminGetCaptchaSettings() {
    return http.get('/api/admin/settings/captcha')
  },
  adminUpdateCaptchaSettings(data) {
    return http.put('/api/admin/settings/captcha', data)
  },
  adminGetCommunitySettings() {
    return http.get('/api/admin/settings/community')
  },
  adminUpdateCommunitySettings(data) {
    return http.put('/api/admin/settings/community', data)
  },
  adminGetMessages(params = {}) {
    return http.get('/api/admin/api/messages', { params })
  },
  adminGetMessage(messageId) {
    return http.get(`/api/admin/api/get_message/${messageId}`)
  },
  adminDeleteMessage(messageId) {
    return http.post(`/api/admin/delete_message/${messageId}`)
  },
  adminDeleteComment(messageId, commentId) {
    return http.post(`/api/admin/api/delete_comment/${messageId}/${commentId}`)
  },
  adminGetComments(params = {}) {
    return http.get('/api/admin/comments', { params })
  },
  adminUpdateCommentModeration(messageId, commentId, data) {
    return http.post(`/api/admin/comments/${messageId}/${encodeURIComponent(commentId)}/moderation`, data)
  },
  adminBulkModerateComments(data) {
    return http.post('/api/admin/comments/bulk-moderation', data)
  },
  adminApproveMessage(messageId) {
    return http.post(`/api/admin/approve_message/${messageId}`)
  },
  adminReviewMessage(messageId, action) {
    return http.post(`/api/admin/messages/${messageId}/review`, { action })
  },
  adminBulkModerateMessages(data) {
    return http.post('/api/admin/messages/bulk-moderation', data)
  },
  adminUpdateMessageModeration(messageId, data) {
    return http.post(`/api/admin/messages/${messageId}/moderation`, data)
  },
  adminRepairMessage(messageId) {
    return http.post(`/api/admin/repair_message/${messageId}`)
  },
  adminGetApprovedIds() {
    return http.get('/api/admin/api/approved_ids')
  },
  adminGetNotice() {
    return http.get('/api/admin/notice')
  },
  adminPostNotice(text) {
    const formData = new FormData()
    formData.append('text', text || '')
    return http.post('/api/admin/notice', formData)
  },
  adminUpdateNotice(noticeId, text) {
    const formData = new FormData()
    formData.append('text', text || '')
    return http.put(`/api/admin/notice/${noticeId}`, formData)
  },
  adminDeleteNotice(noticeId) {
    return http.delete(`/api/admin/notice/${noticeId}`)
  },
  adminGetReport() {
    return http.get('/api/admin/report')
  },
  adminGetReportHistory(params = {}) {
    return http.get('/api/admin/reports/history', { params })
  },
  adminGetFeedback(params = {}) {
    return http.get('/api/admin/feedback', { params })
  },
  adminUpdateFeedback(ticketId, data) {
    return http.put(`/api/admin/feedback/${encodeURIComponent(ticketId)}`, data)
  },
  adminDeleteReport(messageId, reportId) {
    return http.post(`/api/admin/api/delete_report/${messageId}/${reportId}`)
  },
  adminResolveReport(messageId, reportId, action, publicReply = '') {
    return http.post(`/api/admin/reports/${messageId}/${reportId}/resolve`, {
      action,
      public_reply: publicReply
    })
  },
  adminGetLog(search = '') {
    return http.get('/api/admin/log', { params: { search } })
  },
  adminGetAdminLog(search = '') {
    return http.get('/api/admin/admin_log', { params: { search } })
  },
  adminGetAudit(params = {}) {
    return http.get('/api/admin/audit', { params })
  },
  adminGetTrash(params = {}) {
    return http.get('/api/admin/trash', { params })
  },
  adminRestoreTrashMessage(messageId) {
    return http.post(`/api/admin/trash/messages/${messageId}/restore`, {})
  },
  adminPurgeTrashMessage(messageId) {
    return http.delete(`/api/admin/trash/messages/${messageId}`, { confirm: 'PURGE' })
  },
  adminRestoreTrashComment(messageId, commentId) {
    return http.post(`/api/admin/trash/comments/${messageId}/${encodeURIComponent(commentId)}/restore`, {})
  },
  adminPurgeTrashComment(messageId, commentId) {
    return http.delete(`/api/admin/trash/comments/${messageId}/${encodeURIComponent(commentId)}`, { confirm: 'PURGE' })
  },
  adminBulkTrash(data) {
    return http.post('/api/admin/trash/bulk', data)
  },
  adminGetUsers(params = {}) {
    return http.get('/api/admin/users', { params })
  },
  adminGetUserStats() {
    return http.get('/api/admin/users/stats')
  },
  adminGetApps(params = {}) {
    return http.get('/api/admin/apps', { params })
  },
  adminGetAppStats() {
    return http.get('/api/admin/apps/stats')
  },
  adminCreateApp(data) {
    return http.post('/api/admin/apps', toAppFormData(data))
  },
  adminUpdateApp(appId, data) {
    return http.put(`/api/admin/apps/${appId}`, toAppFormData(data))
  },
  adminHideApp(appId) {
    return http.post(`/api/admin/apps/${appId}/hide`)
  },
  adminRestoreApp(appId) {
    return http.post(`/api/admin/apps/${appId}/restore`)
  },
  adminDeleteApp(appId) {
    return http.delete(`/api/admin/apps/${appId}`)
  },
  adminImportUsers(file) {
    const formData = new FormData()
    formData.append('file', file)
    return http.post('/api/admin/users/import', formData)
  },
  adminUpdateUser(userId, data) {
    const formData = new FormData()
    formData.append('real_name', data.real_name || '')
    formData.append('nickname', data.nickname || '')
    formData.append('gender', data.gender ?? 0)
    formData.append('bio', data.bio || '')
    formData.append('status', data.status || 'active')
    return http.put(`/api/admin/users/${userId}`, formData)
  },
  adminMuteUser(userId, data) {
    const formData = new FormData()
    formData.append('muted_until', data.muted_until || '')
    formData.append('reason', data.reason || '')
    return http.post(`/api/admin/users/${userId}/mute`, formData)
  },
  adminUnmuteUser(userId) {
    return http.post(`/api/admin/users/${userId}/unmute`)
  },
  adminDisableUser(userId) {
    return http.post(`/api/admin/users/${userId}/disable`)
  },
  adminResetUserPassword(userId, password) {
    const formData = new FormData()
    formData.append('password', password || '')
    return http.post(`/api/admin/users/${userId}/reset_password`, formData)
  }
}

export default api
