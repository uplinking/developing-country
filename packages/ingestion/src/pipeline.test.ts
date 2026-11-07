import { describe, expect, test } from 'bun:test'
import { ingest, plannedDates, type ApiAdapter } from './pipeline'
import { readLatest, readTable, digest, tableSchema } from './storage'
import { POWER_ID, ENERGY_ID, normalizePower, normalizeEnergy, tableFor } from './electricity'

import { MemoryStore } from './testStore'
const adapter: ApiAdapter = {
  id: 'nso-generation-api', datasetIds: [POWER_ID, ENERGY_ID], startDate: '2026-09-11', timeZone: 'Asia/Colombo',
  lookbackDays: 1, backfillDaysPerRun: 1, maxResponseBytes: 10000,
  requests: date => [{ id: 'power', url: `https://example.test/power?date=${date}` }, { id: 'energy', url: `https://example.test/energy?date=${date}` }],
  normalize: (date, responses) => [tableFor(POWER_ID, normalizePower(responses.power, date)), tableFor(ENERGY_ID, normalizeEnergy(responses.energy, date))],
}
function upstream(power = -10, badEnergy = false): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input)); const date = url.searchParams.get('date')!
    return Response.json(url.pathname === '/power' ? [{ DateTime: `${date} 00:15:00`, BESS: power }] : badEnergy ? [] : [{ stationGroupName: 'Hydro', dateTime: `${date}T23:59:59`, energyGWh: 5 }])
  }) as typeof fetch
}
const now = new Date('2026-09-12T02:00:00Z')
describe('scheduled source pipeline', () => {
  test('archives both tables atomically, is idempotent, and preserves revised versions', async () => {
    const store = new MemoryStore()
    await ingest(store, adapter, now, upstream())
    const first = (await readLatest(store, adapter.id))!
    const power = first.datasets.find(d => d.datasetId === POWER_ID)!
    expect((await readTable(store, power)).rows[0]!.bess_mw).toBe(-10)
    expect(first.datasets.length).toBe(2)
    expect((await ingest(store, adapter, now, upstream())).changed).toBe(false)
    expect((await readLatest(store, adapter.id))!.datasets[0]!.versionId).toBe(power.versionId)
    await ingest(store, adapter, now, upstream(10))
    expect((await readLatest(store, adapter.id))!.datasets[0]!.versionId).not.toBe(power.versionId)
    expect((await readTable(store, power)).rows[0]!.bess_mw).toBe(-10)
  })
  test('invalid second response cannot replace either published table', async () => {
    const store = new MemoryStore()
    await ingest(store, adapter, now, upstream())
    const first = await readLatest(store, adapter.id)
    await expect(ingest(store, adapter, now, upstream(42, true))).rejects.toThrow()
    expect(await readLatest(store, adapter.id)).toEqual(first)
    expect([...store.objects.keys()].some(k => k.includes('/raw/'))).toBe(true)
    expect([...store.objects.values()].some(v => v.body.includes('"status":"failed"'))).toBe(true)
  })
  test('a failed partition write cannot publish a partial date', async () => {
    const store = new MemoryStore(); const put = store.put.bind(store)
    store.put = async (key, body, options) => {
      if (key.includes(`/tables/${ENERGY_ID}/`)) throw new Error('storage unavailable')
      return put(key, body, options)
    }
    await expect(ingest(store, adapter, now, upstream())).rejects.toThrow()
    expect(await readLatest(store, adapter.id)).toBeNull()
  })
  test('concurrent publications conflict instead of losing history', async () => {
    const store = new MemoryStore()
    const results = await Promise.allSettled([ingest(store, adapter, now, upstream(1)), ingest(store, adapter, now, upstream(2))])
    expect(results.filter(r => r.status === 'fulfilled').length).toBe(1)
    expect((await readLatest(store, adapter.id))!.datasets.length).toBe(2)
  })
  test('checksum corruption fails closed', async () => {
    const store = new MemoryStore(); await ingest(store, adapter, now, upstream())
    const version = (await readLatest(store, adapter.id))!.datasets[0]!
    store.objects.get(version.partitions[0]!.key)!.body = '{}'
    await expect(readTable(store, version)).rejects.toThrow('checksum')
  })
  test('publishes available dates while recording a delayed report', async () => {
    const store = new MemoryStore()
    const fetcher = (async (input: string | URL | Request) => {
      if (String(input).includes('2026-09-12')) return Response.json([])
      return upstream()(input)
    }) as typeof fetch
    const run = await ingest(store, { ...adapter, lookbackDays: 2 }, new Date('2026-09-13T02:00:00Z'), fetcher)
    expect(run.status).toBe('partial')
    expect(run.accepted).toEqual(['2026-09-11'])
    expect((await readLatest(store, adapter.id))!.datasets[0]!.partitions.map(p => p.date)).toEqual(['2026-09-11'])
  })
  test('manual replay rejects invalid dates before fetching', async () => {
    const store = new MemoryStore(); let fetched = false
    const fetcher = (async () => { fetched = true; return Response.json([]) }) as typeof fetch
    await expect(ingest(store, adapter, now, fetcher, ['2026-02-31'])).rejects.toThrow('invalid_backfill_dates')
    expect(fetched).toBe(false)
  })
  test('a corrupt latest pointer cannot masquerade as an uninitialized archive', async () => {
    const store = new MemoryStore()
    await store.put('ingestion/v1/nso-generation-api/latest.json', 'null')
    await expect(readLatest(store, adapter.id)).rejects.toThrow('Invalid ingestion pointer')
  })
  test('replay and scheduling agree on yesterday in the source timezone', async () => {
    const store = new MemoryStore()
    const midnight = new Date('2026-09-14T19:00:00Z')
    const run = await ingest(store, adapter, midnight, upstream(), ['2026-09-14'])
    expect(run.accepted).toEqual(['2026-09-14'])
    await expect(ingest(store, adapter, midnight, upstream(), ['2026-09-15'])).rejects.toThrow('invalid_backfill_dates')
    const west = { ...adapter, timeZone: 'America/Los_Angeles' }
    await expect(ingest(store, west, new Date('2026-09-15T02:00:00Z'), upstream(), ['2026-09-14'])).rejects.toThrow('invalid_backfill_dates')
  })
  test('adding a dataset fills older dates already covered by its sibling', async () => {
    const store = new MemoryStore()
    const single = { ...adapter, datasetIds: [POWER_ID], normalize: (date: string, responses: Record<string, unknown>) => adapter.normalize(date, responses).slice(0, 1) }
    const clock = new Date('2026-09-15T12:00:00Z')
    await ingest(store, single, clock, upstream(), ['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14'])
    for (let run = 0; run < 3; run++) await ingest(store, adapter, clock, upstream())
    const snapshot = (await readLatest(store, adapter.id))!
    expect(snapshot.datasets.find(d => d.datasetId === ENERGY_ID)!.partitions.map(p => p.date)).toEqual(['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14'])
    expect(plannedDates(adapter, snapshot, clock)).toEqual(['2026-09-14'])
  })
  test('schema changes cannot replace the last good publication', async () => {
    const store = new MemoryStore()
    await ingest(store, adapter, now, upstream())
    const before = await readLatest(store, adapter.id)
    const changed = { ...adapter, normalize: (date: string, responses: Record<string, unknown>) => adapter.normalize(date, responses).map(table => ({ ...table, fields: table.fields.map(field => field.id === 'bess_mw' ? { ...field, unit: 'kW' } : field) })) }
    await expect(ingest(store, changed, new Date('2026-09-13T02:00:00Z'), upstream(1000), ['2026-09-12'])).rejects.toThrow()
    expect(await readLatest(store, adapter.id)).toEqual(before)
  })
  test('reader rejects incompatible legacy partitions rather than mislabelling rows', async () => {
    const store = new MemoryStore()
    await ingest(store, adapter, now, upstream())
    const version = (await readLatest(store, adapter.id))!.datasets[0]!
    const table = await readTable(store, version)
    expect(tableSchema({ ...table, fields: [...table.fields].reverse() })).toBe(tableSchema(table))
    const other = { ...table, fields: table.fields.map(field => field.id === 'bess_mw' ? { ...field, unit: 'kW' } : field), rows: table.rows.map(row => ({ ...row, report_date: '2026-09-12', timestamp: '2026-09-12 00:15:00', bess_mw: 1000 })) }
    const body = JSON.stringify(other)
    await store.put('test/revised.json', body)
    const mixed = { ...version, partitions: [...version.partitions, { key: 'test/revised.json', checksum: await digest(body), date: '2026-09-12', rowCount: 1 }] }
    await expect(readTable(store, mixed)).rejects.toThrow('Incompatible partition schemas')
    expect((await readTable(store, version)).rows[0]!.bess_mw).toBe(-10)
  })
  test('uses source timezone and excludes today', () => {
    expect(plannedDates(adapter, null, new Date('2026-09-11T20:00:00Z'))).toEqual(['2026-09-11'])
    expect(plannedDates(adapter, null, new Date('2026-09-11T00:00:00Z'))).toEqual([])
  })
})
