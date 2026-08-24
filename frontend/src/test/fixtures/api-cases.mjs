const messageId = 7000001
const commentId = 'comment-1'
const userId = 42
const notificationId = 81
const username = 'root-admin'
const appId = '123e4567-e89b-12d3-a456-426614174000'
const noticeId = 'notice-1'
const ticketId = '0123456789abcdef0123456789abcdef'
const reportId = '11111111111111111111111111111111'

const define = (
  name,
  method,
  openapiPath,
  requestPath = openapiPath,
  args = () => [],
  query = null
) => ({ name, method, openapiPath, requestPath, args, query })

const formData = () => {
  const data = new FormData()
  data.append('field', 'value')
  return data
}

const profile = {
  nickname: 'Nickname',
  gender: 0,
  bio: 'Bio'
}

const app = {
  name: 'Test app',
  slug: 'test-app',
  author: 'Test author',
  description: 'Description',
  partition: 'tools',
  url: 'https://example.test/app',
  iconBackground: '',
  status: 'published',
  sortOrder: 1
}

export const frontendApiCases = [
  define('getMessages', 'GET', '/api/get_messages', '/api/get_messages', () => [{
    start: 0,
    end: 15,
    s: 'likes',
    ignored: ''
  }], { start: '0', end: '15', s: 'likes' }),
  define('getHotMessages', 'POST', '/api/get_hot_messages'),
  define('getMessageDetail', 'POST', '/api/get_message_details/{messageId}', `/api/get_message_details/${messageId}`, () => [messageId]),
  define('getMessagePartitions', 'POST', '/api/get_message_partitions/{messageId}', `/api/get_message_partitions/${messageId}`, () => [messageId]),
  define('submitMessage', 'POST', '/api/wall/submit', '/api/wall/submit', () => [{
    text: 'Message',
    tags: 'campus',
    anonymous: true,
    pollQuestion: 'Question',
    pollOptions: ['A', 'B'],
    filenames: ['file.txt']
  }]),
  define('likeMessage', 'POST', '/api/wall/like/{messageId}', `/api/wall/like/${messageId}`, () => [messageId]),
  define('dislikeMessage', 'POST', '/api/wall/dislike/{messageId}', `/api/wall/dislike/${messageId}`, () => [messageId]),
  define('votePoll', 'POST', '/api/wall/poll/{messageId}/vote', `/api/wall/poll/${messageId}/vote`, () => [messageId, 'option-1']),
  define('commentMessage', 'POST', '/api/wall/comment/{messageId}', `/api/wall/comment/${messageId}`, () => [messageId, {
    text: 'Comment',
    refer: 'Quoted text',
    refer_id: commentId,
    files: [new Blob(['file'], { type: 'text/plain' })]
  }]),
  define('chunkedUpload', 'POST', '/api/chunked_upload', '/api/chunked_upload', () => [formData()]),
  define('mergeChunks', 'POST', '/api/merge_chunks', '/api/merge_chunks', () => [{
    fileKey: 'file-key',
    totalChunks: 1,
    originalName: 'file.txt'
  }]),
  define('directUpload', 'POST', '/api/direct_upload', '/api/direct_upload', () => [formData()]),
  define('getTags', 'POST', '/api/get_tags'),
  define('getPartitionMessages', 'POST', '/api/get_partition_messages', '/api/get_partition_messages', () => ['campus']),
  define('getNotice', 'POST', '/api/notice'),
  define('getApps', 'POST', '/api/apps'),
  define('getCommunityConfig', 'GET', '/api/community/config'),
  define('submitHelp', 'POST', '/api/help/form', '/api/help/form', () => [{
    category: 'bug',
    title: 'Issue',
    email: 'student@example.test',
    text: 'Details'
  }]),
  define('getHelpStatus', 'GET', '/api/help/status/{ticketId}', `/api/help/status/${ticketId}`, () => [ticketId]),
  define('getReportStatus', 'GET', '/api/help/report/status/{reportId}', `/api/help/report/status/${reportId}`, () => [reportId]),
  define('submitReport', 'POST', '/api/help/report/{messageId}', `/api/help/report/${messageId}`, () => [messageId, {
    text: 'Reason',
    email: 'student@example.test',
    category: 'spam'
  }]),
  define('submitCommentReport', 'POST', '/api/help/report/{messageId}/comment/{commentId}', `/api/help/report/${messageId}/comment/${commentId}`, () => [messageId, commentId, {
    text: 'Reason',
    email: 'student@example.test',
    category: 'abuse'
  }]),
  define('getCaptchaConfig', 'GET', '/api/user/captcha/config'),
  define('userLogin', 'POST', '/api/user/login', '/api/user/login', () => [{
    username: '20260042',
    password: 'student-password',
    captcha_token: ''
  }]),
  define('userLogout', 'POST', '/api/user/logout'),
  define('userMe', 'GET', '/api/user/me'),
  define('userSession', 'GET', '/api/user/session'),
  define('userUpdateProfile', 'PUT', '/api/user/me/profile', '/api/user/me/profile', () => [profile]),
  define('userChangePassword', 'POST', '/api/user/me/password', '/api/user/me/password', () => [{
    current_password: 'old-password',
    new_password: 'new-password'
  }]),
  define('userUploadAvatar', 'POST', '/api/user/me/avatar', '/api/user/me/avatar', () => [
    new Blob(['avatar'], { type: 'image/png' })
  ]),
  define('userFavoriteIds', 'GET', '/api/user/me/favorites/ids'),
  define('userFavorites', 'GET', '/api/user/me/favorites', '/api/user/me/favorites', () => [{
    page: 2,
    page_size: 10
  }], { page: '2', page_size: '10' }),
  define('userFavoriteMessage', 'POST', '/api/user/me/favorites/{messageId}', `/api/user/me/favorites/${messageId}`, () => [messageId]),
  define('userUnfavoriteMessage', 'DELETE', '/api/user/me/favorites/{messageId}', `/api/user/me/favorites/${messageId}`, () => [messageId]),
  define('userMessages', 'GET', '/api/user/me/messages', '/api/user/me/messages', () => [{ page: 1 }], { page: '1' }),
  define('userUpdateMessage', 'PUT', '/api/user/me/messages/{messageId}', `/api/user/me/messages/${messageId}`, () => [messageId, {
    text: 'Updated',
    tags: 'campus',
    anonymous: false
  }]),
  define('userDeleteMessage', 'DELETE', '/api/user/me/messages/{messageId}', `/api/user/me/messages/${messageId}`, () => [messageId]),
  define('userDeleteComment', 'DELETE', '/api/user/me/comments/{messageId}/{commentId}', `/api/user/me/comments/${messageId}/${commentId}`, () => [messageId, commentId]),
  define('userComments', 'GET', '/api/user/me/comments', '/api/user/me/comments', () => [{ page: 3 }], { page: '3' }),
  define('userNotificationUnreadCount', 'GET', '/api/user/me/notifications/unread-count'),
  define('userNotifications', 'GET', '/api/user/me/notifications', '/api/user/me/notifications', () => [{ page: 2 }], { page: '2' }),
  define('userMarkNotificationRead', 'POST', '/api/user/me/notifications/{notificationId}/read', `/api/user/me/notifications/${notificationId}/read`, () => [notificationId]),
  define('userMarkAllNotificationsRead', 'POST', '/api/user/me/notifications/read-all'),
  define('userDeleteNotification', 'DELETE', '/api/user/me/notifications/{notificationId}', `/api/user/me/notifications/${notificationId}`, () => [notificationId]),
  define('userClearNotifications', 'DELETE', '/api/user/me/notifications'),
  define('getUserProfile', 'GET', '/api/user/{userId}/profile', `/api/user/${userId}/profile`, () => [userId]),
  define('getUserMessages', 'GET', '/api/user/{userId}/messages', `/api/user/${userId}/messages`, () => [userId]),
  define('adminLogin', 'POST', '/api/admin/login', '/api/admin/login', () => [{
    username,
    password: 'admin-password'
  }]),
  define('adminLogout', 'POST', '/api/admin/logout'),
  define('adminVerify', 'GET', '/api/admin/verify'),
  define('adminGetCachedAdmin', null, null, null),
  define('adminGetDashboardStats', 'GET', '/api/admin/dashboard/stats'),
  define('adminGetManagers', 'GET', '/api/admin/managers'),
  define('adminCreateManager', 'POST', '/api/admin/managers', '/api/admin/managers', () => [{
    username: 'new-admin',
    password: 'new-admin-password',
    permissions: ['manage_wall_message']
  }]),
  define('adminUpdateManager', 'PUT', '/api/admin/managers/{username}', `/api/admin/managers/${username}`, () => [username, {
    status: 'active',
    permissions: ['manage_admins']
  }]),
  define('adminResetManagerPassword', 'POST', '/api/admin/managers/{username}/reset_password', `/api/admin/managers/${username}/reset_password`, () => [username, 'replacement-password']),
  define('adminChangeOwnPassword', 'POST', '/api/admin/managers/me/password', '/api/admin/managers/me/password', () => [{
    current_password: 'old-password',
    new_password: 'new-password'
  }]),
  define('adminGetCaptchaSettings', 'GET', '/api/admin/settings/captcha'),
  define('adminUpdateCaptchaSettings', 'PUT', '/api/admin/settings/captcha', '/api/admin/settings/captcha', () => [{
    provider: 'none',
    enabled: false,
    site_key: '',
    secret_key: ''
  }]),
  define('adminGetCommunitySettings', 'GET', '/api/admin/settings/community'),
  define('adminUpdateCommunitySettings', 'PUT', '/api/admin/settings/community', '/api/admin/settings/community', () => [{
    posting_enabled: true,
    commenting_enabled: true,
    guest_posting_enabled: true,
    guest_commenting_enabled: true,
    require_post_approval: false,
    pause_reason: '',
    community_rules: 'Be kind.',
    sensitive_words: []
  }]),
  define('adminGetMessages', 'GET', '/api/admin/api/messages', '/api/admin/api/messages', () => [{
    status: 'pending',
    page: 1
  }], { status: 'pending', page: '1' }),
  define('adminGetMessage', 'GET', '/api/admin/api/get_message/{messageId}', `/api/admin/api/get_message/${messageId}`, () => [messageId]),
  define('adminDeleteMessage', 'POST', '/api/admin/delete_message/{messageId}', `/api/admin/delete_message/${messageId}`, () => [messageId]),
  define('adminDeleteComment', 'POST', '/api/admin/api/delete_comment/{messageId}/{commentId}', `/api/admin/api/delete_comment/${messageId}/${commentId}`, () => [messageId, commentId]),
  define('adminGetComments', 'GET', '/api/admin/comments', '/api/admin/comments', () => [{
    status: 'hidden',
    page: 1
  }], { status: 'hidden', page: '1' }),
  define('adminUpdateCommentModeration', 'POST', '/api/admin/comments/{messageId}/{commentId}/moderation', `/api/admin/comments/${messageId}/${commentId}/moderation`, () => [messageId, commentId, {
    hidden: true,
    reason: 'Reason'
  }]),
  define('adminBulkModerateComments', 'POST', '/api/admin/comments/bulk-moderation', '/api/admin/comments/bulk-moderation', () => [{
    targets: [{ message_id: messageId, comment_id: commentId }],
    hidden: true
  }]),
  define('adminApproveMessage', 'POST', '/api/admin/approve_message/{messageId}', `/api/admin/approve_message/${messageId}`, () => [messageId]),
  define('adminReviewMessage', 'POST', '/api/admin/messages/{messageId}/review', `/api/admin/messages/${messageId}/review`, () => [messageId, 'approve']),
  define('adminBulkModerateMessages', 'POST', '/api/admin/messages/bulk-moderation', '/api/admin/messages/bulk-moderation', () => [{
    message_ids: [messageId],
    action: 'approve'
  }]),
  define('adminUpdateMessageModeration', 'POST', '/api/admin/messages/{messageId}/moderation', `/api/admin/messages/${messageId}/moderation`, () => [messageId, {
    pinned: true
  }]),
  define('adminRepairMessage', 'POST', '/api/admin/repair_message/{messageId}', `/api/admin/repair_message/${messageId}`, () => [messageId]),
  define('adminGetApprovedIds', 'GET', '/api/admin/api/approved_ids'),
  define('adminGetNotice', 'GET', '/api/admin/notice'),
  define('adminPostNotice', 'POST', '/api/admin/notice', '/api/admin/notice', () => ['Notice']),
  define('adminUpdateNotice', 'PUT', '/api/admin/notice/{noticeId}', `/api/admin/notice/${noticeId}`, () => [noticeId, 'Updated notice']),
  define('adminDeleteNotice', 'DELETE', '/api/admin/notice/{noticeId}', `/api/admin/notice/${noticeId}`, () => [noticeId]),
  define('adminGetReport', 'GET', '/api/admin/report'),
  define('adminGetReportHistory', 'GET', '/api/admin/reports/history', '/api/admin/reports/history', () => [{
    page: 1,
    action: 'dismiss'
  }], { page: '1', action: 'dismiss' }),
  define('adminGetFeedback', 'GET', '/api/admin/feedback', '/api/admin/feedback', () => [{
    page: 1,
    status: 'pending'
  }], { page: '1', status: 'pending' }),
  define('adminUpdateFeedback', 'PUT', '/api/admin/feedback/{ticketId}', `/api/admin/feedback/${ticketId}`, () => [ticketId, {
    status: 'resolved',
    public_reply: 'Resolved'
  }]),
  define('adminDeleteReport', 'POST', '/api/admin/api/delete_report/{messageId}/{reportId}', `/api/admin/api/delete_report/${messageId}/${reportId}`, () => [messageId, reportId]),
  define('adminResolveReport', 'POST', '/api/admin/reports/{messageId}/{reportId}/resolve', `/api/admin/reports/${messageId}/${reportId}/resolve`, () => [messageId, reportId, 'dismiss', 'No violation']),
  define('adminGetLog', 'GET', '/api/admin/log', '/api/admin/log', () => ['error'], { search: 'error' }),
  define('adminGetAdminLog', 'GET', '/api/admin/admin_log', '/api/admin/admin_log', () => ['login'], { search: 'login' }),
  define('adminGetAudit', 'GET', '/api/admin/audit', '/api/admin/audit', () => [{ page: 2 }], { page: '2' }),
  define('adminGetTrash', 'GET', '/api/admin/trash', '/api/admin/trash', () => [{
    type: 'message',
    page: 1
  }], { type: 'message', page: '1' }),
  define('adminRestoreTrashMessage', 'POST', '/api/admin/trash/messages/{messageId}/restore', `/api/admin/trash/messages/${messageId}/restore`, () => [messageId]),
  define('adminPurgeTrashMessage', 'DELETE', '/api/admin/trash/messages/{messageId}', `/api/admin/trash/messages/${messageId}`, () => [messageId]),
  define('adminRestoreTrashComment', 'POST', '/api/admin/trash/comments/{messageId}/{commentId}/restore', `/api/admin/trash/comments/${messageId}/${commentId}/restore`, () => [messageId, commentId]),
  define('adminPurgeTrashComment', 'DELETE', '/api/admin/trash/comments/{messageId}/{commentId}', `/api/admin/trash/comments/${messageId}/${commentId}`, () => [messageId, commentId]),
  define('adminBulkTrash', 'POST', '/api/admin/trash/bulk', '/api/admin/trash/bulk', () => [{
    action: 'restore',
    targets: [{ type: 'message', message_id: messageId }]
  }]),
  define('adminGetUsers', 'GET', '/api/admin/users', '/api/admin/users', () => [{
    status: 'active',
    page: 1
  }], { status: 'active', page: '1' }),
  define('adminGetUserStats', 'GET', '/api/admin/users/stats'),
  define('adminGetApps', 'GET', '/api/admin/apps', '/api/admin/apps', () => [{ q: 'test' }], { q: 'test' }),
  define('adminGetAppStats', 'GET', '/api/admin/apps/stats'),
  define('adminCreateApp', 'POST', '/api/admin/apps', '/api/admin/apps', () => [app]),
  define('adminUpdateApp', 'PUT', '/api/admin/apps/{appId}', `/api/admin/apps/${appId}`, () => [appId, app]),
  define('adminHideApp', 'POST', '/api/admin/apps/{appId}/hide', `/api/admin/apps/${appId}/hide`, () => [appId]),
  define('adminRestoreApp', 'POST', '/api/admin/apps/{appId}/restore', `/api/admin/apps/${appId}/restore`, () => [appId]),
  define('adminDeleteApp', 'DELETE', '/api/admin/apps/{appId}', `/api/admin/apps/${appId}`, () => [appId]),
  define('adminImportUsers', 'POST', '/api/admin/users/import', '/api/admin/users/import', () => [
    new Blob(['xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  ]),
  define('adminUpdateUser', 'PUT', '/api/admin/users/{userId}', `/api/admin/users/${userId}`, () => [userId, {
    real_name: 'Private Name',
    nickname: 'Public Nickname',
    gender: 0,
    status: 'active'
  }]),
  define('adminMuteUser', 'POST', '/api/admin/users/{userId}/mute', `/api/admin/users/${userId}/mute`, () => [userId, {
    muted_until: '2026-08-25T00:00:00.000Z',
    reason: 'Reason'
  }]),
  define('adminUnmuteUser', 'POST', '/api/admin/users/{userId}/unmute', `/api/admin/users/${userId}/unmute`, () => [userId]),
  define('adminDisableUser', 'POST', '/api/admin/users/{userId}/disable', `/api/admin/users/${userId}/disable`, () => [userId]),
  define('adminResetUserPassword', 'POST', '/api/admin/users/{userId}/reset_password', `/api/admin/users/${userId}/reset_password`, () => [userId, 'replacement-password'])
]
