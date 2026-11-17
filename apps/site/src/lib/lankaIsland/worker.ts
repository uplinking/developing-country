import { buildLankaIsland, sceneTransferables } from './scene'

// Building the island walks ~2M voxels; doing it here keeps the landing page's main thread free.
addEventListener('message', () => {
  const scene = buildLankaIsland()
  postMessage(scene, { transfer: sceneTransferables(scene) })
})
