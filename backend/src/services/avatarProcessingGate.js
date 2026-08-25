import { config } from '../config.js'

export const createConcurrencyGate = (limit) => {
  const maximum = Math.max(1, Number(limit) || 1)
  let active = 0
  return {
    tryAcquire() {
      if (active >= maximum) return null
      active += 1
      let released = false
      return () => {
        if (released) return
        released = true
        active = Math.max(0, active - 1)
      }
    },
    get active() {
      return active
    }
  }
}

const avatarProcessingGate = createConcurrencyGate(config.maxConcurrentAvatarProcessing)

export const acquireAvatarProcessingSlot = () => avatarProcessingGate.tryAcquire()
