import { ingest, type ApiAdapter } from '../../packages/ingestion/src/pipeline'
import { scheduledSources } from '../../packages/ingestion/src/registry'
import { POWER_ID, ENERGY_ID, normalizePower, normalizeEnergy, tableFor } from '../../packages/ingestion/src/electricity'

const adapters: ApiAdapter[] = [{
  ...scheduledSources[0],
  requests: date => ['load-curve', 'energy-data'].map(id => ({ id, url: `https://edlcare.edl.lk/api/gensum/${id}?date=${date}` })),
  normalize: (date, responses) => [tableFor(POWER_ID, normalizePower(responses['load-curve'], date)), tableFor(ENERGY_ID, normalizeEnergy(responses['energy-data'], date))],
}]
interface Env { DATASETS: R2Bucket; BACKFILL_SOURCE?: string; BACKFILL_FROM?: string; BACKFILL_TO?: string }
function replay(env: Env): string[] | undefined {
  if (!env.BACKFILL_SOURCE && !env.BACKFILL_FROM && !env.BACKFILL_TO) return undefined
  const start = env.BACKFILL_FROM; const end = env.BACKFILL_TO
  if (!adapters.some(a => a.id === env.BACKFILL_SOURCE) || !start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('Backfill requires a registered source and YYYY-MM-DD bounds')
  const count = (Date.parse(end) - Date.parse(start)) / 86400000 + 1
  if (!Number.isInteger(count) || count < 1 || count > 31 || new Date(start).toISOString().slice(0, 10) !== start || new Date(end).toISOString().slice(0, 10) !== end) throw new Error('Backfill must contain 1–31 dates')
  return Array.from({ length: count }, (_, day) => new Date(Date.parse(start) + day * 86400000).toISOString().slice(0, 10))
}
export default {
  async scheduled(controller: ScheduledController, env: Env) {
    const dates = replay(env)
    const sources = dates ? adapters.filter(a => a.id === env.BACKFILL_SOURCE) : adapters
    const results = await Promise.allSettled(sources.map(adapter => ingest(env.DATASETS, adapter, new Date(controller.scheduledTime), fetch, dates)))
    if (results.some(result => result.status === 'rejected' || result.value.status !== 'succeeded')) throw new Error('One or more data sources failed; inspect ingestion run logs')
  },
  fetch() { return new Response('Not found', { status: 404 }) },
}
