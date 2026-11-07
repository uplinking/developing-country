/**
 * A virtual camera over a real piece of UI. The scene renders once, flat, at a fixed width; the
 * camera flies a Catmull-Rom path through keyframes, tilting and turning the plane under it, and
 * dips to the frame colour where a run is cut. Pure maths here; `mountCameraFilm` drives the DOM.
 */

export interface FilmTarget {
  selector: string
  /** Negative counts from the end; out of range clamps to the last match. */
  index?: number
}

/** One point the camera passes through. */
export interface FilmKey {
  /** Seconds to travel here from the previous key. Ignored on the first and on cuts. */
  after?: number
  /** Point on the target box, 0–1 on each axis; the centre by default. */
  ax?: number
  ay?: number
  /** Jump here behind a dip instead of flying. Starts a new run. */
  cut?: boolean
  dx?: number
  dy?: number
  /** The frame shown, held still, when the reader prefers reduced motion. The first key otherwise. */
  still?: boolean
  /** Omitted: the whole scene. */
  target?: FilmTarget
  /** Degrees the plane leans back from the camera. */
  tilt?: number
  /** Degrees the plane turns under the camera. */
  turn?: number
  /** Magnification over the scene fitted to the frame width; 1 shows the full width. */
  zoom?: number
}

export interface Camera {
  tilt: number
  turn: number
  x: number
  y: number
  /** Log of the scale, so a push in and a pull back read at the same speed. */
  zoom: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

interface Run {
  first: number
  last: number
  start: number
  end: number
}

export interface Timeline {
  loop: number
  runs: Run[]
  times: number[]
}

export const DIP_SECONDS = 0.45

const easeInOut = (u: number) => 0.5 - Math.cos(Math.PI * u) / 2
/** A lone shot keeps some speed at both ends, so a cut lands on motion rather than a standstill. */
const easeShot = (u: number) => 0.35 * u + 0.65 * easeInOut(u)
const catmullRom = (p0: number, p1: number, p2: number, p3: number, u: number) =>
  0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u ** 2 + (3 * p1 - p0 - 3 * p2 + p3) * u ** 3)

/** Where a key puts the camera, given the target's box in scene pixels and the fitted scale. */
export function resolveKey(key: FilmKey, box: Box | null, scene: { width: number; height: number }, fit: number): Camera {
  const frame = box ?? { x: 0, y: 0, width: scene.width, height: scene.height }
  return {
    tilt: key.tilt ?? 0,
    turn: key.turn ?? 0,
    x: frame.x + frame.width * (key.ax ?? 0.5) + (key.dx ?? 0),
    y: frame.y + frame.height * (key.ay ?? 0.5) + (key.dy ?? 0),
    zoom: Math.log(fit * (key.zoom ?? 1)),
  }
}

/** When each key is reached, and the runs the cuts split the path into. */
export function timeline(keys: readonly FilmKey[]): Timeline {
  const times: number[] = []
  const runs: Run[] = []
  let clock = 0
  keys.forEach((key, index) => {
    if (index > 0 && !key.cut) clock += key.after ?? 0
    times.push(clock)
    if (index === 0 || key.cut) runs.push({ first: index, last: index, start: clock, end: clock })
    const run = runs[runs.length - 1]!
    run.last = index
    run.end = clock
  })
  return { loop: clock, runs, times }
}

export function stillIndex(keys: readonly FilmKey[]): number {
  return Math.max(0, keys.findIndex((key) => key.still))
}

/**
 * The camera `seconds` into the loop: a Catmull-Rom curve through the run's keys, eased where the
 * run starts and ends, plus how far the dip covers the frame around a cut or the loop seam.
 */
export function cameraAt(cameras: readonly Camera[], { runs, times }: Timeline, seconds: number): { camera: Camera; dip: number } {
  const run = runs.find((candidate) => seconds < candidate.end) ?? runs[runs.length - 1]!
  if (run.last === run.first) return { camera: cameras[run.first]!, dip: 0 }
  let segment = run.first
  while (segment < run.last - 1 && seconds > times[segment + 1]!) segment++
  const length = times[segment + 1]! - times[segment]!
  const linear = length > 0 ? Math.min(1, Math.max(0, (seconds - times[segment]!) / length)) : 0
  let u = linear
  if (run.last - run.first === 1) u = easeShot(linear)
  else if (segment === run.first || segment === run.last - 1) u = easeInOut(linear)
  const at = (offset: number) => cameras[Math.min(run.last, Math.max(run.first, segment + offset))]!
  const [p0, p1, p2, p3] = [at(-1), at(0), at(1), at(2)]
  const curve = (field: keyof Camera) => catmullRom(p0[field], p1[field], p2[field], p3[field], u)
  const dip = Math.max(0, 1 - (seconds - run.start) / DIP_SECONDS, 1 - (run.end - seconds) / DIP_SECONDS)
  return {
    camera: { tilt: Math.max(0, curve('tilt')), turn: curve('turn'), x: curve('x'), y: curve('y'), zoom: curve('zoom') },
    dip,
  }
}

export function cameraTransform(camera: Camera, lens: { width: number; height: number }): string {
  const scale = Math.exp(camera.zoom)
  return `translate3d(${lens.width / 2}px, ${lens.height / 2}px, 0) rotateX(${camera.tilt}deg) rotateZ(${camera.turn}deg) scale(${scale}) translate3d(${-camera.x}px, ${-camera.y}px, 0)`
}

function pick(root: ParentNode, selector: string, index = 0): HTMLElement | undefined {
  const matches = root.querySelectorAll<HTMLElement>(selector)
  return matches[index < 0 ? Math.max(0, matches.length + index) : Math.min(index, matches.length - 1)]
}

/** Layout box inside the scene, which a transform on the scene does not change. */
function locate(scene: HTMLElement, target: FilmTarget): Box | null {
  const element = pick(scene, target.selector, target.index)
  if (!element) return null
  let x = 0
  let y = 0
  let node: HTMLElement | null = element
  while (node && node !== scene) {
    x += node.offsetLeft
    y += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return { x, y, width: element.offsetWidth, height: element.offsetHeight }
}

/**
 * Film one `[data-camera-film]` root. It holds still until it scrolls near the viewport, runs only
 * while visible in a visible tab, and shows its still key for reduced motion. Returns a disposer.
 */
export function mountCameraFilm(root: HTMLElement): () => void {
  const lens = root.querySelector<HTMLElement>('[data-film-lens]')
  const scene = root.querySelector<HTMLElement>('[data-film-scene]')
  const dip = root.querySelector<HTMLElement>('[data-film-dip]')
  let keys: FilmKey[] = []
  try {
    keys = JSON.parse(root.dataset.keys ?? '[]') as FilmKey[]
  } catch {
    keys = []
  }
  if (!(lens && scene && dip) || keys.length === 0) return () => undefined

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  const plan = timeline(keys)
  let cameras: Camera[] | null = null
  // Until it first plays, the film rests on its still frame, which doubles as its poster.
  let started = false
  let elapsed = 0
  let last = 0
  let frame = 0
  let visible = false

  const draw = () => {
    const size = { width: lens.clientWidth, height: lens.clientHeight }
    if (size.width === 0) return
    const sceneSize = { width: scene.offsetWidth, height: scene.offsetHeight }
    const fit = size.width / sceneSize.width
    cameras ??= keys.map((key) => resolveKey(key, key.target ? locate(scene, key.target) : null, sceneSize, fit))
    const shot = !started || reduced.matches || plan.loop === 0
      ? { camera: cameras[stillIndex(keys)]!, dip: 0 }
      : cameraAt(cameras, plan, elapsed)
    lens.style.perspective = `${Math.round(size.width * 1.4)}px`
    scene.style.transform = cameraTransform(shot.camera, size)
    dip.style.opacity = shot.dip.toFixed(3)
    root.dataset.filmReady = ''
  }

  const step = (now: number) => {
    elapsed = (elapsed + Math.min(0.05, (now - last) / 1000)) % plan.loop
    last = now
    draw()
    frame = requestAnimationFrame(step)
  }

  const sync = () => {
    cancelAnimationFrame(frame)
    if (visible && !document.hidden && !reduced.matches && plan.loop > 0) {
      started = true
      last = performance.now()
      frame = requestAnimationFrame(step)
    } else {
      draw()
    }
  }

  const remeasure = () => {
    cameras = null
    draw()
  }

  const resizes = new ResizeObserver(remeasure)
  resizes.observe(lens)
  resizes.observe(scene)
  const views = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false
    sync()
  }, { rootMargin: '120px 0px' })
  views.observe(root)
  document.addEventListener('visibilitychange', sync)
  reduced.addEventListener('change', sync)
  // Images change the boxes the keys aim at; re-aim once each has a size.
  scene.querySelectorAll('img').forEach((image) => {
    if (!image.complete) image.addEventListener('load', remeasure, { once: true })
  })
  draw()

  return () => {
    cancelAnimationFrame(frame)
    resizes.disconnect()
    views.disconnect()
    document.removeEventListener('visibilitychange', sync)
    reduced.removeEventListener('change', sync)
  }
}
