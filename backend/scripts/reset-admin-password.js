import process from 'node:process'
import { userStore } from '../src/services/userStore.js'
import { managerStore } from '../src/services/managerStore.js'

const username = String(process.argv[2] || '').trim()

const readHidden = (prompt) => new Promise((resolve, reject) => {
  if (process.env.ADMIN_RESET_PASSWORD) {
    resolve(process.env.ADMIN_RESET_PASSWORD)
    return
  }
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    let input = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { input += chunk })
    process.stdin.on('end', () => resolve(input.split(/\r?\n/)[0] || ''))
    process.stdin.on('error', reject)
    return
  }

  process.stdout.write(prompt)
  let value = ''
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  const cleanup = () => {
    process.stdin.setRawMode(false)
    process.stdin.pause()
  }
  const onData = (character) => {
    if (character === '\u0003') {
      cleanup()
      process.stdout.write('\n')
      reject(new Error('操作已取消'))
      return
    }
    if (character === '\r' || character === '\n') {
      process.stdin.off('data', onData)
      cleanup()
      process.stdout.write('\n')
      resolve(value)
      return
    }
    if (character === '\u007f' || character === '\b') {
      value = value.slice(0, -1)
      return
    }
    if (character >= ' ') value += character
  }
  process.stdin.on('data', onData)
})

if (!username) {
  console.error('用法：npm run admin:reset-password -- <管理员用户名>')
  process.exit(1)
}

try {
  const password = await readHidden('输入新的管理员密码（至少 8 位）：')
  await userStore.init()
  await userStore.migrateLegacyManagers(managerStore.load())
  const result = await userStore.bootstrapSuperAdmin(username, password)
  if (!result.success) throw new Error(result.error || '超级管理员恢复失败')
  console.log(result.created
    ? `已创建并启用超级管理员：${result.user.username}`
    : `已重置并启用超级管理员：${result.user.username}`)
  console.log('旧会话已失效，请使用新密码重新登录。')
} catch (error) {
  console.error(error.message || '管理员密码恢复失败')
  await userStore.pool.end().catch(() => {})
  process.exit(1)
}
await userStore.pool.end()
