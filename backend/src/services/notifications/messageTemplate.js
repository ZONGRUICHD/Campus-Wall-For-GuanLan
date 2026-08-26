import { normalizeModerationScope } from '../contentCategories.js'

export const safeNotificationText = (value, maxLength = 160) => String(value || '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLength)

export const notificationScopeForPayload = (payload = {}) => {
  if (payload.moderation_scope) return payload.moderation_scope
  return payload.category === '表白墙便签' ? 'confessions' : 'posts'
}

export const reviewHeadline = (payload, batchCount) => {
  const scope = normalizeModerationScope(notificationScopeForPayload(payload))
  if (scope === 'confessions') return batchCount > 1 ? `表白墙新增 ${batchCount} 张待审核便签` : '表白墙有新便签待审核'
  if (scope === 'posts') return batchCount > 1 ? `校园墙新增 ${batchCount} 条待审核帖子` : '校园墙有新帖子待审核'
  return batchCount > 1 ? `校园墙新增 ${batchCount} 条待审核内容` : '校园墙有新内容待审核'
}

export const reviewEntryLabel = (payload) => {
  const scope = normalizeModerationScope(notificationScopeForPayload(payload))
  if (scope === 'confessions') return '进入表白墙审核'
  if (scope === 'posts') return '进入帖子审核'
  return '进入审核后台'
}

export const notificationDetailLines = (payload, pendingCount, batchCount = 1) => {
  const scope = normalizeModerationScope(notificationScopeForPayload(payload))
  const idLabel = scope === 'confessions' ? '便签编号' : (scope === 'posts' ? '帖子编号' : '内容编号')
  const measureWord = scope === 'confessions' ? '张' : '条'
  const details = batchCount > 1
    ? [
        `本批新增：${batchCount} ${measureWord}`,
        `${idLabel}：${(payload.message_ids || []).map((id) => `#${id}`).join('、')}${batchCount > (payload.message_ids || []).length ? ' 等' : ''}`,
        `内容类型：${payload.category}`,
        `全站当前待审：${pendingCount} 条`
      ]
    : [
        `${idLabel}：#${payload.message_id}`,
        `内容类型：${payload.category}`,
        `提交时间：${payload.submitted_at || '刚刚'}`,
        `全站当前待审：${pendingCount} 条`
      ]
  if (payload.attachment_count) details.push(`附件：${payload.attachment_count} 个（请在后台鉴权查看）`)
  if (payload.has_poll) details.push('附带投票')
  details.push('为保护校园隐私，群提醒不包含正文、发布者身份或联系方式。')
  return details
}
