// Indicator tables for the money ledger, queryable through get_layer_catalog / query_data.
//   lk-initiative-events  one row per event (money moves and initiative steps)
//   lk-initiative-funding  totals per period × grouping × public stage × currency, computed by the
//                    same moneyTotals() the dashboard uses
import { parseIndicatorTable, type IndicatorField } from '../../packages/datasets/src/table'
import { BUCKETS, BUCKET_LABEL, STAGE_LABEL, bucketOf, moneyTotals, type EventStage } from '../../packages/datasets/src/money'

type Json = Record<string, any>

const SOURCE_IDS = ['lk-initiatives-ledger']
const SECTOR_LABEL = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
const INSTRUMENT_LABEL: Record<string, string> = { loan: 'Loan', grant: 'Grant', govt_funds: 'Government money', equity: 'Equity', guarantee: 'Guarantee', in_kind: 'In kind', mixed: 'Mixed', unknown: 'Not stated' }
const ORIGIN_LABEL: Record<string, string> = { overseas: 'Overseas', domestic: 'Domestic', unknown: 'Not stated' }

/** Event ids behind a total, within the 4,000-character cell limit; `items` keeps the full count. */
function idList(ids: string[]): string {
  const out: string[] = []
  let len = 0
  for (const id of ids) {
    if (len + id.length + 1 > 3_900) return `${out.join('|')}|…+${ids.length - out.length} more`
    out.push(id); len += id.length + 1
  }
  return out.join('|')
}

function field(id: string, label: string, type: IndicatorField['type'], role: IndicatorField['role'] = 'dimension', extra: Partial<IndicatorField> = {}): IndicatorField {
  return { id, label, role, type, ...extra } as IndicatorField
}

export async function writeTables(ledger: Json): Promise<[string, string][]> {
  const lines = new Map<string, Json>(ledger.lines.map((l: Json) => [l.id, l]))
  const projects = new Map<string, Json>(ledger.projects.map((p: Json) => [p.id, p]))
  const vintage = `News read ${ledger.meta.news_read.from} to ${ledger.meta.news_read.to}; official records as published`
  const caveats = [
    'Partial coverage: English news from Aug 2026, plus official IMF, World Bank, ADB and Cabinet records. Not a national inventory.',
    'Amounts are in the currency published. Different stages and currencies are never added together.',
    'Events marked machine_read were extracted from news and have not been reviewed.',
  ]
  const common = { schema_version: 1 as const, country: 'LK', source_ids: SOURCE_IDS, vintage, caveats }

  const enriched = ledger.events.map((e: Json) => {
    const l = lines.get(e.line_id)!, p = projects.get(l.project_id)!
    return { e, l, p }
  })

  const eventRows = enriched.map(({ e, l, p }: Json) => ({
    id: e.id,
    date: e.date,
    year: Number(e.date.slice(0, 4)),
    stage: e.stage,
    stage_label: STAGE_LABEL[e.stage as EventStage] ?? e.stage,
    bucket: bucketOf(e.stage) ?? 'none',
    project_id: p.id,
    project_name: p.name,
    sector: p.sector ?? 'other',
    place: p.place ?? null,
    line_id: l.id,
    funder: l.funder,
    funder_name: l.funder_name,
    origin: l.origin,
    instrument: l.instrument,
    purpose: l.purpose,
    amount: e.amount ?? null,
    currency: e.currency ?? null,
    basis: e.basis ?? null,
    evidence: e.evidence,
    reports: (e.reports ?? []).length,
    source_url: e.sources[0]?.url ?? null,
    source_name: e.sources[0]?.outlet ?? null,
    summary: e.summary ?? null,
    event_count: 1,
  }))
  const eventFields: IndicatorField[] = [
    field('id', 'Event id', 'string'), field('date', 'Date', 'period'), field('year', 'Year', 'year'),
    field('stage', 'Stage', 'string'), field('stage_label', 'Stage (label)', 'string'),
    field('bucket', 'Money stage (announced/approved/contracted/paid, or none)', 'string'),
    field('project_id', 'Initiative id', 'string'), field('project_name', 'Initiative', 'string'),
    field('sector', 'Sector', 'string'), field('place', 'Place', 'string'),
    field('line_id', 'Funding line id', 'string'), field('funder', 'Funder id', 'string'), field('funder_name', 'Funder', 'string'),
    field('origin', 'Origin', 'string'), field('instrument', 'Instrument', 'string'), field('purpose', 'Purpose', 'string'),
    field('amount', 'Amount (original currency; never sum across rows)', 'number'), field('currency', 'Currency', 'string'),
    field('basis', 'Amount basis', 'string'), field('evidence', 'Evidence', 'string'),
    field('reports', 'News reports of this event', 'integer'), field('source_url', 'First source', 'string'),
    field('source_name', 'First source name', 'string'), field('summary', 'Summary', 'string'),
    field('event_count', 'Events', 'integer', 'measure', { aggregation: 'sum' }),
  ]
  const events = parseIndicatorTable({
    ...common, dataset_id: 'lk-initiative-events', title: 'Initiative events',
    grain: 'One real act (decision, approval, award, payment, launch …) on one date; repeated news reports are folded into it.',
    primary_key: ['id'], fields: eventFields, rows: eventRows,
    notes: ['Use lk-initiative-funding for amounts. Never sum the amount column: rows mix stages, currencies and repeated steps on the same money.', 'event_count counts events, not money.'],
  })

  // Totals: period × grouping × bucket × currency, computed by moneyTotals().
  const years = [...new Set<string>(ledger.events.map((e: Json) => e.date.slice(0, 4)))].sort()
  const periods: [string, (d: string) => boolean][] = [['all', () => true], ...years.map(y => [y, (d: string) => d.startsWith(y)] as [string, (d: string) => boolean])]
  const groupings: [string, (x: Json) => [string, string]][] = [
    ['all', () => ['all', 'Everything']],
    ['funder', ({ l }) => [l.funder, l.funder_name]],
    ['origin', ({ l }) => [l.origin, ORIGIN_LABEL[l.origin] ?? l.origin]],
    ['instrument', ({ l }) => [l.instrument, INSTRUMENT_LABEL[l.instrument] ?? l.instrument]],
    ['sector', ({ p }) => [p.sector ?? 'other', SECTOR_LABEL(p.sector ?? 'other')]],
  ]
  const totalRows: Json[] = []
  for (const [period, inPeriod] of periods) {
    const scoped = enriched.filter(({ e }: Json) => inPeriod(e.date) && bucketOf(e.stage))
    for (const [groupBy, keyOf] of groupings) {
      const groups = new Map<string, { label: string; items: Json[] }>()
      for (const x of scoped) {
        const [k, label] = keyOf(x)
        const g = groups.get(k) ?? { label, items: [] }
        g.items.push(x.e); groups.set(k, g)
      }
      for (const [group, { label, items }] of [...groups].sort()) {
        const r = moneyTotals(items)
        for (const bucket of BUCKETS) {
          for (const [currency, t] of Object.entries(r.totals[bucket]).sort()) {
            totalRows.push({
              id: `${period}:${groupBy}:${group}:${bucket}:${currency}`, period, group_by: groupBy, group, group_label: label,
              bucket, bucket_label: BUCKET_LABEL[bucket], currency, amount: Math.round(t.amount * 100) / 100,
              items: t.ids.length, not_reported: r.missing[bucket].length, event_ids: idList(t.ids),
            })
          }
        }
      }
    }
  }
  const totalFields: IndicatorField[] = [
    field('id', 'Row id', 'string'), field('period', 'Period (year or all)', 'string'),
    field('group_by', 'Grouping (all, funder, origin, instrument, sector)', 'string'), field('group', 'Group id', 'string'),
    field('group_label', 'Group', 'string'), field('bucket', 'Money stage', 'string'), field('bucket_label', 'Money stage (label)', 'string'),
    field('currency', 'Currency', 'string'), field('amount', 'Total in this currency (one stage)', 'number'),
    field('items', 'Events counted', 'integer', 'measure', { aggregation: 'none' }),
    field('not_reported', 'Events in this stage with no amount', 'integer'), field('event_ids', 'Events counted (ids)', 'string'),
  ]
  const totals = parseIndicatorTable({
    ...common, dataset_id: 'lk-initiative-funding', title: 'Initiative funding by stage',
    grain: 'One total per period, grouping, money stage and original currency.',
    primary_key: ['id'], fields: totalFields, rows: totalRows,
    notes: [
      'Pick one period, one group_by and one bucket; read each currency separately. Rows overlap across groupings and periods and must not be summed.',
      'Within a stage each funding line counts once (its latest event); paid tranches add up; cumulative positions never add to tranches.',
    ],
  })

  return [
    ['public/data/lk-initiative-events.json', JSON.stringify(events) + '\n'],
    ['public/data/lk-initiative-funding.json', JSON.stringify(totals) + '\n'],
  ]
}
