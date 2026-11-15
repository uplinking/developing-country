import { preloadable } from '../preloadable'

// One instance per chunk, shared by every page that renders it, so a preload
// anywhere makes the next render everywhere synchronous.
export const LiveChart = preloadable(() => import('./LiveChart'))
export const LiveMap = preloadable(() => import('./LiveMap'))
