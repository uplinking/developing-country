/**
 * The Sri Lanka landing island: a voxel diorama of misty ranges, a highland reservoir, tea
 * terraces, a waterfall feeding a river, elephants drinking at the bank, a dagoba, and Colombo's
 * Lotus Tower and port on the far coast. Pure and deterministic: the same seed builds the same
 * island, and nothing here touches the DOM or WebGL. `render.ts` draws what this returns.
 */

export const ISLAND = { width: 200, height: 84, depth: 180 } as const
/** Sea, river and pool surface height. */
export const WATER_LEVEL = 3
/** The plateau's front face, where the waterfall drops. */
export const CLIFF_Z = 60
export const FALLS_X = 95
/** The front edge's row at the middle of the island; the river reaches the edge a little west of it. */
export const RIVER_MOUTH = 128
/** How many rows the river falls once it leaves the front edge. */
export const SPILL_DEPTH = 25
/** How hard the river is thrown off the edge: cells towards the viewer over the first row of fall. */
const SPILL_THROW = 5
/** Strands the fall is combed into. */
const SPILL_STRANDS = 72
/** How far past the fall's own edges stray drops fly, as a share of its half-width. */
const SPILL_STRAY = 1.22
/** What the drops turn as they come apart: water blue first, then whitish blue, white and the sunset's orange. */
const SPILL_TINTS = [0x7fb8d8, 0xc6ddee, 0xf7f2ea, 0xffc48e] as const

/**
 * The near shore bows towards the viewer: flat across the middle, where the river leaves, and
 * sweeping forward at both sides, so the island reads as a bowl held up to the camera.
 */
export function frontEdge(x: number): number {
  const u = Math.min(1, Math.abs(x - ISLAND.width / 2) / (ISLAND.width / 2))
  return RIVER_MOUTH + 12 * u * u + 38 * (1 - Math.sqrt(1 - 0.98 * u * u))
}

/** Visible voxels of one mesh: xyz triples and matching sRGB colours, 0–1. */
export interface VoxelLayer {
  positions: Int16Array<ArrayBuffer>
  colors: Float32Array<ArrayBuffer>
}

export interface WaterLayer extends VoxelLayer {
  /** 1 where the cell is open sea, 0 for rivers, pools and the reservoir. */
  sea: Uint8Array<ArrayBuffer>
}

export interface Cloud extends VoxelLayer {
  x: number
  y: number
  z: number
  /** Drift in voxels per second. */
  speed: number
}

/** How a part of an animal moves; render.ts gives each kind its motion. */
export type PartKind = 'body' | 'head' | 'trunk' | 'ear' | 'tail'

/** One rigid piece of an animal. Positions stay in island cells; the part turns about `pivot`. */
export interface AnimalPart extends VoxelLayer {
  kind: PartKind
  pivot: [x: number, y: number, z: number]
  /** Index of the part this one hangs from, or -1 for the body. */
  parent: number
  /** Which side an ear is on: -1 or 1; 0 for parts on the midline. */
  side: number
}

export interface Animal {
  /** 1 faces +x, -1 faces -x. */
  face: 1 | -1
  drinking: boolean
  /** Offset into the motion cycles, so two animals never move in step. */
  phase: number
  parts: AnimalPart[]
}

/** The river falling off the front edge. Voxels run top row first, so a prefix is a shorter fall. */
export interface SpillLayer extends VoxelLayer {
  /** How broken the water is at each voxel: 0 is a whole sheet, 255 the last stray drop. */
  thin: Uint8Array<ArrayBuffer>
  /** Each voxel's strand's place in the falling rhythm, 0–255, so strands never break in step. */
  lag: Uint8Array<ArrayBuffer>
}

export interface IslandScene {
  terrain: VoxelLayer
  /** Elephants, kept out of the terrain so they can move. */
  animals: Animal[]
  water: WaterLayer
  falls: VoxelLayer
  /** The river thrown off the front edge; `colors` holds the tint each strand's drops turn. */
  spill: SpillLayer
  clouds: Cloud[]
}

export function createNoise(seed: number) {
  const hash2 = (x: number, z: number) => {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + seed) | 0
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
  const hash3 = (x: number, y: number, z: number) => hash2(x + Math.imul(y, 7919), z - Math.imul(y, 104729))
  const vnoise = (x: number, z: number) => {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf)
    const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
  const fbm = (x: number, z: number, octaves = 4) => {
    let sum = 0, amp = 0.5, freq = 1, norm = 0
    for (let i = 0; i < octaves; i++) { sum += amp * vnoise(x * freq, z * freq); norm += amp; amp *= 0.5; freq *= 2 }
    return sum / norm
  }
  return { hash2, hash3, vnoise, fbm }
}

function createRng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/* The palette, by role. Water hues live in render.ts, which animates them. */
const P = {
  forestDeep: 0x2f5a35, forest: 0x3f6d3b, leaf: 0x4f7f42, leafLight: 0x6f9a4e, leafDark: 0x355f34,
  grass: 0x7da455, grassLight: 0x93b764, earth: 0x8b6a4b, earthDark: 0x6f5440,
  tea: 0x8fbd5d, teaDark: 0x5f9440, teaBush: 0x4f8a3a,
  hill: 0x3d7564, slate: 0x2f6f8f, blue: 0x3b81a8, blueLight: 0x5f9cc0, mist: 0xe9ebe6, stone: 0xd9d3c6,
  coral: 0xe07a5f, coralDeep: 0xc9634c, sandstone: 0xdcc6a6, rock: 0xb8ab9b,
  trunk: 0x7a5a42, palmTrunk: 0x9a7b5a, palm: 0x5d8f3f, palmLight: 0x7fae52, coconut: 0x8a6a3a,
  ele: 0x86817d, eleDark: 0x6a6562, eleEar: 0x978884, ivory: 0xf3eee2, eye: 0x2a2522,
  white: 0xf4f1ea, white2: 0xe4dfd5, gold: 0xc9a24d,
  bldg: 0xe7e3db, bldg2: 0xd3cec5, glass: 0x86abc3, roof: 0xbcb6ab, tile: 0xd06a50,
  lotusShaft: 0x6f8f6b, lotusBud: 0xd9838f, lotusPetal: 0xe9a3a8,
  crane: 0xd9603f, quay: 0xcfc9bd, hull: 0x2c3b4c, hullRed: 0xb44a3a,
  sand: 0xe6d9bd, wood: 0x6b4a33, foam: 0xeef4f3,
  flame: 0xd9583b, flameLight: 0xec7a4c, golden: 0xe2b33c, goldenLight: 0xf1cf5d, plum: 0x8a4a5e,
  bo: 0x86b552, boLight: 0xa3c968, boDark: 0x5f8f3d,
  hibiscus: 0xd8344a, bougain: 0xd2458c, bougainLight: 0xec80b4, frangipani: 0xf8f1e2, frangiHeart: 0xf2c84b, ixora: 0xea6a35,
  shrub: 0x467f38, shrubLight: 0x66a046, dryGrass: 0xc3c27c,
  flagBlue: 0x2f5fa8, flagYellow: 0xf0c53a, flagRed: 0xc8443a, flagOrange: 0xe88a35,
  water: 0x2f7fae, sea: 0x2a6c97,
} as const
type Colour = keyof typeof P
// SAFETY: P is a closed literal, so its own keys are exactly the Colour names.
const COLOURS = Object.keys(P) as Colour[]
// SAFETY: built from COLOURS, so every Colour has an id (1-based; 0 is empty air).
const ID = Object.fromEntries(COLOURS.map((name, i) => [name, i + 1])) as Record<Colour, number>
const CONTAINERS: Colour[] = ['coral', 'blue', 'palm', 'sandstone', 'gold']

const T = { EMPTY: 0, GROUND: 1, MOUNT: 2, TEA: 3, PLATEAU: 4, PLAIN: 5, SEA: 6, WATER: 7, SAND: 8 } as const

const PEAKS = [
  { x: -8, z: 30, h: 30, rx: 32, rz: 24, k: 1.15 },
  { x: 40, z: 2, h: 27, rx: 52, rz: 14, k: 1.15 }, // the low ridge behind the reservoir
  { x: 86, z: 22, h: 50, rx: 26, rz: 20, k: 1.5 }, // Sri Pada
  { x: 114, z: 14, h: 40, rx: 34, rz: 21, k: 1.15 },
  { x: 128, z: 36, h: 18, rx: 20, rz: 14, k: 1.15 },
]
/** A highland reservoir held back by an earth bund, like the hill-country tanks. */
const LAKE = { x: 48, z: 26, rx: 27, rz: 12, y: 17 }
const PLATEAU_TOP = 30
const FALL_TOP = 28
const STUPA = { x: 176, z: 98 }
/** A sacred Bo tree on its walled terrace, in the open ground below the tea hills. */
const BO = { x: 36, z: 101 }
const LOTUS = { x: 146, z: 27 }

export function buildLankaIsland(seed = 1948): IslandScene {
  const { width: W, height: H, depth: D } = ISLAND
  const WL = WATER_LEVEL
  const { hash2, hash3, vnoise, fbm } = createNoise(seed)
  const rng = createRng(seed)

  const grid = new Uint8Array(W * H * D)
  const idx = (x: number, y: number, z: number) => (y * D + z) * W + x
  // While a moving part is being built, its voxels go here instead of into the terrain grid.
  let capture: Map<number, number> | null = null
  const set = (x: number, y: number, z: number, c: Colour, overwrite = true) => {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z)
    if (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D) return
    const i = idx(x, y, z)
    if (capture) {
      if (overwrite || !capture.has(i)) capture.set(i, ID[c])
      return
    }
    if (!overwrite && grid[i]) return
    grid[i] = ID[c]
  }
  const filled = (x: number, y: number, z: number) => {
    if (y < 0) return true
    if (x < 0 || z < 0 || x >= W || z >= D || y >= H) return false
    return grid[idx(x, y, z)] !== 0
  }

  /* ---------- terrain ---------- */
  const mountainH = (x: number, z: number) => {
    let max = 0, sum = 0
    for (const p of PEAKS) {
      const d = Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz)
      if (d >= 1) continue
      const v = p.h * Math.pow(1 - d, p.k)
      sum += v
      if (v > max) max = v
    }
    let h = max + 0.3 * (sum - max)
    h += (fbm(x * 0.05, z * 0.05) - 0.5) * 10 * Math.min(1, h / 18)
    return h * clamp((134 - x) / 18, 0, 1)
  }
  // Below the falls the river swings through a couple of bends, drifting west and widening as it nears the edge.
  const riverX = (z: number) => {
    const run = Math.max(0, z - 70)
    return 95 - (4 + run * 0.17) * Math.sin(run / 8) - Math.max(0, z - 84) * 0.35
  }
  const riverW = (z: number) => 7 + Math.max(0, z - 84) * 0.26
  // The elephants' drinking place: a trampled clearing on the east bank. It runs well back from
  // them, because from the camera's height the ground behind an elephant is what frames its back.
  const EL = { z: 99, x: Math.round(riverX(99) + riverW(99) / 2 + 10) }
  const clearing = (x: number, z: number) => Math.hypot((x - EL.x - 5) / 21, (z - EL.z) / (z < EL.z ? 34 : 11))
  const channel = (z: number) => {
    const t = clamp((z - 36) / (CLIFF_Z - 36), 0, 1)
    return { c: FALLS_X + Math.sin(z * 0.25) * 1.5 * (1 - t), hw: 2.2 + 2.3 * t }
  }
  const plateauH = (x: number, z: number) => {
    if (z < 34 || z > CLIFF_Z) return 0
    const nearFalls = Math.abs(x - FALLS_X) < 10
    if (!nearFalls && z > CLIFF_Z - Math.round(vnoise(x * 0.18, 3) * 2.2)) return 0
    const ex = Math.abs(x - FALLS_X) - 19 + (vnoise(z * 0.2, 7) - 0.5) * 7
    if (ex <= 0) return PLATEAU_TOP + Math.round(Math.max(0, fbm(x * 0.1, z * 0.1) - 0.5) * 4)
    if (ex < 13) return Math.round(PLATEAU_TOP - ex * 2.2 - vnoise(x * 0.3, z * 0.3) * 3)
    return 0
  }
  const teaH = (x: number, z: number) => {
    const a = Math.hypot((x - 14) / 32, (z - 80) / 30)
    const b = Math.hypot((x - 58) / 19, (z - 94) / 16)
    const v = Math.max(19 * Math.exp(-a * a * 2.2), 11 * Math.exp(-b * b * 2.4))
    return Math.floor(v / 2) * 2
  }
  const stupaHill = (x: number, z: number) => {
    const d = Math.hypot(x - STUPA.x, z - STUPA.z) / 18
    return Math.round(Math.min(9, 15 * Math.exp(-d * d * 2.4)))
  }
  const isSea = (x: number, z: number) => {
    const edge = 171 + Math.round((vnoise(z * 0.3, 1) - 0.5) * 3)
    return (x >= edge && z <= 64 + Math.round(vnoise(x * 0.2, 9) * 3) - Math.max(0, 180 - x)) || (x >= 148 && z <= 6)
  }

  const lakeDistance = (x: number, z: number) => Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz) + (vnoise(x * 0.2, z * 0.2) - 0.5) * 0.22

  const HM = new Int16Array(W * D).fill(-1)
  const TY = new Uint8Array(W * D)
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    let h = 5 + Math.round(Math.max(-0.5, fbm(x * 0.035, z * 0.04 + 9) - 0.45) * 9)
    let t: number = T.GROUND
    const m = mountainH(x, z)
    if (m > h) { h = Math.round(m); t = T.MOUNT }
    if (x >= 120 && (z <= 50 || (x >= 150 && z <= 64)) && (t === T.GROUND || m < 7)) { h = 5; t = T.PLAIN }
    const tea = teaH(x, z)
    if (tea > 0 && 5 + tea >= h) { h = 5 + tea; t = T.TEA }
    const lake = lakeDistance(x, z)
    if (lake < 1) { h = LAKE.y; t = T.WATER }
    else if (lake < 2.6) {
      // a bowl of hills: rising behind the water, stepping down towards the tea country in front
      const shore = z < LAKE.z
        ? LAKE.y + 1 + Math.round((lake - 1) * 7)
        : LAKE.y + 1 - Math.round(Math.max(0, lake - 1.25) * 9)
      if (shore > h) { h = shore; t = z < LAKE.z ? T.MOUNT : T.GROUND }
    }
    const p = plateauH(x, z)
    if (p > h) { h = p; t = T.PLATEAU }
    const sh = stupaHill(x, z)
    if (sh > 0 && 5 + sh > h) { h = 5 + sh; t = T.GROUND }
    if (isSea(x, z)) { h = WL; t = T.SEA }
    const dr = Math.abs(x - riverX(z)) - riverW(z) / 2 + (vnoise(z * 0.3, x * 0.02) - 0.5) * 1.6
    if (z > CLIFF_Z) {
      const pool = Math.hypot((x - FALLS_X) / 14, (z - 67) / 6.5) < 1
      if (pool || (z > 66 && dr < 0)) { h = WL; t = T.WATER }
      else if (t === T.GROUND && (dr < 3 || Math.hypot((x - FALLS_X) / 17, (z - 67) / 9) < 1)) h = 4
    }
    if (t === T.PLATEAU && h >= PLATEAU_TOP) {
      const ch = channel(z)
      if (Math.abs(x - ch.c) <= ch.hw) { h = FALL_TOP; t = T.WATER }
    }
    // The near shore crumbles away, except the river and its banks, which run cleanly to the mouth.
    const edge = Math.round(frontEdge(x))
    const riverside = z > CLIFF_Z && dr < 2.5
    const crumbles = z > edge - 18 && fbm(x * 0.09, z * 0.09 + 40) < (z - edge + 18) / 24
    if (z > edge || (crumbles && !riverside)) { h = -1; t = T.EMPTY }
    HM[x + z * W] = h
    TY[x + z * W] = t
  }
  // beaches where the plain meets the sea
  for (let z = 1; z < D - 1; z++) for (let x = 1; x < W - 1; x++) {
    const i = x + z * W
    if (TY[i] !== T.PLAIN) continue
    if (TY[i + 1] === T.SEA || TY[i - 1] === T.SEA || TY[i + W] === T.SEA || TY[i - W] === T.SEA) { HM[i] = 4; TY[i] = T.SAND }
  }

  const colourFor = (t: number, x: number, y: number, z: number, h: number): Colour => {
    const n = hash3(x, y, z)
    switch (t) {
      case T.MOUNT: {
        const yy = y + (fbm(x * 0.08, z * 0.08 + y * 0.03) - 0.5) * 9
        if (yy < 11) return n < 0.5 ? 'forest' : 'forestDeep'
        if (yy < 18) return n < 0.7 ? 'forestDeep' : 'hill'
        if (yy < 26) return n < 0.75 ? 'hill' : 'slate'
        if (yy > 30 && vnoise(x * 0.25, y * 0.35 + z * 0.1) > 0.68) return 'mist'
        if (yy < 36) return 'slate'
        return n < 0.6 ? 'blue' : 'blueLight'
      }
      case T.PLATEAU: {
        if (y >= h - 1) return n < 0.5 ? 'grass' : 'leaf'
        const b = vnoise(Math.floor(y + vnoise(x * 0.12, z * 0.12 + y * 0.2) * 5) * 0.7, 5)
        return b < 0.3 ? 'coral' : b < 0.42 ? 'coralDeep' : b < 0.7 ? 'sandstone' : 'rock'
      }
      case T.TEA:
        if (y === h) return (h >> 1) & 1 ? 'tea' : 'teaDark'
        return y >= h - 1 ? 'teaDark' : 'earth'
      case T.GROUND: {
        if (y === h) {
          const c = clearing(x, z) + (vnoise(x * 0.4, z * 0.4) - 0.5) * 0.5
          if (c < 0.8) return n < 0.55 ? 'sand' : 'dryGrass'
          if (c < 1.1) return n < 0.5 ? 'dryGrass' : 'grassLight'
          return vnoise(x * 0.15, z * 0.15) > 0.5 ? 'grass' : 'grassLight'
        }
        // Creepers spill over the island's near rim.
        const open = z + 1 >= D || HM[x + (z + 1) * W] < y
        if (open && y >= h - 2 - Math.floor(hash2(x, 5) * 3) && n < 0.7) return n < 0.35 ? 'leafDark' : 'leaf'
        return n < 0.6 ? 'earth' : 'earthDark'
      }
      case T.PLAIN: return y === h ? 'grassLight' : 'earth'
      case T.SAND: return 'sand'
      case T.SEA: return y === h ? 'sea' : 'sand'
      case T.WATER: return y === h ? 'water' : y >= h - 2 ? 'sand' : 'rock'
    }
    return 'rock'
  }
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const h = HM[x + z * W], t = TY[x + z * W]
    for (let y = 0; y <= h; y++) set(x, y, z, colourFor(t, x, y, z, h))
  }
  const cell = (x: number, z: number) => clamp(Math.round(x), 0, W - 1) + clamp(Math.round(z), 0, D - 1) * W
  const groundAt = (x: number, z: number) => HM[cell(x, z)]
  const typeAt = (x: number, z: number) => TY[cell(x, z)]

  /* ---------- shape helpers ---------- */
  type Paint = Colour | ((x: number, y: number, z: number, dy: number) => Colour)
  const paint = (c: Paint, x: number, y: number, z: number, dy = 0) => (c instanceof Function ? c(x, y, z, dy) : c)
  const blob = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: Paint, rough = 0.25) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz
          if (dx * dx + dy * dy + dz * dz <= 1 - rough * (hash3(x, y, z) - 0.3)) set(x, y, z, paint(c, x, y, z, dy), false)
        }
  }
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: Paint) => {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, y, z, paint(c, x, y, z))
  }
  const disc = (cx: number, cz: number, y: number, r: number, c: Paint) => {
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) <= r) set(x, y, z, paint(c, x, y, z))
  }

  /* ---------- flora ---------- */
  const leaf: Paint = (x, y, z, dy) => {
    const n = hash3(x, y, z)
    if (dy > 0.35) return n < 0.7 ? 'leafLight' : 'leaf'
    if (dy > -0.25) return n < 0.65 ? 'leaf' : n < 0.85 ? 'leafLight' : 'leafDark'
    return n < 0.7 ? 'leafDark' : 'forestDeep'
  }
  const darkLeaf: Paint = (x, y, z, dy) => {
    const n = hash3(x, y, z)
    if (dy > 0.3) return n < 0.6 ? 'leaf' : 'forest'
    return n < 0.6 ? 'forestDeep' : 'leafDark'
  }
  // Flamboyant: a broad crown of coral-red flowers over green.
  const flameLeaf: Paint = (x, y, z, dy) => {
    const n = hash3(x, y, z)
    if (dy > 0.05) return n < 0.55 ? 'flame' : n < 0.85 ? 'flameLight' : 'leaf'
    return n < 0.35 ? 'flame' : n < 0.75 ? 'leaf' : 'leafDark'
  }
  // Ehela, the golden shower tree, in bloom.
  const goldenLeaf: Paint = (x, y, z, dy) => {
    const n = hash3(x, y, z)
    if (dy > 0) return n < 0.55 ? 'golden' : n < 0.85 ? 'goldenLight' : 'leafLight'
    return n < 0.4 ? 'golden' : n < 0.8 ? 'leaf' : 'leafDark'
  }
  // Na, the ironwood, flushes pink-red with new leaves.
  const naLeaf: Paint = (x, y, z, dy) => {
    const n = hash3(x, y, z)
    if (dy > 0.25) return n < 0.5 ? 'plum' : 'flame'
    return n < 0.7 ? 'forestDeep' : 'leafDark'
  }
  const LEAVES = { green: leaf, dark: darkLeaf, flame: flameLeaf, golden: goldenLeaf, na: naLeaf } satisfies Record<string, Paint>
  type TreeKind = keyof typeof LEAVES
  const tree = (x: number, z: number, s = 1, kind: TreeKind = 'green') => {
    const gy = groundAt(x, z) + 1
    const th = Math.round((3.5 + rng() * 3) * s)
    for (let i = 0; i < th; i++) set(x, gy + i, z, 'trunk')
    const r = (3 + rng() * 1.8) * s * (kind === 'flame' ? 1.15 : 1)
    const cy = gy + th + r * 0.4
    const leaf = LEAVES[kind]
    const squash = kind === 'flame' ? 0.45 : kind === 'na' ? 0.85 : 0.62
    blob(x + 0.5, cy, z + 0.5, r, r * squash, r, leaf)
    const extra = 1 + Math.floor(rng() * 3)
    for (let k = 0; k < extra; k++) {
      const a = rng() * Math.PI * 2, rr = r * (0.5 + rng() * 0.25)
      const ox = Math.cos(a) * r * 0.85, oz = Math.sin(a) * r * 0.85
      set(x + ox * 0.5, cy - 1, z + oz * 0.5, 'trunk', false)
      blob(x + 0.5 + ox, cy - r * 0.25 + rng() * r * 0.4, z + 0.5 + oz, rr, rr * 0.6, rr, leaf)
    }
  }
  // Garden shrubs in flower: hibiscus, bougainvillea, frangipani and ixora.
  const BLOOMS = {
    hibiscus: (n: number): Colour => (n < 0.75 ? 'hibiscus' : 'flame'),
    bougainvillea: (n: number): Colour => (n < 0.6 ? 'bougain' : 'bougainLight'),
    frangipani: (n: number): Colour => (n < 0.78 ? 'frangipani' : 'frangiHeart'),
    ixora: (n: number): Colour => (n < 0.7 ? 'ixora' : 'flameLight'),
  } satisfies Record<string, (n: number) => Colour>
  // SAFETY: BLOOMS is a closed literal, so its own keys are exactly its kinds.
  const BLOOM_KINDS = Object.keys(BLOOMS) as (keyof typeof BLOOMS)[]
  const flowerBush = (x: number, z: number, s = 1) => {
    const gy = groundAt(x, z) + 1
    const bloom = BLOOMS[BLOOM_KINDS[Math.floor(rng() * BLOOM_KINDS.length)]]
    const r = (1.6 + rng() * 1.3) * s
    blob(x + 0.5, gy + r * 0.45, z + 0.5, r, r * 0.75, r, (bx, by, bz, dy) => {
      const n = hash3(bx, by, bz)
      if (dy > -0.1 && n < 0.5) return bloom(hash3(bz, bx, by))
      return n < 0.75 ? 'shrub' : 'shrubLight'
    }, 0.35)
  }
  const palm = (x: number, z: number, s = 1) => {
    const gy = groundAt(x, z) + 1
    const th = Math.round((10 + rng() * 6) * s)
    const lx = (rng() - 0.5) * 7, lz = (rng() - 0.5) * 5
    let px = x, pz = z
    for (let i = 0; i < th; i++) {
      const f = (i / th) ** 2
      px = x + lx * f; pz = z + lz * f
      set(px, gy + i, pz, i % 3 === 0 ? 'trunk' : 'palmTrunk')
    }
    const ty = gy + th
    set(px, ty, pz, 'palm')
    set(px + 1, ty - 1, pz, 'coconut'); set(px, ty - 1, pz + 1, 'coconut')
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + rng() * 0.4
      const L = (5 + rng() * 2.5) * s
      for (let st = 0; st <= L; st += 0.5) {
        const fx = px + Math.cos(a) * st, fz = pz + Math.sin(a) * st
        const fy = ty + 0.7 * st - 0.17 * st * st
        set(fx, fy, fz, st < L * 0.55 ? 'palm' : 'palmLight', false)
        if (st > 1.5) set(fx - Math.sin(a), fy - 0.6, fz + Math.cos(a), 'palm', false)
      }
    }
  }

  /** The sacred fig: a thick, buttressed trunk, a vast pale crown, a white terrace wall and prayer flags. */
  const boTree = (cx: number, cz: number) => {
    const gy = groundAt(cx, cz) + 1
    for (let z = cz - 7; z <= cz + 7; z++) for (let x = cx - 7; x <= cx + 7; x++) {
      for (let y = groundAt(x, z) + 1; y < gy; y++) set(x, y, z, 'white2') // level the terrace
      const edge = Math.max(Math.abs(x - cx), Math.abs(z - cz))
      if (edge === 7) { set(x, gy, z, 'white'); set(x, gy + 1, z, (x + z) % 2 ? 'white' : 'white2'); set(x, gy + 2, z, 'gold') }
      else set(x, gy - 1, z, 'sand')
    }
    for (let y = gy; y < gy + 13; y++) disc(cx + 0.5, cz + 0.5, y, y < gy + 2 ? 2.8 : 1.9, (x, yy, z) => (hash3(x, yy, z) < 0.3 ? 'earthDark' : 'trunk'))
    const crown = gy + 19
    for (let k = 0; k < 5; k++) { // limbs reaching into the crown
      const a = (k / 5) * Math.PI * 2 + 0.4
      for (let t = 0; t <= 1; t += 0.1) set(cx + Math.cos(a) * 6 * t, gy + 11 + 5 * t, cz + Math.sin(a) * 6 * t, 'trunk')
    }
    const boLeaf: Paint = (x, y, z, dy) => {
      const n = hash3(x, y, z)
      if (dy > 0.3) return n < 0.6 ? 'boLight' : 'bo'
      return n < 0.55 ? 'bo' : n < 0.85 ? 'leaf' : 'boDark'
    }
    blob(cx + 0.5, crown, cz + 0.5, 9, 4.5, 9, boLeaf, 0.3)
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2
      blob(cx + 0.5 + Math.cos(a) * 7, crown - 1 + (k % 2) * 2, cz + 0.5 + Math.sin(a) * 7, 4.5, 2.8, 4.5, boLeaf, 0.3)
    }
    // a string of Buddhist flags from a limb down to the terrace wall
    const FLAG: Colour[] = ['flagBlue', 'flagYellow', 'flagRed', 'white', 'flagOrange']
    for (let i = 0; i <= 12; i++) {
      const t = i / 12
      set(cx + 2 + t * 5, gy + 10 - t * 7 - Math.sin(t * Math.PI) * 1.5, cz + 7, FLAG[i % FLAG.length])
    }
  }

  /* ---------- landmarks ---------- */
  interface PartCells { kind: PartKind; pivot: [number, number, number]; parent: number; side: number; cells: Map<number, number> }
  const herd: { face: 1 | -1; drinking: boolean; phase: number; parts: PartCells[] }[] = []
  const elephant = (cx: number, cz: number, s: number, face: 1 | -1, drink: boolean, phase: number) => {
    const gy = groundAt(cx, cz) + 1
    const X = (dx: number) => cx + dx * face
    const skin: Paint = (x, y, z) => (hash3(x, y, z) < 0.25 ? 'eleDark' : 'ele')
    const parts: PartCells[] = []
    const part = (kind: PartKind, pivot: [number, number, number], parent: number, side: number, build: () => void) => {
      capture = new Map()
      build()
      parts.push({ kind, pivot, parent, side, cells: capture })
      capture = null
      return parts.length - 1
    }
    const body = part('body', [cx, gy, cz], -1, 0, () => {
      for (const [lx, lz] of [[3.4, -1.9], [3.4, 1.9], [-3.4, -1.9], [-3.4, 1.9]]) {
        const fx = X(lx * s), fz = cz + lz * s
        const base = groundAt(fx, fz) + 1
        for (let y = base; y < gy + 5 * s; y++) disc(fx, fz, y, 1.45 * s, y < base + 1 ? 'eleDark' : skin)
      }
      blob(cx, gy + 6.6 * s, cz, 6.2 * s, 3.9 * s, 3.5 * s, skin, 0.05)
      blob(X(-1.5 * s), gy + 8 * s, cz, 4 * s, 2.6 * s, 3 * s, skin, 0.05)
    })
    const head = part('head', [X(4.2 * s), gy + 8.4 * s, cz], body, 0, () => {
      blob(X(6.4 * s), gy + 8.2 * s, cz, 2.7 * s, 3 * s, 2.6 * s, skin, 0.05)
      for (const side of [-1, 1]) {
        set(X(7.7 * s), gy + 8.8 * s, cz + side * 2.1 * s, 'eye')
        for (let k = 0; k < 3 * s; k++) set(X((8.3 + k * 0.7) * s), gy + (5.9 - k * 0.5) * s, cz + side * 1.3 * s, 'ivory')
      }
    })
    part('trunk', [X(8.4 * s), gy + 7.6 * s, cz], head, 0, () => {
      const reach = drink ? 8.6 : 5.5
      for (let t = 0; t <= 1; t += 0.02) {
        const dx = 8.4 + 2.4 * t + (drink ? 0 : -1.2 * t * t)
        disc(X(dx * s), cz, gy + 7.4 * s - reach * s * Math.pow(t, 1.15), (1.3 - 0.6 * t) * s, skin)
      }
    })
    for (const side of [-1, 1]) {
      part('ear', [X(4.9 * s), gy + 8 * s, cz + side * 1.2 * s], head, side, () => {
        blob(X(4.9 * s), gy + 8 * s, cz + side * 2.9 * s, 1.1 * s, 2.9 * s, 2.3 * s, 'eleEar', 0.05)
      })
    }
    part('tail', [X(-6.2 * s), gy + 7.6 * s, cz], body, 0, () => {
      for (let k = 0; k < 4 * s; k++) set(X(-6.3 * s - k * 0.15), gy + 7.4 * s - k, cz, k > 4 * s - 2 ? 'eleDark' : 'ele')
    })
    herd.push({ face, drinking: drink, phase, parts })
  }
  const stupa = (cx: number, cz: number) => {
    const gy = groundAt(cx, cz) + 1
    for (let y = gy - 4; y < gy; y++) disc(cx, cz, y, 10, 'white2')
    disc(cx, cz, gy, 10, 'white2'); disc(cx, cz, gy + 1, 9.2, 'white')
    const R = 8.4, RY = 8, y0 = gy + 2
    for (let y = y0; y <= y0 + RY; y++) {
      const k = (y - y0) / RY
      const r = R * Math.sqrt(Math.max(0, 1 - k * k))
      if (r > 0.6) disc(cx, cz, y, r, (x, yy, z) => (hash3(x, yy, z) < 0.2 ? 'white2' : 'white'))
    }
    box(cx - 2, y0 + RY, cz - 2, cx + 1, y0 + RY + 2, cz + 1, 'white2')
    for (let y = y0 + RY + 3, k = 0; k < 8; y++, k++) disc(cx, cz, y, 1.6 - k * 0.17, 'white')
    set(cx, y0 + RY + 11, cz, 'gold')
  }
  const building = (x0: number, z0: number, w: number, d: number, hgt: number, tower: boolean) => {
    const gy = 6
    const base: Colour = tower ? (rng() < 0.6 ? 'bldg' : 'bldg2') : rng() < 0.5 ? 'bldg' : 'white2'
    box(x0, gy, z0, x0 + w - 1, gy + hgt - 1, z0 + d - 1, (_x, y) => (tower && (y - gy) % 2 === 1 && y < gy + hgt - 1 ? 'glass' : base))
    box(x0, gy + hgt, z0, x0 + w - 1, gy + hgt, z0 + d - 1, tower ? 'roof' : 'tile')
    if (!tower && w > 2) box(x0 + 1, gy + hgt + 1, z0, x0 + w - 2, gy + hgt + 1, z0 + d - 1, 'tile')
  }
  const lotusTower = (cx: number, cz: number) => {
    const gy = 6
    for (let y = gy; y < gy + 4; y++) disc(cx, cz, y, 3.2 - (y - gy) * 0.5, 'lotusShaft')
    for (let y = gy + 4; y < gy + 30; y++) disc(cx, cz, y, 1.2, 'lotusShaft')
    blob(cx, gy + 32, cz, 3.4, 3.2, 3.4, (x, y, z, dy) => (dy > 0.2 || hash3(x, y, z) < 0.3 ? 'lotusPetal' : 'lotusBud'), 0.05)
    for (let y = gy + 35; y < gy + 44; y++) disc(cx, cz, y, y < gy + 38 ? 1 : 0.5, 'lotusShaft')
  }
  const crane = (x: number, z: number) => {
    const gy = 6
    for (const lz of [z, z + 2]) for (const lx of [x, x + 3]) box(lx, gy, lz, lx, gy + 8, lz, 'crane')
    box(x, gy + 4, z, x + 3, gy + 4, z + 2, 'crane')
    box(x - 3, gy + 9, z + 1, x + 12, gy + 9, z + 1, 'crane')
    box(x, gy + 10, z, x + 3, gy + 11, z + 2, 'white2')
    box(x + 1, gy + 12, z + 1, x + 1, gy + 14, z + 1, 'crane')
  }
  const container = (): Colour => CONTAINERS[Math.floor(rng() * CONTAINERS.length)]
  const ship = (x0: number, z0: number, len: number, wid: number, bridgeAtEnd: boolean) => {
    box(x0, 2, z0, x0 + wid - 1, 2, z0 + len - 1, 'hullRed')
    box(x0, 3, z0, x0 + wid - 1, 5, z0 + len - 1, 'hull')
    for (let z = z0 + 2; z < z0 + len - 7; z += 3)
      for (let x = x0 + 1; x < x0 + wid - 1; x++) box(x, 6, z, x, 5 + 1 + Math.floor(rng() * 3), z + 1, container())
    const bz = bridgeAtEnd ? z0 + len - 5 : z0
    box(x0, 6, bz, x0 + wid - 1, 11, bz + 3, 'white')
    box(x0 + 1, 12, bz + 1, x0 + wid - 2, 13, bz + 2, 'hullRed')
  }
  const oruwa = (cx: number, cz: number) => {
    const y = WL + 1
    box(cx, y, cz - 4, cx, y, cz + 4, 'wood')
    box(cx, y + 1, cz - 3, cx, y + 1, cz + 3, 'wood')
    box(cx + 4, y, cz - 2, cx + 4, y, cz + 2, 'wood')
    box(cx, y + 2, cz - 2, cx + 4, y + 2, cz - 2, 'trunk')
    box(cx, y + 2, cz + 2, cx + 4, y + 2, cz + 2, 'trunk')
    box(cx, y + 2, cz, cx, y + 4, cz, 'coral')
    set(cx, y + 5, cz, 'eleDark')
  }

  /* ---------- place everything ---------- */
  elephant(EL.x, EL.z, 1.3, -1, true, 0)
  elephant(EL.x + 16, EL.z - 7, 0.72, -1, false, 0.37)
  stupa(STUPA.x, STUPA.z)
  boTree(BO.x, BO.z)
  const canoeZ = 118
  oruwa(Math.round(riverX(canoeZ) - 2), canoeZ)

  // Colombo: low tiled houses inland, towers by the water, the Lotus Tower above it all
  lotusTower(LOTUS.x, LOTUS.z)
  for (let gx = 121; gx < 158; gx += 4) for (let gz = 13; gz < 49; gz += 4) {
    if (Math.abs(gx - LOTUS.x) < 6 && Math.abs(gz - LOTUS.z) < 6) continue
    if (rng() < 0.18) continue
    const w = 2 + Math.floor(rng() * 2), d = 2 + Math.floor(rng() * 2)
    let ok = true
    for (let z = gz; z < gz + d; z++) for (let x = gx; x < gx + w; x++) if (typeAt(x, z) !== T.PLAIN) ok = false
    if (!ok) continue
    const tall = Math.max(0, 1 - Math.hypot(gx - 150, gz - 22) / 24)
    if (tall > 0.18) building(gx, gz, w, d, Math.round(5 + tall * 22 * (0.45 + rng() * 0.75)), true)
    else building(gx, gz, w, d, 2 + Math.floor(rng() * 2), false)
  }
  // the port: a quay of stacked containers, gantry cranes, ships alongside and at anchor
  for (let z = 26; z <= 62; z++) for (let x = 158; x < 172; x++) if (typeAt(x, z) !== T.SEA) set(x, 5, z, 'quay')
  for (let z = 28; z < 60; z += 4) for (let x = 159; x < 166; x++) {
    if (rng() < 0.2) continue
    box(x, 6, z, x, 5 + 1 + Math.floor(rng() * 3), z + 2, container())
  }
  for (const cz of [30, 38, 46, 54]) crane(166, cz)
  ship(175, 30, 28, 5, true)
  ship(188, 8, 22, 4, false)
  ship(160, 0, 16, 4, false)

  // trees gather in groves, palms line the river, smaller trees climb the foothills
  const westTree = (x: number): TreeKind => {
    if (x > 80) return 'green'
    const r = rng()
    return r < 0.12 ? 'flame' : r < 0.22 ? 'golden' : r < 0.3 ? 'na' : r < 0.48 ? 'dark' : 'green'
  }
  for (let gz = 0; gz < D; gz += 5) for (let gx = 0; gx < W; gx += 5) {
    const x = gx + Math.floor(rng() * 5), z = gz + Math.floor(rng() * 5)
    if (x >= W || z >= D) continue
    const t = typeAt(x, z), h = groundAt(x, z)
    if (h < 0) continue
    if (z > frontEdge(x) - 12) continue // the rim is a flower garden, planted below
    if (Math.hypot((x - EL.x - 5) / 30, (z - EL.z) / (z < EL.z ? 46 : 24)) < 1) continue
    if (Math.hypot(x - STUPA.x, z - STUPA.z) < 13) continue
    if (Math.max(Math.abs(x - BO.x), Math.abs(z - BO.z)) < 15) continue
    const dr = z > CLIFF_Z ? Math.abs(x - riverX(z)) - riverW(z) / 2 : 99
    if (dr < 3.5 || Math.hypot((x - FALLS_X) / 17, (z - 67) / 9) < 1.2) continue
    if (lakeDistance(x, z) < 1.7) continue // keep the reservoir in view
    const p = rng()
    const grove = fbm(x * 0.06 + 3, z * 0.06)
    if (t === T.GROUND) {
      if (z < CLIFF_Z && h < 6 && x > 110) continue
      if (x > riverX(z) + riverW(z) / 2 + 3 && z > CLIFF_Z - 6) {
        // east of the river: coconut country
        if (grove > 0.45 ? p < 0.5 : p < 0.14) palm(x, z, 0.9 + rng() * 0.25)
      } else if (dr < 7 && p < 0.22) palm(x, z)
      else if (grove > 0.52 && p < 0.75) tree(x, z, 1, westTree(x))
      else if (grove > 0.42 && p < 0.12) palm(x, z)
    } else if (t === T.PLATEAU) {
      const ch = channel(z)
      if (Math.abs(x - ch.c) > ch.hw + 2 && grove > 0.45 && p < 0.6) tree(x, z, 0.8)
    } else if (t === T.MOUNT) {
      if (h < 18 && grove > 0.45 && p < 0.5) tree(x, z, 0.5 + (18 - h) / 50)
    } else if (t === T.TEA) {
      if (p < 0.08) tree(x, z, 0.6)
    } else if (t === T.PLAIN || t === T.SAND) {
      if (p < 0.12 && x < 157 && z < 50) palm(x, z, 0.75)
    }
  }
  // the near rim: flowering shrubs, thickest at the very edge
  for (let gz = 0; gz < D; gz += 3) for (let gx = 0; gx < W; gx += 3) {
    const x = gx + Math.floor(rng() * 3), z = gz + Math.floor(rng() * 3)
    const near = z - (frontEdge(x) - 24)
    if (x >= W || z >= D || near < 0 || groundAt(x, z) < 0 || typeAt(x, z) !== T.GROUND) continue
    if (Math.abs(x - riverX(z)) - riverW(z) / 2 < 3 || clearing(x, z) < 1.25) continue
    if (Math.max(Math.abs(x - BO.x), Math.abs(z - BO.z)) < 9 || Math.hypot(x - STUPA.x, z - STUPA.z) < 12) continue
    if (rng() < 0.2 + 0.5 * Math.min(1, near / 20)) flowerBush(x, z, 0.8 + rng() * 0.5)
  }
  // tea bushes in rows along each terrace
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    if (TY[x + z * W] !== T.TEA) continue
    const h = HM[x + z * W]
    if (((x + z * 2) % 4 === 0 || (x * 2 - z) % 7 === 0) && hash2(x, z) < 0.7 && !filled(x, h + 1, z)) set(x, h + 1, z, 'teaBush')
  }

  /* ---------- emit visible voxels ---------- */
  const rgb = (hex: number, k: number, out: number[]) => {
    out.push(((hex >> 16) & 255) / 255 * k, ((hex >> 8) & 255) / 255 * k, (hex & 255) / 255 * k)
  }
  const tPos: number[] = [], tCol: number[] = [], wPos: number[] = [], wCol: number[] = [], wSea: number[] = []
  const seaId = ID.sea, waterId = ID.water
  for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const c = grid[idx(x, y, z)]
    if (!c) continue
    if (filled(x + 1, y, z) && filled(x - 1, y, z) && filled(x, y + 1, z) && filled(x, y - 1, z) && filled(x, y, z + 1) && filled(x, y, z - 1)) continue
    if (c === seaId || c === waterId) {
      wPos.push(x, y, z); wSea.push(c === seaId ? 1 : 0); rgb(P[COLOURS[c - 1]], 1, wCol)
      continue
    }
    let k = 1 + (hash3(x, y, z) - 0.5) * 0.1
    if (filled(x, y + 1, z)) k *= 0.9 // side voxels a touch darker than tops
    tPos.push(x, y, z); rgb(P[COLOURS[c - 1]], k, tCol)
  }

  /* ---------- the elephants, one layer per moving part ---------- */
  const animals: Animal[] = herd.map(({ face, drinking, phase, parts }) => ({
    face,
    drinking,
    phase,
    parts: parts.map(({ kind, pivot, parent, side, cells }) => {
      const pos: number[] = [], col: number[] = []
      for (const [i, c] of cells) {
        // Only the part's own surface: a voxel boxed in by its own part on every side never shows.
        if ([1, -1, W, -W, W * D, -W * D].every((step) => cells.has(i + step))) continue
        const x = i % W, z = Math.floor(i / W) % D, y = Math.floor(i / (W * D))
        pos.push(x, y, z)
        rgb(P[COLOURS[c - 1]], 1 + (hash3(x, y, z) - 0.5) * 0.1, col)
      }
      return { kind, pivot, parent, side, positions: Int16Array.from(pos), colors: Float32Array.from(col) }
    }),
  }))

  /* ---------- waterfall and spray, animated, kept out of the grid ---------- */
  const fPos: number[] = [], fCol: number[] = []
  const lip = channel(CLIFF_Z)
  for (let y = WL + 1; y <= FALL_TOP; y++) {
    const spread = y < 12 ? (12 - y) * 0.25 : 0
    for (let x = Math.floor(lip.c - lip.hw - spread); x <= Math.ceil(lip.c + lip.hw + spread); x++) {
      fPos.push(x, y, CLIFF_Z + 1)
      if (y < 16 && hash3(x, y, 1) < 0.6) fPos.push(x, y, CLIFF_Z + 2)
    }
  }
  for (let i = 0; i < 160; i++) {
    fPos.push(Math.round(lip.c + (rng() - 0.5) * 22), WL + 1 + Math.floor(rng() * 3 * rng()), CLIFF_Z + 2 + Math.floor(rng() * 6))
  }
  for (let i = 0; i < fPos.length / 3; i++) rgb(P.foam, 1, fCol)

  /* ---------- the sky waterfall: the river thrown off the front edge, top row first ---------- */
  // The river doesn't drop straight down. It leaves the lip with its speed, so it arcs out towards
  // the viewer as it falls, flares wider, and comes apart: a sheet, then a fringe of strands of
  // different lengths, then drops that take on the sunset's colours and thin away to nothing.
  const rim = (x: number) => Math.round(frontEdge(x))
  const mouth: number[] = []
  for (let x = 0; x < W; x++) if (TY[x + rim(x) * W] === T.WATER) mouth.push(x)
  const sPos: number[] = [], sCol: number[] = [], sThin: number[] = [], sLag: number[] = []
  if (mouth.length) {
    const left = mouth[0], right = mouth[mouth.length - 1]
    const mid = (left + right) / 2, half = (right - left + 1) / 2
    const blend = (a: number, b: number, t: number) => {
      const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t) << shift
      return channel(16) | channel(8) | channel(0)
    }
    // The fall is combed into strands that fan out with it. Each has a point where it starts to
    // break up and a point where it ends (as shares of the full fall), its own place in the falling
    // rhythm, and the colour its drops turn. Neighbours run alike, so the fringe hangs in locks.
    const strands = Array.from({ length: SPILL_STRANDS }, (_, s) => {
      const lock = vnoise(s * 0.27, 9.5), own = hash3(s, 5, 12), pick = hash3(s, 5, 13)
      const streamer = hash3(s, 5, 11) < 0.3 // a few hold together all the way down
      const ends = streamer ? 1 : 0.35 + 0.4 * lock + 0.15 * own
      return {
        ends,
        breaks: ends * (streamer ? 0.78 : 0.2 + 0.2 * own),
        lag: Math.floor((0.65 * vnoise(s * 0.4, 3.3) + 0.35 * hash3(s, 5, 14)) * 255),
        tint: SPILL_TINTS[pick < 0.42 ? 0 : pick < 0.62 ? 1 : pick < 0.82 ? 2 : 3],
      }
    })
    for (let drop = 0; drop < SPILL_DEPTH; drop++) {
      const y = WL - drop, fallen = drop / SPILL_DEPTH
      // Half the fall's width at this row: a trumpet flare, the same on both sides.
      const reach = half + 0.45 * drop + 0.006 * drop * drop
      // Drops start water-blue and warm to their strand's sunset tint on the way down.
      const warmth = Math.pow(fallen, 0.8)
      for (let x = Math.floor(mid - reach * SPILL_STRAY); x <= Math.ceil(mid + reach * SPILL_STRAY); x++) {
        if (x < 0 || x >= W) continue
        const u = (x - mid) / reach // -1 at the fall's left edge, 1 at its right
        const off = Math.abs(u)
        if (off > SPILL_STRAY) continue
        const strand = strands[clamp(Math.floor(((u / SPILL_STRAY + 1) / 2) * SPILL_STRANDS), 0, SPILL_STRANDS - 1)]
        // Whole near the lip, then more gap than water, then gone. The edges go first, so the
        // outline feathers; past them only stray drops fly, once the fall has opened up.
        const side = 1 - 0.45 * Math.min(1, off * off)
        const breaks = strand.breaks * side, ends = strand.ends * side
        let thin = fallen <= breaks ? 0 : Math.pow((fallen - breaks) / (ends - breaks), 1.6)
        if (off > 1) thin = drop < 5 || fallen > 0.85 ? 1 : 0.75 + 0.25 * ((off - 1) / (SPILL_STRAY - 1))
        if (thin >= 1) continue
        // Thrown outwards: a falling body's arc, further in the fast middle of the stream than at its sides.
        const thrown = SPILL_THROW * (1 - 0.3 * Math.min(1, off * off))
        const base = rim(clamp(x, left, right)) + 1
        const clear = y >= 0 ? rim(x) + 1 : 0 // stay in front of the island's own edge
        const near = Math.max(clear, base + Math.round(thrown * Math.sqrt(drop)))
        const far = Math.max(near, base + Math.round(thrown * Math.sqrt(drop + 1)) - 1)
        // Fill each step of the arc, so the water's top shows as it curves over.
        for (let z = near; z <= far; z++) {
          sPos.push(x, y, z)
          rgb(blend(SPILL_TINTS[0], strand.tint, warmth), 1, sCol)
          sThin.push(Math.round(thin * 255))
          sLag.push(strand.lag)
        }
      }
    }
  }

  /* ---------- clouds: stacked pancakes drifting between the ranges ---------- */
  const clouds: Cloud[] = []
  const cloud = (cx: number, cy: number, cz: number, rx: number, rz: number, layers: number) => {
    const pos: number[] = [], col: number[] = []
    for (let j = 0; j < layers; j++) {
      const k = Math.pow(1 - j / (layers + 0.5), 0.7)
      const ox = (rng() - 0.5) * rx * 0.3
      for (let z = -Math.ceil(rz); z <= Math.ceil(rz); z++) for (let x = -Math.ceil(rx); x <= Math.ceil(rx); x++) {
        const d = Math.hypot((x - ox) / (rx * k), z / (rz * k))
        if (d < 1 - (vnoise(x * 0.35 + cx, z * 0.5 + j * 3) - 0.5) * 0.5) {
          pos.push(x, j, z)
          rgb(j === 0 ? P.stone : P.mist, 1 + (hash3(x, j, z) - 0.5) * 0.06, col)
        }
      }
    }
    clouds.push({ x: cx, y: cy, z: cz, speed: 0.6 + rng() * 0.8, positions: Int16Array.from(pos), colors: Float32Array.from(col) })
  }
  cloud(28, 36, 14, 16, 6, 3)
  cloud(122, 36, 22, 13, 5, 3)
  cloud(70, 44, 18, 10, 4, 2)
  cloud(170, 40, 8, 12, 4, 2)
  cloud(-6, 20, 58, 16, 6, 3)
  cloud(128, 13, 52, 18, 6, 3)
  cloud(-4, 24, 46, 14, 5, 3)
  cloud(92, 22, 36, 14, 5, 3)

  return {
    terrain: { positions: Int16Array.from(tPos), colors: Float32Array.from(tCol) },
    animals,
    water: { positions: Int16Array.from(wPos), colors: Float32Array.from(wCol), sea: Uint8Array.from(wSea) },
    falls: { positions: Int16Array.from(fPos), colors: Float32Array.from(fCol) },
    spill: { positions: Int16Array.from(sPos), colors: Float32Array.from(sCol), thin: Uint8Array.from(sThin), lag: Uint8Array.from(sLag) },
    clouds,
  }
}

/** Every buffer in a scene, for handing it across a worker boundary without copying. */
export function sceneTransferables(scene: IslandScene): ArrayBuffer[] {
  const layers: VoxelLayer[] = [scene.terrain, scene.water, scene.falls, scene.spill, ...scene.clouds, ...scene.animals.flatMap((animal) => animal.parts)]
  const buffers = layers.flatMap((layer) => [layer.positions.buffer, layer.colors.buffer])
  buffers.push(scene.water.sea.buffer, scene.spill.thin.buffer, scene.spill.lag.buffer)
  return buffers
}
