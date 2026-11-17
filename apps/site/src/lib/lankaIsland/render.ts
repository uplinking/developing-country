import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshLambertMaterial,
  type Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import { CLIFF_Z, FALLS_X, ISLAND, SPILL_DEPTH, WATER_LEVEL, createNoise, type Animal, type AnimalPart, type IslandScene, type VoxelLayer } from './scene'
import { createSky } from './sky'

/** How far a drag can turn the island either way, in radians. Small, so it always spans the full width. */
export const DRAG_LIMIT = 0.1
/** Rows of the spill that show before any scrolling: the river just tipping over the edge. */
export const SPILL_LIP = 4
/** Share of the hero's height the reader scrolls for the spill to reach its full fall. */
export const SPILL_SCROLL = 0.6

/** The island's turn under a drag, clamped. */
export function islandYaw(drag: number): number {
  return Math.max(-DRAG_LIMIT, Math.min(DRAG_LIMIT, drag))
}

/** How far the river has poured off the edge: 0 at the top of the page, 1 once the hero is well scrolled. */
export function spillProgress(scrolled: number, heroHeight: number): number {
  if (heroHeight <= 0) return 0
  return Math.min(1, Math.max(0, scrolled / (heroHeight * SPILL_SCROLL)))
}

/** Rows of the spill to show at a given progress. */
export function spillRows(progress: number): number {
  return SPILL_LIP + progress * (SPILL_DEPTH - SPILL_LIP)
}

/** Rows the falling water travels per second of flow. */
export const SPILL_SPEED = 14

/**
 * How broken the water is `drop` rows below the lip while `rows` of the fall are showing, 0–1.
 * `thin` is the fall's own break-up there; on top of it the leading end of the pour is always
 * coming apart, so a half-poured river ends in drops rather than a cut line.
 */
export function spillThin(thin: number, drop: number, rows: number): number {
  const feather = Math.min(8, Math.max(1, rows / 2))
  const tip = 1 - Math.min(1, Math.max(0, (rows - drop) / feather))
  return Math.max(thin, tip)
}

/**
 * Whether there is water at a cell of the fall right now. Each strand is a run of dashes sliding
 * down with the flow: unbroken where `thin` is 0, shorter dashes and longer gaps as it rises,
 * single drops near 1, and nothing at 1. `lag` (0–1) sets the strand's rhythm.
 */
export function spillWet(thin: number, lag: number, drop: number, flow: number): boolean {
  if (thin <= 0) return true
  if (thin >= 1) return false
  const period = 7 + 6 * lag
  const phase = (((drop - flow * SPILL_SPEED + lag * 53) % period) + period) % period
  return phase < Math.max(1, (1 - thin) * period)
}

/** How far each part of an elephant turns at `time` seconds, in radians. Pure, so it can be tested. */
export function elephantPose(kind: AnimalPart['kind'], animal: Pick<Animal, 'drinking' | 'phase'>, side: number, time: number) {
  const t = time + animal.phase * 20
  // Every so often the drinker lifts its trunk out of the river and the head comes up with it.
  const cycle = ((t / 7) % 1 + 1) % 1
  const lift = animal.drinking ? Math.sin(Math.PI * Math.min(1, Math.max(0, (cycle - 0.6) / 0.4))) ** 2 : 0
  switch (kind) {
    case 'head': return { pitch: 0.08 * Math.sin(t * 0.8) - 0.16 * lift, yaw: 0.05 * Math.sin(t * 0.45), roll: 0 }
    case 'trunk': return { pitch: animal.drinking ? 0.08 * Math.sin(t * 1.1) - 0.7 * lift : 0.4 * Math.sin(t * 1.3), yaw: 0.08 * Math.sin(t * 0.7), roll: 0 }
    case 'ear': return { pitch: 0, yaw: side * 0.5 * (0.5 + 0.5 * Math.sin(t * 1.7)), roll: 0 }
    case 'tail': return { pitch: 0, yaw: 0, roll: 0.45 * Math.sin(t * 2.3) }
    case 'body': return { pitch: 0, yaw: 0, roll: 0 }
  }
}

interface Options {
  /** The page colour below the sunset, where the river falls away. */
  background: number
  reducedMotion: boolean
}

/**
 * Draws a built island into `canvas`, sized to `host`, which leads the page. A horizontal drag turns
 * the island a little and it eases back; scrolling pours the river off its front edge and pushes the
 * water along. Renders only while the host is on screen. Returns a disposer.
 */
export function mountIsland(canvas: HTMLCanvasElement, host: HTMLElement, island: IslandScene, options: Options): () => void {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  const narrow = () => host.clientWidth < 760
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, narrow() ? 1.5 : 2))
  renderer.setClearColor(options.background, 1)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap
  renderer.shadowMap.autoUpdate = false

  const scene = new Scene()
  scene.fog = new Fog(options.background, 300, 800)

  const sky = createSky(options.background, options.reducedMotion)
  scene.add(sky.mesh)
  const material = new MeshLambertMaterial({ map: edgeTexture(renderer.capabilities.getMaxAnisotropy()) })
  sky.hazeInto(material)
  const cube = new BoxGeometry(1, 1, 1)
  const m4 = new Matrix4()
  const colour = new Color()

  const mesh = (layer: VoxelLayer, castShadow: boolean, parent: Object3D = scene) => {
    const count = layer.positions.length / 3
    const instanced = new InstancedMesh(cube, material, count)
    for (let i = 0; i < count; i++) {
      m4.makeTranslation(layer.positions[i * 3] + 0.5, layer.positions[i * 3 + 1] + 0.5, layer.positions[i * 3 + 2] + 0.5)
      instanced.setMatrixAt(i, m4)
      instanced.setColorAt(i, colour.setRGB(layer.colors[i * 3], layer.colors[i * 3 + 1], layer.colors[i * 3 + 2], SRGBColorSpace))
    }
    instanced.castShadow = castShadow
    instanced.receiveShadow = true
    parent.add(instanced)
    return instanced
  }
  mesh(island.terrain, true)
  const water = mesh(island.water, false)
  const falls = mesh(island.falls, false)
  const spill = mesh(island.spill, false)
  spill.frustumCulled = false // its bounds change as rows are revealed
  // The start of the sunset: clouds lit gold from below, brighter than anything else in the sky.
  const blush = new Color().setHex(0xffdc96, SRGBColorSpace)
  const clouds = island.clouds.map((cloud) => {
    const m = mesh(cloud, false)
    for (let i = 0; i < m.count; i++) { m.getColorAt(i, colour); m.setColorAt(i, colour.lerp(blush, 0.45).multiplyScalar(1.12)) }
    m.position.set(cloud.x, cloud.y, cloud.z)
    return { mesh: m, speed: cloud.speed }
  })

  // Each part hangs at its joint from the part it belongs to, so a head turns its trunk and ears with it.
  const joints = island.animals.flatMap((animal) => {
    const groups = animal.parts.map(() => new Group())
    return animal.parts.map((part, i) => {
      const group = groups[i]
      const from = animal.parts[part.parent]?.pivot ?? [0, 0, 0]
      group.position.set(part.pivot[0] - from[0], part.pivot[1] - from[1], part.pivot[2] - from[2])
      const holder: Object3D = part.parent >= 0 ? groups[part.parent] : scene
      holder.add(group)
      mesh(part, true, group).position.set(-part.pivot[0], -part.pivot[1], -part.pivot[2])
      return { group, part, animal }
    })
  })
  const pose = (time: number) => {
    for (const { group, part, animal } of joints) {
      const { pitch, yaw, roll } = elephantPose(part.kind, animal, part.side, time)
      // Pitch nods about z towards the way the animal faces; roll swings across it.
      group.rotation.set(roll, yaw, -animal.face * pitch)
    }
  }

  // Golden hour: a bright warm fill and a strong golden sun, so whites glow and colours stay clear.
  scene.add(new HemisphereLight(0xfff3df, 0xd2c3b4, 1.7))
  const sun = new DirectionalLight(0xffd8a0, 2.3)
  sun.position.set(40, 190, 230)
  sun.target.position.set(100, 0, 70)
  sun.castShadow = true
  const shadowSize = narrow() ? 2048 : 4096
  sun.shadow.mapSize.set(shadowSize, shadowSize)
  Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 10, far: 600 })
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.6
  scene.add(sun, sun.target)

  /* ---------- moving water: the river, the falls and the spill ---------- */
  const { hash2, hash3, vnoise } = createNoise(7)
  const srgb = (hex: number) => new Color().setHex(hex, SRGBColorSpace)
  const river = srgb(0x2f7fae), sea = srgb(0x2a6c97), light = srgb(0x6fb1d4), foam = srgb(0xeef4f3)
  const fallWhite = srgb(0xf6f8f6), fallLight = srgb(0xc4e0ec), fallBlue = srgb(0x7fb8d8), spillLight = srgb(0xa6d8f6)
  const paintWater = (flow: number) => {
    const p = island.water.positions
    for (let i = 0; i < island.water.sea.length; i++) {
      const x = p[i * 3], z = p[i * 3 + 2], isSea = island.water.sea[i] === 1
      const v = vnoise(x * (isSea ? 0.08 : 0.13), z * (isSea ? 0.45 : 0.6) - flow * (isSea ? 0.25 : 0.9))
      const churn = !isSea && z > CLIFF_Z && z < CLIFF_Z + 7 && Math.abs(x - FALLS_X) < 9 && hash3(x, Math.floor(flow * 4), z) < 0.45
      colour.copy(churn || v > 0.74 ? foam : v > 0.55 ? light : isSea ? sea : river)
      water.setColorAt(i, colour.multiplyScalar(1 + (hash2(x, z) - 0.5) * 0.06))
    }
    if (water.instanceColor) water.instanceColor.needsUpdate = true
  }
  const paintFalling = (target: InstancedMesh, layer: VoxelLayer, flow: number, sprayFrom: number) => {
    const p = layer.positions
    for (let i = 0; i < p.length / 3; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2]
      if (z > sprayFrom) colour.copy(hash3(x, Math.floor(flow * 6), z) < 0.5 ? fallWhite : fallLight)
      else {
        const phase = (((y + flow * 14 + hash2(x, 3) * 9) % 7) + 7) % 7
        colour.copy(phase < 2.5 ? fallWhite : phase < 5 ? fallLight : fallBlue)
      }
      target.setColorAt(i, colour)
    }
    if (target.instanceColor) target.instanceColor.needsUpdate = true
  }
  // The spill: `rows` of it poured so far. Its voxels run top row first, so a prefix of them is a
  // shorter fall. Within that, water is hidden wherever a strand has a gap just now, which is what
  // makes the drops fall. Whole water wears the waterfall's moving bands; drops wear their tint.
  const spillTints = Array.from({ length: island.spill.thin.length }, (_, i) =>
    new Color().setRGB(island.spill.colors[i * 3], island.spill.colors[i * 3 + 1], island.spill.colors[i * 3 + 2], SRGBColorSpace))
  const gone = new Matrix4().makeScale(0, 0, 0)
  const paintSpill = (flow: number, rows: number) => {
    const p = island.spill.positions
    const { thin, lag } = island.spill
    const floor = WATER_LEVEL - rows
    let lo = 0, hi = thin.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (p[mid * 3 + 1] >= floor) lo = mid + 1; else hi = mid }
    spill.count = lo
    for (let i = 0; i < lo; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2]
      const drop = WATER_LEVEL - y, rhythm = lag[i] / 255
      const broken = spillThin(thin[i] / 255, drop, rows)
      if (!spillWet(broken, rhythm, drop, flow)) { spill.setMatrixAt(i, gone); continue }
      spill.setMatrixAt(i, m4.makeTranslation(x + 0.5, y + 0.5, z + 0.5))
      // Long white streaks and short blue ones sliding down a pale sheet, a strand at a time.
      const phase = (((y + flow * SPILL_SPEED + rhythm * 40) % 11) + 11) % 11
      colour.copy(phase < 4 ? fallWhite : phase < 9.5 ? spillLight : fallBlue)
      spill.setColorAt(i, colour.lerp(spillTints[i], Math.min(1, Math.max(broken * 1.6, 1.3 * drop / SPILL_DEPTH))))
    }
    spill.instanceMatrix.needsUpdate = true
    if (spill.instanceColor) spill.instanceColor.needsUpdate = true
  }
  const paint = (flow: number, rows: number) => {
    paintWater(flow)
    paintFalling(falls, island.falls, flow, CLIFF_Z + 2)
    paintSpill(flow, rows)
  }

  /* ---------- camera and framing ---------- */
  const camera = new PerspectiveCamera(20, 1, 1, 2000)
  const target = new Vector3(100, 14, 74)
  let distance = 600
  const frame = () => {
    const w = host.clientWidth, h = host.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h, false)
    sky.resize(renderer)
    // The host can bleed past the bottom of its section to give the falling river room. Frame the
    // island on the section alone and let the extra rows render below it.
    const bleed = Math.min(h / 2, Math.max(0, parseFloat(getComputedStyle(host).getPropertyValue('--scene-bleed')) || 0))
    const fh = h - bleed
    const aspect = w / fh
    camera.aspect = aspect
    const hfov = 2 * Math.atan(Math.tan(MathUtils.degToRad(camera.fov) / 2) * aspect)
    // A touch narrower than the island, so it always reaches both edges of the page.
    distance = (aspect < 1 ? 64 : 92) / Math.tan(hfov / 2)
    // Room for the sunset above, and the near shore low enough for the title to stand in front of it.
    camera.setViewOffset(w, fh, 0, fh * (aspect < 1 ? 0.06 : -0.03), w, h)
    camera.updateProjectionMatrix()
    // Only the far coast takes on the haze; the rest stays crisp, in focus in the clear evening light.
    if (scene.fog instanceof Fog) { scene.fog.near = distance + 40; scene.fog.far = distance + 460 }
    renderer.shadowMap.needsUpdate = true
  }
  const pitch = 0.36
  let yaw = 0
  const place = (y: number) => {
    const cp = Math.cos(pitch)
    camera.position.set(target.x + Math.sin(y) * cp * distance, target.y + Math.sin(pitch) * distance, target.z + Math.cos(y) * cp * distance)
    camera.lookAt(target)
  }

  /* ---------- input: drag ---------- */
  let drag = 0
  let dragging = false
  let lastX = 0
  const onDown = (e: PointerEvent) => {
    dragging = true
    lastX = e.clientX
    canvas.setPointerCapture(e.pointerId)
    host.dataset.dragging = ''
  }
  const onMove = (e: PointerEvent) => {
    if (!dragging) return
    drag = islandYaw(drag - (e.clientX - lastX) * 0.002)
    lastX = e.clientX
    wake()
  }
  const onUp = () => { dragging = false; delete host.dataset.dragging; wake() }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)

  /* ---------- loop: only while the hero is on screen and the tab is visible ---------- */
  let raf = 0
  let visible = true
  let last = performance.now()
  let time = 0
  let lastPaint = -1
  let lastRows = -1
  let rows = spillRows(spillProgress(window.scrollY, host.clientHeight))
  const tick = (now: number) => {
    raf = 0
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    // The hero leads the page, so the page's scroll is how far it has scrolled away.
    const scrolled = window.scrollY
    const rowsGoal = spillRows(spillProgress(scrolled, host.clientHeight))
    if (options.reducedMotion) {
      yaw = islandYaw(drag)
      rows = rowsGoal
      paint(scrolled * 0.01, rows)
    } else {
      time += dt
      sky.advance(time)
      pose(time)
      for (const c of clouds) {
        c.mesh.position.x += c.speed * dt
        if (c.mesh.position.x > ISLAND.width + 30) c.mesh.position.x = -40
      }
      rows += (rowsGoal - rows) * Math.min(1, dt * 5)
      // Scrolling pushes the water along on top of its own steady flow. Repaint in small steps of
      // flow, and at once when the pour grows, so a new row never shows before its gaps are cut.
      const flow = time + scrolled * 0.01
      if (Math.abs(flow - lastPaint) > 0.08 || Math.abs(rows - lastRows) > 0.5) { paint(flow, rows); lastPaint = flow; lastRows = rows }
      if (!dragging) drag -= drag * Math.min(1, dt * 0.8)
      yaw += (islandYaw(drag) + Math.sin(time * 0.12) * 0.015 - yaw) * Math.min(1, dt * 6)
    }
    place(yaw)
    sky.frame(camera)
    renderer.render(scene, camera)
    host.dataset.ready = ''
    if (visible && (!options.reducedMotion || dragging)) raf = requestAnimationFrame(tick)
  }
  const wake = () => { if (!raf && visible) { last = performance.now(); raf = requestAnimationFrame(tick) } }
  const onScroll = () => { if (options.reducedMotion) wake() }
  window.addEventListener('scroll', onScroll, { passive: true })

  const seen = new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting) && document.visibilityState === 'visible'
    if (visible) wake()
  })
  seen.observe(host)
  const onVisibility = () => {
    visible = document.visibilityState === 'visible' && host.getBoundingClientRect().bottom > 0
    if (visible) wake()
  }
  document.addEventListener('visibilitychange', onVisibility)
  const resized = new ResizeObserver(() => { frame(); wake() })
  resized.observe(host)

  paint(0, rows)
  frame()
  wake()

  return () => {
    if (raf) cancelAnimationFrame(raf)
    seen.disconnect()
    resized.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('scroll', onScroll)
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointercancel', onUp)
    scene.traverse((object) => { if (object instanceof InstancedMesh) object.dispose() })
    cube.dispose()
    sky.dispose()
    material.map?.dispose()
    material.dispose()
    renderer.dispose()
  }
}

/** A cube face with a faint bevelled edge, so each voxel reads as its own block. */
function edgeTexture(anisotropy: number): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const g = canvas.getContext('2d')
  if (g) {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64)
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, 64, 4); g.fillRect(0, 0, 4, 64)
    g.fillStyle = '#d4d0c8'; g.fillRect(0, 60, 64, 4); g.fillRect(60, 0, 4, 64)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = anisotropy
  return texture
}
