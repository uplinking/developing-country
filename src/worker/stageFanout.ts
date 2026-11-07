import type { Env } from './types'
import type { JsonFc, StageEvent } from '../shared/stage'
import type { JsonObject } from '../shared/json'
import { normalizeEmail } from './identity'

export async function persistAndFanout(
  env: Env,
  input: {
    email: string
    tool: string
    events: StageEvent[]
    geometry?: JsonFc
    hull?: { type: 'Polygon'; coordinates: number[][][] }
  },
): Promise<void> {
  if (input.events.length === 0 && !input.hull && !input.geometry) return
  const email = normalizeEmail(input.email)
  const d1p = env.DB.prepare(
    `INSERT INTO stage_snapshots (id, user_email, tool, events_json, hull_json)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(
      crypto.randomUUID(),
      email,
      input.tool,
      JSON.stringify(input.events),
      input.hull ? JSON.stringify(input.hull) : null,
    )
    .run()
    .then(() =>
      env.DB.prepare(
        `DELETE FROM stage_snapshots
         WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')`,
      )
        .run(),
    )

  const dop = env.SESSIONS
    ? env.SESSIONS.getByName('email:' + email).appendStage({
        email: input.email,
        tool: input.tool,
        events: input.events,
        geometry: input.geometry,
      })
    : Promise.resolve({ ok: false, tab_count: 0, err: 'unbound' } as const)

  const [d1, d] = await Promise.allSettled([d1p, dop])
  console.log(
    JSON.stringify({
      op: 'persistAndFanout',
      d1_ok: d1.status === 'fulfilled',
      appendStage: d.status === 'fulfilled' ? d.value : { ok: false, err: String(d.reason) },
      event_count: input.events.length,
      has_geometry: Boolean(input.geometry),
    }),
  )
}

export function extractStage(result: JsonObject): StageEvent[] {
  if (!Array.isArray(result.stage)) return []
  // SAFETY: Only the platform's query/analyze services write the closed StageEvent union to this field.
  return result.stage as StageEvent[]
}
