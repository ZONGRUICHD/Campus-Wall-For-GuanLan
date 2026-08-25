const trimTrailingSlash = (value = '') => String(value || '').trim().replace(/\/+$/, '')

export const apiBaseUrl = trimTrailingSlash(import.meta.env.VITE_API_BASE_URL)
export const staticBaseUrl = `${trimTrailingSlash(import.meta.env.VITE_STATIC_URL || `${apiBaseUrl}/static`)}/`

const isAbsoluteUrl = (value = '') => /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)

export function toApiUrl(value = '') {
  const url = String(value || '')
  if (!url || !apiBaseUrl || isAbsoluteUrl(url)) return url
  return `${apiBaseUrl}${url.startsWith('/') ? url : `/${url}`}`
}
