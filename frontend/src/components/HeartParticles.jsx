import { useEffect, useMemo, useRef } from 'react'
import {
  CanvasTexture,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  LinearFilter,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer
} from 'three'

const MAX_REAL_NOTES = 72
const MIN_HEART_SLOTS = 56
const POINTER_TAP_DISTANCE = 8
const SCALE_TRANSITION_MS = 240
const HOVER_TRANSITION_MS = 140
const NOTE_COLOR = 0xffc7d8

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const createSeededRandom = (seed = 0x51f15e) => {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let next = state
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

const createHeartSlots = (count) => {
  const random = createSeededRandom(count * 7919)
  return Array.from({ length: count }, (_, index) => {
    const angle = ((index + random() * 0.72) / count) * Math.PI * 2
    const fill = 0.28 + Math.sqrt(random()) * 0.72
    const x = 16 * Math.sin(angle) ** 3
    const y = 13 * Math.cos(angle) - 5 * Math.cos(2 * angle) - 2 * Math.cos(3 * angle) - Math.cos(4 * angle)
    return {
      x: (x / 17) * fill * 1.28,
      y: ((y + 1) / 18) * fill * 1.14,
      z: (random() - 0.5) * 0.32 * (1.18 - fill),
      rotation: (random() - 0.5) * 0.34,
      size: 0.82 + random() * 0.26
    }
  })
}

const createNoteTexture = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 192
  canvas.height = 132
  const context = canvas.getContext('2d')
  if (!context) return null

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#ffffff'
  context.beginPath()
  if (typeof context.roundRect === 'function') {
    context.roundRect(3, 3, 186, 126, 15)
  } else {
    context.moveTo(18, 3)
    context.lineTo(174, 3)
    context.quadraticCurveTo(189, 3, 189, 18)
    context.lineTo(189, 114)
    context.quadraticCurveTo(189, 129, 174, 129)
    context.lineTo(18, 129)
    context.quadraticCurveTo(3, 129, 3, 114)
    context.lineTo(3, 18)
    context.quadraticCurveTo(3, 3, 18, 3)
    context.closePath()
  }
  context.fill()

  context.fillStyle = 'rgba(29, 29, 31, 0.10)'
  context.beginPath()
  context.moveTo(150, 3)
  context.lineTo(189, 3)
  context.lineTo(189, 42)
  context.closePath()
  context.fill()

  context.strokeStyle = 'rgba(29, 29, 31, 0.22)'
  context.lineWidth = 6
  context.lineCap = 'round'
  ;[48, 72, 96].forEach((y, index) => {
    context.beginPath()
    context.moveTo(25, y)
    context.lineTo(index === 2 ? 124 : 163, y)
    context.stroke()
  })

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

const sampleBezier = (t, a1, a2) => {
  const inverse = 1 - t
  return 3 * inverse * inverse * t * a1 + 3 * inverse * t * t * a2 + t * t * t
}

const sampleBezierDerivative = (t, a1, a2) => (
  3 * (1 - t) * (1 - t) * a1
  + 6 * (1 - t) * t * (a2 - a1)
  + 3 * t * t * (1 - a2)
)

const cubicBezier = (x, x1, y1, x2, y2) => {
  const target = clamp(x, 0, 1)
  let t = target
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const slope = sampleBezierDerivative(t, x1, x2)
    if (Math.abs(slope) < 0.0001) break
    t = clamp(t - (sampleBezier(t, x1, x2) - target) / slope, 0, 1)
  }
  return sampleBezier(t, y1, y2)
}

const movementEase = (progress) => cubicBezier(progress, 0.77, 0, 0.175, 1)
const hoverEase = (progress) => cubicBezier(progress, 0.25, 0.1, 0.25, 1)

const noteTimeLabel = (value) => {
  if (!value) return '发布时间未知'
  const parsed = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return String(value)
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(parsed)
}

export default function HeartParticles({
  notes = [],
  activeId = null,
  onSelect,
  onHoverChange,
  reducedMotion = false
}) {
  const hostRef = useRef(null)
  const controllerRef = useRef(null)
  const onSelectRef = useRef(onSelect)
  const onHoverChangeRef = useRef(onHoverChange)
  const visibleNotes = useMemo(() => notes.slice(0, MAX_REAL_NOTES), [notes])

  onSelectRef.current = onSelect
  onHoverChangeRef.current = onHoverChange

  useEffect(() => {
    controllerRef.current?.setActive(activeId)
  }, [activeId])

  useEffect(() => {
    controllerRef.current?.setReducedMotion(reducedMotion)
  }, [reducedMotion])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined

    let renderer
    try {
      renderer = new WebGLRenderer({
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: 'low-power'
      })
    } catch {
      host.dataset.webgl = 'unavailable'
      return undefined
    }

    host.dataset.webgl = 'available'
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = SRGBColorSpace
    renderer.domElement.className = 'confession-particle-canvas confession-note-canvas'
    renderer.domElement.setAttribute('aria-hidden', 'true')
    renderer.domElement.tabIndex = -1
    host.appendChild(renderer.domElement)

    const scene = new Scene()
    const camera = new PerspectiveCamera(38, 1, 0.1, 20)
    camera.position.z = 4.35

    const slotCount = Math.max(MIN_HEART_SLOTS, visibleNotes.length)
    const slots = createHeartSlots(slotCount)
    const noteByInstance = Array(slotCount).fill(null)
    if (visibleNotes.length > 0) {
      visibleNotes.forEach((note, noteIndex) => {
        const slotIndex = Math.floor((noteIndex * slotCount) / visibleNotes.length)
        noteByInstance[slotIndex] = note
      })
    }

    const texture = createNoteTexture()
    const geometry = new PlaneGeometry(0.28, 0.192)
    const material = new MeshBasicMaterial({
      color: NOTE_COLOR,
      map: texture,
      transparent: Boolean(texture),
      alphaTest: texture ? 0.08 : 0,
      depthWrite: false,
      side: DoubleSide
    })
    const noteMesh = new InstancedMesh(geometry, material, slotCount)
    noteMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    noteMesh.frustumCulled = false
    noteMesh.renderOrder = 2
    scene.add(noteMesh)

    const dummy = new Object3D()
    const scaleStates = slots.map((slot, index) => {
      const base = slot.size * (noteByInstance[index] ? 1 : 0.74)
      return { value: base, from: base, to: base, startedAt: 0, duration: 0 }
    })
    let responsiveScale = 1
    let activeNoteId = activeId
    let hoveredInstance = -1
    let animationFrame = 0
    let motionReduced = reducedMotion
    let pointerStart = null

    const targetScale = (index) => {
      const note = noteByInstance[index]
      const base = slots[index].size * (note ? 1 : 0.74) * responsiveScale
      if (!note || motionReduced) return base
      if (String(note.id) === String(activeNoteId)) return base * 2.05
      if (index === hoveredInstance) return base * 1.18
      return base
    }

    const currentScale = (state, timestamp) => {
      if (!state.duration || timestamp >= state.startedAt + state.duration) return state.to
      const progress = clamp((timestamp - state.startedAt) / state.duration, 0, 1)
      const ease = state.duration === HOVER_TRANSITION_MS ? hoverEase(progress) : movementEase(progress)
      return state.from + (state.to - state.from) * ease
    }

    const renderInstances = (timestamp = performance.now()) => {
      slots.forEach((slot, index) => {
        const state = scaleStates[index]
        state.value = currentScale(state, timestamp)
        const isFeatured = noteByInstance[index] && String(noteByInstance[index].id) === String(activeNoteId) && !motionReduced
        dummy.position.set(slot.x, slot.y, isFeatured ? slot.z + 0.34 : slot.z)
        dummy.rotation.set(0, 0, slot.rotation)
        dummy.scale.setScalar(state.value)
        dummy.updateMatrix()
        noteMesh.setMatrixAt(index, dummy.matrix)
      })
      noteMesh.instanceMatrix.needsUpdate = true
      renderer.render(scene, camera)
    }

    const transitionScales = (duration = SCALE_TRANSITION_MS) => {
      window.cancelAnimationFrame(animationFrame)
      const startedAt = performance.now()
      scaleStates.forEach((state, index) => {
        const from = currentScale(state, startedAt)
        state.value = from
        state.from = from
        state.to = targetScale(index)
        state.startedAt = startedAt
        state.duration = motionReduced ? 0 : duration
      })

      if (motionReduced) {
        renderInstances(startedAt)
        return
      }

      const animate = (timestamp) => {
        renderInstances(timestamp)
        const running = scaleStates.some((state) => timestamp < state.startedAt + state.duration)
        animationFrame = running ? window.requestAnimationFrame(animate) : 0
      }
      animationFrame = window.requestAnimationFrame(animate)
    }

    const resize = () => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.position.z = width < 640 ? 4.95 : 4.35
      camera.updateProjectionMatrix()
      noteMesh.scale.set(width < 640 ? 0.8 : 1, width < 640 ? 0.92 : 1, 1)
      responsiveScale = width < 640 ? 1.2 : 1
      scaleStates.forEach((state, index) => {
        const next = targetScale(index)
        state.value = next
        state.from = next
        state.to = next
        state.duration = 0
      })
      renderInstances()
    }

    const raycaster = new Raycaster()
    const pointer = new Vector2()
    const hitTest = (event) => {
      const rect = renderer.domElement.getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObject(noteMesh, false)[0]
      if (!hit || !Number.isInteger(hit.instanceId)) return null
      const note = noteByInstance[hit.instanceId]
      return note ? { note, instanceId: hit.instanceId } : null
    }

    const setHoveredInstance = (nextInstance) => {
      if (hoveredInstance === nextInstance) return
      hoveredInstance = nextInstance
      renderer.domElement.dataset.interactive = nextInstance >= 0 ? 'true' : 'false'
      onHoverChangeRef.current?.(nextInstance >= 0)
      transitionScales(HOVER_TRANSITION_MS)
    }

    const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)')
    const handlePointerMove = (event) => {
      if (!supportsHover.matches) return
      const hit = hitTest(event)
      setHoveredInstance(hit?.instanceId ?? -1)
    }
    const handlePointerLeave = () => setHoveredInstance(-1)
    const handlePointerDown = (event) => {
      pointerStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
    }
    const handlePointerUp = (event) => {
      if (!pointerStart || pointerStart.pointerId !== event.pointerId) return
      const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y)
      pointerStart = null
      if (distance > POINTER_TAP_DISTANCE) return
      const hit = hitTest(event)
      if (hit) onSelectRef.current?.(hit.note)
    }
    const handlePointerCancel = () => {
      pointerStart = null
      setHoveredInstance(-1)
    }

    renderer.domElement.addEventListener('pointermove', handlePointerMove, { passive: true })
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave, { passive: true })
    renderer.domElement.addEventListener('pointerdown', handlePointerDown, { passive: true })
    renderer.domElement.addEventListener('pointerup', handlePointerUp, { passive: true })
    renderer.domElement.addEventListener('pointercancel', handlePointerCancel, { passive: true })

    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(resize)
      : null
    resizeObserver?.observe(host)
    if (!resizeObserver) window.addEventListener('resize', resize, { passive: true })

    controllerRef.current = {
      setActive(nextId) {
        if (String(activeNoteId) === String(nextId)) return
        activeNoteId = nextId
        transitionScales(SCALE_TRANSITION_MS)
      },
      setReducedMotion(nextReduced) {
        const next = Boolean(nextReduced)
        if (motionReduced === next) return
        motionReduced = next
        transitionScales(SCALE_TRANSITION_MS)
      }
    }

    resize()

    return () => {
      controllerRef.current = null
      window.cancelAnimationFrame(animationFrame)
      onHoverChangeRef.current?.(false)
      renderer.domElement.removeEventListener('pointermove', handlePointerMove)
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
      renderer.domElement.removeEventListener('pointerup', handlePointerUp)
      renderer.domElement.removeEventListener('pointercancel', handlePointerCancel)
      resizeObserver?.disconnect()
      if (!resizeObserver) window.removeEventListener('resize', resize)
      geometry.dispose()
      material.dispose()
      texture?.dispose()
      noteMesh.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [visibleNotes])

  return (
    <div className="confession-note-heart">
      <div
        ref={hostRef}
        className="confession-particles confession-note-viewport"
        style={{ pointerEvents: 'auto' }}
      >
        <span className="confession-heart-fallback" aria-hidden="true">♥</span>
      </div>

      <section className="confession-note-browser" aria-labelledby="confession-note-browser-title">
        <div className="confession-note-browser-heading">
          <div>
            <span className="badge"><i className="bi bi-clock-history" aria-hidden="true" />按时间浏览</span>
            <h2 id="confession-note-browser-title">公开便签</h2>
          </div>
          <span className="confession-note-count">{visibleNotes.length} 张</span>
        </div>

        {visibleNotes.length ? (
          <div className="confession-note-list">
            {visibleNotes.map((note) => {
              const featured = String(note.id) === String(activeId)
              return (
                <button
                  className={`confession-note-list-item${featured ? ' is-featured' : ''}`}
                  type="button"
                  key={note.id}
                  onClick={() => onSelect?.(note)}
                  aria-label={`查看 ${noteTimeLabel(note.timestamp)} 发布的表白便签`}
                  aria-current={featured ? 'true' : undefined}
                >
                  <span className="confession-note-list-pin" aria-hidden="true" />
                  <span className="confession-note-list-text">{note.text}</span>
                  <time className="confession-note-list-time" dateTime={String(note.timestamp || '')}>
                    {noteTimeLabel(note.timestamp)}
                  </time>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="confession-note-empty" role="status">
            <i className="bi bi-heart" aria-hidden="true" />
            <b>还没有公开便签</b>
            <span>写下第一句心里话，审核通过后会出现在这里。</span>
          </div>
        )}
      </section>
    </div>
  )
}
