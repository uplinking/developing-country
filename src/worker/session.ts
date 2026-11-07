import { DurableObject } from 'cloudflare:workers'
import type { Env } from './types'
import type { JsonFc, StageEnvelope, StageEvent } from '../shared/stage'

export { normalizeEmail } from './identity'

type TabAttach = { email: string; tabId: string; role: 'tab' | 'room' }

export class MapSession extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS events (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT NOT NULL,
          tool TEXT,
          payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      `)
    })
  }

  async appendStage(input: {
    email: string
    tool: string
    events: StageEvent[]
    geometry?: JsonFc
  }): Promise<{ seq: number; ok: boolean; tab_count: number; err?: string }> {
    try {
      const envelope: StageEnvelope = { tool: input.tool, events: input.events, geometry: input.geometry }
      const payload = JSON.stringify(envelope)
      const persist = payload.length > 64 * 1024
        ? JSON.stringify({ tool: input.tool, events: input.events })
        : payload
      this.ctx.storage.sql.exec(
        `INSERT INTO events (ts, tool, payload) VALUES (?, ?, ?)`,
        new Date().toISOString(),
        input.tool,
        persist,
      )
      this.ctx.storage.sql.exec(
        `DELETE FROM events WHERE seq NOT IN (SELECT seq FROM events ORDER BY seq DESC LIMIT 100)`,
      )
      const row = this.ctx.storage.sql
        .exec<{ seq: number }>(`SELECT MAX(seq) AS seq FROM events`)
        .one()
      const tabs = this.ctx.getWebSockets()
      const frame = JSON.stringify(envelope)
      let tabCount = 0
      for (const ws of tabs) {
        const attach: TabAttach | null = ws.deserializeAttachment()
        if (attach?.role !== 'tab' && attach?.role !== 'room') continue
        try {
          ws.send(frame)
          tabCount++
        } catch {
          /* drop */
        }
      }
      const out = { seq: Number(row?.seq ?? 0), ok: true, tab_count: tabCount }
      console.log(JSON.stringify({ op: 'appendStage', ok: true, event_count: input.events.length, tab_count: tabCount }))
      return out
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e) || 'appendStage failed'
      console.log(JSON.stringify({ op: 'appendStage', ok: false, err, event_count: input.events.length }))
      return { seq: 0, ok: false, tab_count: 0, err }
    }
  }

  async tabCount(): Promise<number> {
    let n = 0
    for (const ws of this.ctx.getWebSockets()) {
      const attach: TabAttach | null = ws.deserializeAttachment()
      if (attach?.role === 'tab' || attach?.role === 'room') n++
    }
    return n
  }

  async snapshot(): Promise<string> {
    const rows = this.ctx.storage.sql
      .exec<{ tool: string; payload: string }>(
        `SELECT tool, payload FROM events ORDER BY seq DESC LIMIT 50`,
      )
      .toArray()
    const events: StageEvent[] = []
    let tool: string | undefined
    for (const r of rows.reverse()) {
      tool = r.tool
      try {
        const parsed: StageEnvelope = JSON.parse(r.payload)
        if (Array.isArray(parsed.events)) events.push(...parsed.events)
      } catch {
        /* skip */
      }
    }
    return JSON.stringify({ events, tool })
  }

  async fetch(request: Request): Promise<Response> {
    const attach: TabAttach | null = JSON.parse(
      request.headers.get('X-Session-Attach') ?? 'null',
    )
    if (!attach?.email) return new Response('unauthorized', { status: 401 })
    if (attach.role !== 'tab') return new Response('forbidden', { status: 403 })
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    pair[1].serializeAttachment(attach)
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async webSocketMessage(ws: WebSocket, _message: string | ArrayBuffer) {
    const attach: TabAttach | null = ws.deserializeAttachment()
    if (!attach) return
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason)
  }
}
