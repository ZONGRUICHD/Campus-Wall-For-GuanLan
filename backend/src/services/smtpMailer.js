import net from 'node:net'
import tls from 'node:tls'
import { config } from '../config.js'

const emailPattern = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i

export const parseEmailList = (value = '', { max = 8 } = {}) => {
  const items = String(value || '')
    .split(/[,;\n]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  const emails = []
  for (const email of items) {
    if (email.length > 320 || !emailPattern.test(email)) {
      return { valid: false, reason: 'invalid_email', emails: [] }
    }
    if (!emails.includes(email)) emails.push(email)
    if (emails.length > max) return { valid: false, reason: 'too_many_recipients', emails: [] }
  }
  if (!emails.length) return { valid: false, reason: 'missing_email', emails: [] }
  return { valid: true, emails }
}

export const normalizeEmail = (value = '') => {
  const parsed = parseEmailList(value, { max: 1 })
  return parsed.valid ? parsed.emails[0] : ''
}

export const isSmtpConfigured = (settings = config) => Boolean(
  String(settings.smtpHost || '').trim()
  && String(settings.smtpFrom || '').trim()
)

const headerValue = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim()

export const buildMimeMessage = ({ from, to, subject, text }) => {
  const recipients = Array.isArray(to) ? to : [to]
  return [
    `From: ${headerValue(from)}`,
    `To: ${recipients.map(headerValue).join(', ')}`,
    `Subject: ${headerValue(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    String(text || '').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
  ].join('\r\n')
}

const connectSocket = ({ host, port, secure, timeoutMs, servername }) => new Promise((resolve, reject) => {
  const socket = secure
    ? tls.connect({ host, port, servername, timeout: timeoutMs })
    : net.connect({ host, port })
  const fail = (error) => {
    socket.destroy()
    reject(error)
  }
  socket.setTimeout(timeoutMs)
  socket.once('timeout', () => fail(Object.assign(new Error('smtp_timeout'), { name: 'AbortError' })))
  socket.once('error', fail)
  socket.once(secure ? 'secureConnect' : 'connect', () => {
    socket.removeAllListeners('error')
    socket.removeAllListeners('timeout')
    resolve(socket)
  })
})

const upgradeTls = (socket, { host, timeoutMs }) => new Promise((resolve, reject) => {
  const secure = tls.connect({ socket, servername: host, timeout: timeoutMs })
  const fail = (error) => {
    secure.destroy()
    reject(error)
  }
  secure.setTimeout(timeoutMs)
  secure.once('timeout', () => fail(Object.assign(new Error('smtp_timeout'), { name: 'AbortError' })))
  secure.once('error', fail)
  secure.once('secureConnect', () => {
    secure.removeAllListeners('error')
    secure.removeAllListeners('timeout')
    resolve(secure)
  })
})

const readReply = (socket) => new Promise((resolve, reject) => {
  let buffer = ''
  const cleanup = () => {
    socket.off('data', onData)
    socket.off('error', onError)
    socket.off('timeout', onTimeout)
    socket.off('end', onEnd)
  }
  const onError = (error) => {
    cleanup()
    reject(error)
  }
  const onTimeout = () => onError(Object.assign(new Error('smtp_timeout'), { name: 'AbortError' }))
  const onEnd = () => onError(new Error('smtp_closed'))
  const onData = (chunk) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split(/\r?\n/)
    if (!buffer.endsWith('\n')) lines.pop()
    if (!lines.length) return
    const last = lines[lines.length - 1]
    const match = last.match(/^(\d{3})( |-|$)/)
    if (!match || match[2] === '-') return
    cleanup()
    resolve({ code: Number(match[1]), text: lines.join('\n') })
  }
  socket.on('data', onData)
  socket.once('error', onError)
  socket.once('timeout', onTimeout)
  socket.once('end', onEnd)
})

const expect = async (socket, line, expected) => {
  if (line !== null) socket.write(`${line}\r\n`)
  const reply = await readReply(socket)
  const codes = Array.isArray(expected) ? expected : [expected]
  if (!codes.includes(reply.code)) {
    const error = new Error(`smtp_${reply.code}`)
    error.permanent = reply.code >= 500 && reply.code < 600
    error.reply = reply.text
    throw error
  }
  return reply
}

const ehlo = async (socket, host) => {
  const reply = await expect(socket, `EHLO ${host}`, 250)
  return String(reply.text || '').toUpperCase()
}

export async function sendMail({
  to,
  subject,
  text,
  settings = config
} = {}) {
  if (!isSmtpConfigured(settings)) {
    throw Object.assign(new Error('email_not_configured'), { permanent: true })
  }
  const parsed = parseEmailList(Array.isArray(to) ? to.join(',') : to)
  if (!parsed.valid) throw Object.assign(new Error('invalid_email'), { permanent: true })

  const host = String(settings.smtpHost || '').trim()
  const port = Number(settings.smtpPort) || 587
  const timeoutMs = Number(settings.smtpTimeoutMs) || 8000
  const from = String(settings.smtpFrom || '').trim()
  const user = String(settings.smtpUser || '').trim()
  const pass = String(settings.smtpPass || '')
  const implicitTls = settings.smtpSecure === true || port === 465
  const fromAddress = (from.match(/<([^>]+)>/)?.[1] || from).trim()

  let socket = await connectSocket({
    host,
    port,
    secure: implicitTls,
    timeoutMs,
    servername: host
  })
  socket.setEncoding('utf8')
  socket.setTimeout(timeoutMs)

  try {
    await expect(socket, null, 220)
    let capabilities = await ehlo(socket, 'campuswall')
    if (!implicitTls && capabilities.includes('STARTTLS')) {
      await expect(socket, 'STARTTLS', 220)
      socket = await upgradeTls(socket, { host, timeoutMs })
      socket.setEncoding('utf8')
      socket.setTimeout(timeoutMs)
      capabilities = await ehlo(socket, 'campuswall')
    }
    if (user) {
      await expect(socket, 'AUTH LOGIN', 334)
      await expect(socket, Buffer.from(user).toString('base64'), 334)
      await expect(socket, Buffer.from(pass).toString('base64'), 235)
    }
    await expect(socket, `MAIL FROM:<${fromAddress}>`, 250)
    for (const recipient of parsed.emails) {
      await expect(socket, `RCPT TO:<${recipient}>`, [250, 251])
    }
    await expect(socket, 'DATA', 354)
    const payload = buildMimeMessage({
      from,
      to: parsed.emails,
      subject,
      text
    })
    socket.write(`${payload.replace(/^\./gm, '..')}\r\n.\r\n`)
    await expect(socket, null, 250)
    await expect(socket, 'QUIT', [221, 250]).catch(() => {})
  } finally {
    socket.destroy()
  }

  return { ok: true, to: parsed.emails }
}
