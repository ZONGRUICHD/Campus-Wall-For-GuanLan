import { useEffect, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  WebGLRenderer
} from 'three'

const createHeartPositions = (count) => {
  const positions = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2
    const fill = 0.24 + Math.sqrt(Math.random()) * 0.76
    const x = 16 * Math.sin(angle) ** 3
    const y = 13 * Math.cos(angle) - 5 * Math.cos(2 * angle) - 2 * Math.cos(3 * angle) - Math.cos(4 * angle)
    const offset = index * 3
    positions[offset] = (x / 17) * fill
    positions[offset + 1] = ((y + 1) / 18) * fill
    positions[offset + 2] = (Math.random() - 0.5) * 0.38 * (1.15 - fill)
  }
  return positions
}

export default function HeartParticles() {
  const hostRef = useRef(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined

    let renderer
    try {
      renderer = new WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'low-power'
      })
    } catch {
      host.dataset.webgl = 'unavailable'
      return undefined
    }

    renderer.domElement.className = 'confession-particle-canvas'
    renderer.domElement.setAttribute('aria-hidden', 'true')
    host.appendChild(renderer.domElement)

    const scene = new Scene()
    const camera = new PerspectiveCamera(38, 1, 0.1, 20)
    camera.position.z = 4.2

    const geometry = new BufferGeometry()
    const pointCount = Math.min(1900, Math.max(950, Math.round(window.innerWidth * 1.35)))
    geometry.setAttribute('position', new BufferAttribute(createHeartPositions(pointCount), 3))

    const material = new PointsMaterial({
      color: 0xff5f8f,
      size: 0.034,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.88,
      depthWrite: false
    })
    const heart = new Points(geometry, material)
    scene.add(heart)

    const updateParticleColor = () => {
      const color = getComputedStyle(host).getPropertyValue('--confession-particle').trim()
      if (color) material.color.set(color)
    }
    updateParticleColor()

    const resize = () => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.position.z = width < 640 ? 4.8 : 4.2
      camera.updateProjectionMatrix()
      material.size = width < 640 ? 0.042 : 0.034
    }

    const render = () => renderer.render(scene, camera)
    resize()
    render()

    const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = reduceMotionQuery.matches
    let animationFrame = 0
    let startTime = 0

    const animate = (timestamp) => {
      if (reducedMotion) return
      if (!startTime) startTime = timestamp
      const elapsed = (timestamp - startTime) / 1000
      heart.rotation.y = Math.sin(elapsed * 0.48) * 0.17
      heart.rotation.z = Math.sin(elapsed * 0.31) * 0.018
      const pulse = 1 + Math.sin(elapsed * 1.35) * 0.022
      heart.scale.setScalar(pulse)
      render()
      animationFrame = window.requestAnimationFrame(animate)
    }

    const updateMotion = (event) => {
      reducedMotion = event.matches
      window.cancelAnimationFrame(animationFrame)
      animationFrame = 0
      startTime = 0
      if (reducedMotion) {
        heart.rotation.set(0, 0, 0)
        heart.scale.setScalar(1)
        render()
      } else {
        animationFrame = window.requestAnimationFrame(animate)
      }
    }

    if (!reducedMotion) animationFrame = window.requestAnimationFrame(animate)
    reduceMotionQuery.addEventListener?.('change', updateMotion)

    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      resize()
      render()
    }) : null
    resizeObserver?.observe(host)
    if (!resizeObserver) window.addEventListener('resize', resize, { passive: true })

    const themeObserver = new MutationObserver(() => {
      updateParticleColor()
      render()
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      window.cancelAnimationFrame(animationFrame)
      reduceMotionQuery.removeEventListener?.('change', updateMotion)
      resizeObserver?.disconnect()
      if (!resizeObserver) window.removeEventListener('resize', resize)
      themeObserver.disconnect()
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return (
    <div ref={hostRef} className="confession-particles" aria-hidden="true">
      <span className="confession-heart-fallback">♥</span>
    </div>
  )
}
