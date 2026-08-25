const formulaPrefixPattern = /^\s*[=+\-@]/

const normalizeCell = (value) => {
  if (value === undefined || value === null) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return formulaPrefixPattern.test(text) ? `'${text}` : text
}

export const createCsv = (headers, rows) => {
  const escapeCell = (value) => `"${normalizeCell(value).replaceAll('"', '""')}"`
  return [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n')
}

export const downloadCsv = (filename, headers, rows) => {
  const blob = new Blob([`\uFEFF${createCsv(headers, rows)}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.hidden = true
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export const csvDateStamp = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}
