# 001 — Give the Three.js note heart a responsive pulse

- **Status**: DONE
- **Commit**: 06f460f
- **Severity**: MEDIUM
- **Category**: Physicality, interruptibility, performance, accessibility
- **Estimated scope**: 2 files, about 120 lines

## Problem

The confession heart is rendered with Three.js instancing, but it is visually static except while one note changes scale. `frontend/src/components/HeartParticles.jsx:253-290` only renders while a scale transition is active:

```js
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
  // ...
  const animate = (timestamp) => {
    renderInstances(timestamp)
    const running = scaleStates.some((state) => timestamp < state.startedAt + state.duration)
    animationFrame = running ? window.requestAnimationFrame(animate) : 0
  }
  animationFrame = window.requestAnimationFrame(animate)
}
```

The page already rotates a small seeded set of notes every four seconds in `frontend/src/pages/ConfessionWall.jsx:141-164`; the missing motion is feedback that explains that change. A permanent full-frame loop would waste mobile battery, so the heart needs a short, interruptible Three.js motion burst whenever the featured note changes, plus direct press feedback.

## Target

- Keep the existing `InstancedMesh`, seeded heart slots, raycasting, low-power renderer and note selection contract.
- On each featured-note change, run one interruptible 620 ms motion burst. Use the repository movement curve `cubic-bezier(0.77, 0, 0.175, 1)` for on-screen movement.
- Animate only Three.js instance transforms. Each note receives a radial ripple with a 30–80 ms spatial stagger based on normalized distance from the featured instance. The ripple changes only `position.z`, a maximum `rotation.z` offset of `0.035` radians, and scale by at most `4%`.
- Give the featured note a two-beat pulse inside the same burst: first peak at normalized progress `0.22`, smaller second peak at `0.46`, then settle at its existing active scale. The motion must start from the current presented scale so changing the target mid-burst never jumps.
- On pointer down over a real note, immediately compress that instance to `0.97` of its current target. Use pointer capture, cancel when movement exceeds the existing 8 px threshold, and release through the same current-value transition instead of restarting from a logical target.
- Keep hover scale at `1.18` and active scale at `2.05`; do not enlarge additional instances.
- Stop `requestAnimationFrame` as soon as the burst settles. Pause when the document is hidden or the canvas is outside the viewport. Do not add a permanent render loop.
- In reduced-motion mode, render the final active state once and skip ripple, rotation, z travel and double pulse; hover/selection must remain understandable through color/cursor/list state.
- Keep the fallback heart visible when WebGL creation fails.

## Repo conventions to follow

- Motion curves already live in `frontend/src/styles.css:3076-3078`; reuse `--ease-out` semantics and the existing JS `movementEase` implementation rather than inventing another curve.
- The component already disposes geometry, material, texture, mesh and renderer in `frontend/src/components/HeartParticles.jsx:386-402`; every new observer/listener must be removed there.
- The page already watches `prefers-reduced-motion` and document visibility in `frontend/src/pages/ConfessionWall.jsx:124-164`; keep that public prop contract and do not duplicate page-level state.
- Pointer interaction already uses the 8 px tap threshold at `frontend/src/components/HeartParticles.jsx:342-355`; extend this path with pointer capture instead of adding a second gesture recognizer.

## Steps

1. In `frontend/src/components/HeartParticles.jsx`, add a helper that locates the featured instance and computes normalized distance/ripple delay for every slot.
2. Replace the scale-only transition scheduler with one interruptible burst scheduler. Preserve each scale state's presented value, record a shared burst start/end, and render scale, z offset and rotation offset from the current timestamp.
3. Implement the 620 ms radial ripple and two-beat featured pulse using instance transforms only. Keep all amplitudes within the target limits above.
4. Extend pointer down/up/cancel to use `setPointerCapture`, a pressed instance id and immediate `0.97` press feedback. Release/cancel from the presented value.
5. Add an `IntersectionObserver` and document-visibility guard so no frames are scheduled off-screen or in a hidden tab; disconnect/remove both during cleanup.
6. Preserve the reduced-motion final-state render and WebGL fallback. Add no dependency and do not change the note-selection API.
7. In `frontend/src/styles.css`, add only a subtle static radial highlight for the active Three.js stage if needed for depth; do not add CSS keyframes or a second animated layer.

## Boundaries

- Do NOT replace Three.js with DOM/CSS particles or canvas 2D.
- Do NOT add a permanent animation loop, audio, vibration, autoplay scroll or random movement.
- Do NOT change moderation, note ordering, four-second feature interval, API calls or modal behavior.
- Do NOT add dependencies.
- If the component structure differs from commit `06f460f`, stop and report instead of improvising.

## Verification

- **Mechanical**: run `npm run build`, `npm --workspace backend test`, and `git diff --check`; all must pass.
- **Feel check**: open `/confession`, watch at least three four-second feature changes, and confirm:
  - each change produces one coherent outward note ripple and a restrained double pulse;
  - the heart becomes completely still after each burst;
  - clicking while a burst is active starts from the visible pose without a jump;
  - pressing a real note responds immediately and dragging more than 8 px cancels the tap;
  - the canvas stops rendering when scrolled away or the tab is hidden;
  - DevTools 10% playback shows no scale/position discontinuity;
  - with `prefers-reduced-motion: reduce`, no ripple, travel, rotation or pulse occurs, while selection and modal opening still work;
  - forcing WebGL failure still shows the fallback heart and the time-ordered note list remains usable.
- **Done when**: motion runs only during interaction/feature bursts, never loops indefinitely, remains interruptible, and all notes/modal controls retain current behavior.
