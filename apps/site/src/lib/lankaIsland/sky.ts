import { Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3, type Camera, type Material, type WebGLRenderer } from 'three'

/**
 * The orange sunset behind the island, in screen space and in voxel-sized blocks: whitish blue at
 * the top through warm white to orange at the horizon, then the page's paper colour below the
 * island. Faint streaks drift through it and, now and then, one block glints. Distant voxels fog into the same
 * colours, so the far coast melts into the evening haze instead of into a flat colour.
 */
export interface Sky {
  mesh: Mesh
  /** Fog the material's far voxels into the sky colour behind them. */
  hazeInto: (material: Material) => void
  resize: (renderer: WebGLRenderer) => void
  /** Pin the sunset's warm band to where the island's far ridge meets the sky in this view. */
  frame: (camera: Camera) => void
  advance: (time: number) => void
  dispose: () => void
}

/** Sky colours, top to bottom, as sRGB hex. The shader mixes in sRGB, the same space fog mixes in. */
export const SKY_COLOURS = {
  // A Sri Lankan evening, kept to two ideas: whitish blue overhead, warm white, then orange at the horizon.
  top: 0xd6e4f1,
  high: 0xfdf1e4,
  mid: 0xffd09c,
  low: 0xffa85c,
  glow: 0xffe4b5,
} as const

const rgb = (hex: number) => new Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255)

// Mixed in sRGB on purpose: three mixes fog after converting to the output colour space.
const SKY_GLSL = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uBlock;
uniform float uHorizon;
uniform vec2 uResolution;
uniform vec3 uPaper;
uniform vec3 uSkyLow;
uniform vec3 uSkyMid;
uniform vec3 uSkyHigh;
uniform vec3 uSkyTop;
uniform vec3 uGlow;

float skyHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float skyNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(skyHash(i), skyHash(i + vec2(1.0, 0.0)), f.x), mix(skyHash(i + vec2(0.0, 1.0)), skyHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

vec3 skyColour(vec2 frag) {
  vec2 uv = frag / uResolution;
  float aspect = uResolution.x / uResolution.y;
  // 0 where the far ridge meets the sky, 1 at the top of the hero, negative behind and below the island.
  float t = (uv.y - uHorizon) / max(0.08, 1.0 - uHorizon);
  vec3 c = uPaper;
  c = mix(c, uSkyLow, smoothstep(-1.2, -0.1, t));
  c = mix(c, uSkyMid, smoothstep(0.0, 0.42, t));
  c = mix(c, uSkyHigh, smoothstep(0.34, 0.78, t));
  c = mix(c, uSkyTop, smoothstep(0.72, 1.15, t));
  // The sun has just gone down behind the west coast: a warm bloom low over the port.
  vec2 d = vec2((uv.x - 0.74) * aspect, (uv.y - uHorizon - 0.02) * 3.2);
  c = mix(c, uGlow, exp(-dot(d, d) * 4.0) * 0.65);
  // Thin, pale streaks of high cloud, drifting west.
  float streak = skyNoise(vec2(uv.x * aspect * 2.0 - uTime * 0.018, t * 5.0))
               * skyNoise(vec2(uv.x * aspect * 5.0 + uTime * 0.026, t * 11.0));
  float upper = smoothstep(-0.1, 0.5, t);
  c += vec3(0.035, 0.032, 0.028) * (streak - 0.22) * upper;
  // A slow warm sheen sliding across.
  c += vec3(0.01, 0.007, 0.003) * sin(uv.x * aspect * 2.6 + t * 1.2 - uTime * 0.22) * upper;
  return c;
}
`

export function createSky(paper: number, reducedMotion: boolean): Sky {
  const uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uBlock: { value: 8 },
    uHorizon: { value: 0.8 },
    uResolution: { value: new Vector2(1, 1) },
    uPaper: { value: rgb(paper) },
    uSkyLow: { value: rgb(SKY_COLOURS.low) },
    uSkyMid: { value: rgb(SKY_COLOURS.mid) },
    uSkyHigh: { value: rgb(SKY_COLOURS.high) },
    uSkyTop: { value: rgb(SKY_COLOURS.top) },
    uGlow: { value: rgb(SKY_COLOURS.glow) },
  }

  const material = new ShaderMaterial({
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      // Ordered dither, so stepped colours blend the way a limited pixel-art palette does.
      float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
      float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
      void main() {
        // Drawn in blocks about the size of one of the island's voxels.
        vec2 block = floor(gl_FragCoord.xy / uBlock);
        vec3 c = skyColour((block + 0.5) * uBlock);
        // Stepped like a small palette above the island; plain paper below it, where the river falls.
        float t = ((block.y + 0.5) * uBlock / uResolution.y - uHorizon) / max(0.08, 1.0 - uHorizon);
        c = mix(floor(c * 40.0 + bayer4(block)) / 40.0, skyColour(gl_FragCoord.xy), smoothstep(-0.7, -1.3, t));
        // Glints: now and then one block of the upper sky twinkles.
        float pick = skyHash(block + 17.0);
        if (pick < 0.003) {
          float beat = pow(max(0.0, sin(uTime * (0.8 + pick * 300.0) + pick * 9000.0)), 10.0);
          float upper = smoothstep(0.25, 0.75, ((block.y + 0.5) * uBlock / uResolution.y - uHorizon) / max(0.08, 1.0 - uHorizon));
          c = mix(c, vec3(1.0, 0.99, 0.97), beat * upper * 0.35);
        }
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  })
  const geometry = new PlaneGeometry(2, 2)
  const ridge = new Vector3()
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = -1

  return {
    mesh,
    hazeInto(target) {
      target.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms)
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${SKY_GLSL}`)
          .replace(
            '#include <fog_fragment>',
            `#ifdef USE_FOG
              gl_FragColor.rgb = mix(gl_FragColor.rgb, skyColour(gl_FragCoord.xy), smoothstep(fogNear, fogFar, vFogDepth));
            #endif`,
          )
      }
      target.needsUpdate = true
    },
    resize(renderer) {
      renderer.getDrawingBufferSize(uniforms.uResolution.value)
      uniforms.uPixelRatio.value = renderer.getPixelRatio()
      // About one island voxel across: the island spans ~184 voxels on a wide screen.
      const cssWidth = uniforms.uResolution.value.x / uniforms.uPixelRatio.value
      uniforms.uBlock.value = Math.max(5, Math.round(cssWidth / 184)) * uniforms.uPixelRatio.value
    },
    frame(camera) {
      // The top of the ridge behind the reservoir, at the island's back edge.
      ridge.set(100, 24, 0).project(camera)
      uniforms.uHorizon.value = (ridge.y + 1) / 2
    },
    advance(time) {
      if (!reducedMotion) uniforms.uTime.value = time
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
