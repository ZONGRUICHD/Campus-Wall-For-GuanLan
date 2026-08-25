import dayjs from 'dayjs'
import { staticBaseUrl, toApiUrl } from '../services/urls'

export const staticUrl = staticBaseUrl

const fallbackAvatar = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="%232A5CAA"/><circle cx="64" cy="52" r="24" fill="white" opacity=".9"/><path d="M24 118c7-26 24-40 40-40s33 14 40 40" fill="white" opacity=".9"/></svg>'

export const anonymousUser = {
  id: 0,
  nickname: '匿名用户',
  description: '这是一条匿名发布的内容',
  gender: 0,
  avatar_url: toApiUrl('/api/user/0/avatar')
}

function safeFileName(file = '') {
  const cleaned = String(file || 'file').split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1F]/g, '_').trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'file'
  return encodeURIComponent(cleaned)
}

export function getAvatarUrl(userId = 0, avatarUrl = '') {
  return toApiUrl(avatarUrl || `/api/user/${userId || 0}/avatar`)
}

export function handleAvatarError(event) {
  event.currentTarget.src = fallbackAvatar
}

export function truncateText(text = '', maxLength = 120) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

export function getGenderClass(gender) {
  if (Number(gender) === 1) return 'male'
  if (Number(gender) === 2) return 'female'
  return 'unset'
}

export function getGenderIcon(gender) {
  if (Number(gender) === 1) return 'bi bi-gender-male'
  if (Number(gender) === 2) return 'bi bi-gender-female'
  return 'bi bi-gender-ambiguous'
}

export function genderText(gender) {
  if (Number(gender) === 1) return '男'
  if (Number(gender) === 2) return '女'
  return '未设置'
}

export const getGenderText = genderText

export function formatBirthday(birthday) {
  if (!birthday) return ''
  const age = dayjs().diff(dayjs(birthday), 'year')
  return `${birthday} (${age} 岁)`
}

export function messageAuthor(message = {}) {
  if (message.user_id && message.anonymous === false) {
    return {
      id: Number(message.user_id),
      nickname: message.display_name_snapshot || `用户${message.user_id}`,
      description: '公开发帖用户',
      gender: 0,
      avatar_url: toApiUrl(`/api/user/${message.user_id}/avatar`)
    }
  }
  return anonymousUser
}

export function publicUserFromProfile(profile = {}) {
  return {
    id: Number(profile.id || 0),
    nickname: profile.nickname || `用户${profile.id || ''}`,
    description: profile.status === 'disabled' ? '账号已停用' : (profile.bio || '公开用户资料'),
    bio: profile.bio || '',
    gender: Number(profile.gender || 0),
    avatar_url: toApiUrl(profile.avatar_url || `/api/user/${profile.id}/avatar`),
    created_at: profile.created_at || null
  }
}

export function getUserById(userId = 0) {
  const id = Number(userId) || 0
  if (!id) return anonymousUser
  return {
    id,
    nickname: `用户${id}`,
    description: '',
    gender: 0,
    avatar_url: toApiUrl(`/api/user/${id}/avatar`)
  }
}

export function fileUrl(file, tiny = false) {
  const base = staticUrl.endsWith('/') ? staticUrl : `${staticUrl}/`
  return `${base}${tiny ? 'tiny_files' : 'uploads'}/${safeFileName(file)}`
}

export function fileType(file = '') {
  const ext = file.split('.').pop()?.toLowerCase() || ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'].includes(ext)) return 'image'
  if (['mp4', 'avi', 'mov', 'webm', 'ogg', 'flv', 'mkv'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'aac', 'flac', 'm4a', 'mid'].includes(ext)) return 'audio'
  if (ext === 'pdf') return 'pdf'
  return 'file'
}
