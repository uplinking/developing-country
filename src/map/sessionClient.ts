import { appWsUrl, withBase } from '../base'
import { playEnvelope, type StagePlayerHost } from './stagePlayer'
import type { StageEnvelope } from '../shared/stage'
import type { JsonValue } from '../shared/json'
import { isJsonObject } from '../shared/json'

type Envelope = StageEnvelope & { hull?: { type: 'Polygon'; coordinates: number[][][] } }

function isPlayable(env: Envelope): boolean {
  return (Array.isArray(env.events) && env.events.length > 0) || Boolean(env.hull) || Boolean(env.geometry)
}

export async function fetchSnapshot(): Promise<Envelope | null> {
  try {
    const res = await fetch(withBase('/api/session/snapshot'), { credentials: 'include' })
    if (!res.ok) return null
    const body: JsonValue = await res.json()
    if (!isJsonObject(body) || !Array.isArray(body.snapshots)) return null
    const first = body.snapshots
      .filter(isJsonObject)
      .find((snapshot) => Array.isArray(snapshot.events) && snapshot.events.length > 0)
    if (!first) return null
    // SAFETY: Snapshot events are persisted from MapSession's shared StageEnvelope contract.
    const events = first.events as StageEnvelope['events']
    // SAFETY: Snapshot hulls are produced only by the typed querySpatial isochrone result.
    const hull = first.hull as Envelope['hull']
    return {
      tool: String(first.tool ?? 'snapshot'),
      events,
      hull,
    }
  } catch {
    return null
  }
}

export function connectStageSocket(host: StagePlayerHost, onStatus: (live: boolean) => void): () => void {
  const url = appWsUrl('/api/session/ws')
  let ws: WebSocket | null = null
  let closed = false
  let retry: ReturnType<typeof setTimeout> | null = null
  let delay = 1000
  let failedOpens = 0

  const play = async (env: Envelope, instant?: boolean) => {
    if (!isPlayable(env)) return
    await host.map.whenReady()
    if (closed) return
    onStatus(true)
    await playEnvelope(host, env, instant ? { instant: true } : {})
  }

  const open = () => {
    if (closed) return
    let opened = false
    ws = new WebSocket(url)
    ws.onopen = () => {
      opened = true
      failedOpens = 0
      delay = 1000
    }
    ws.onmessage = (ev) => {
      try {
        const value: JsonValue = JSON.parse(String(ev.data))
        if (!isJsonObject(value)) return
        // SAFETY: This socket is owned by MapSession and emits serialized StageEnvelope values.
        const env = value as Envelope
        void play(env)
      } catch {
        /* ignore */
      }
    }
    ws.onclose = () => {
      if (closed) return
      if (!opened) {
        failedOpens++
        if (failedOpens >= 3) return
      }
      delay = Math.min(delay * 2, 30_000)
      retry = setTimeout(open, delay)
    }
    ws.onerror = () => {
      ws?.close()
    }
  }

  open()
  void fetchSnapshot().then((snap) => {
    if (snap && !closed) void play(snap, true)
  })

  return () => {
    closed = true
    if (retry) clearTimeout(retry)
    ws?.close()
  }
}
