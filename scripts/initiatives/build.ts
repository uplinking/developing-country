// Build the money & projects ledger from news batches, reviewed official records and the
// World Bank snapshot. Deterministic and idempotent; validates before writing.
//   bun scripts/initiatives/build.ts            write outputs
//   bun scripts/initiatives/build.ts --check    fail if outputs are stale
//
// Inputs (scripts/initiatives/):
//   news/*.json       machine-read batches (EXTRACTION_SPEC): projects, lines, events, articles
//   reviewed.json     reviewed official records (Cabinet, ADB, IMF, Pandemic Fund …)
//   world-bank.json   World Bank Projects API snapshot (fetch-world-bank.ts)
//   coverage.json     lk_news articles per week per outlet|lang, and which weeks we have read
//   overrides.json    human review decisions (aliases, merges, retractions, field fixes)
// Outputs:
//   public/data/money.json    the dashboard ledger (projects, lines, events, coverage)
//   + indicator tables via ./tables.ts
import { readFile, readdir, writeFile, rename } from 'node:fs/promises'
import { DELIVERY_STAGES, MONEY_STAGES, INSTRUMENTS, ORIGINS, PURPOSES, BASES } from '../../packages/datasets/src/money'
import { writeTables } from './tables'

type Json = Record<string, any>
const ROOT = 'scripts/initiatives'
const read = async (p: string) => JSON.parse(await readFile(p, 'utf8'))
const check = process.argv.includes('--check')

const REVIEWED_STAGE: Record<string, string> = {
  contract_award: 'contract_awarded', cost_estimate: 'cost_estimate', borrower_authorization: 'govt_authorised',
  lender_approval: 'funder_approved', provision: 'allocated', disbursement: 'disbursed',
}
const FUNDER: Record<string, [string, string, string, string]> = {
  'pandemic-fund': ['other:pandemic_fund', 'Pandemic Fund', 'multilateral', 'overseas'],
  'government-sl': ['gosl', 'Government of Sri Lanka', 'government', 'domestic'],
  'opec-fund': ['opec_fund', 'OPEC Fund', 'multilateral', 'overseas'],
  adb: ['adb', 'Asian Development Bank', 'multilateral', 'overseas'],
  imf: ['imf', 'International Monetary Fund', 'multilateral', 'overseas'],
  japan: ['japan', 'Government of Japan', 'bilateral', 'overseas'],
  unknown: ['unknown', 'Funder not stated', 'unknown', 'unknown'],
}
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5
const near = (a: number, b: number) => Math.abs(a - b) <= 0.01 * Math.max(a, b)
// Readers sometimes name a known funder as free text ("other:jica"); fold those into the ids
// the page filters on. The funder_name keeps the reader's wording (e.g. "JICA").
const FUNDER_ALIAS: [RegExp, string][] = [
  [/^other:(jica|japan.*|government_of_japan)$/, 'japan'], [/^other:(imf.*|international_monetary_fund)$/, 'imf'],
  [/^other:(world_bank.*|ida|ibrd|wb)$/, 'world_bank'], [/^other:(asian_development_bank|adb.*)$/, 'adb'],
  [/^other:(usaid|united_states.*|us_government|usa?)$/, 'usa'], [/^other:(koica|korea.*|kexim.*)$/, 'korea'],
  [/^other:(exim_bank_of_china|china.*|cdb)$/, 'china'], [/^other:(exim_bank_of_india|india.*|government_of_india)$/, 'india'],
  [/^other:(european_union|eu.*)$/, 'eu'], [/^other:(undp|unicef|wfp|fao|unhcr|iom|unops|who|un_.*|united_nations.*)$/, 'un'],
  [/^other:(government_of_sri_lanka|gosl|treasury|sri_lanka.*)$/, 'gosl'], [/^other:(opec.*)$/, 'opec_fund'], [/^other:(aiib)$/, 'aiib'],
]
const normFunder = (f: string) => {
  const id = String(f).replace(/-/g, '_').toLowerCase()
  return FUNDER_ALIAS.find(([re]) => re.test(id))?.[1] ?? id
}
const ORIGIN_FIX: Record<string, string> = { external: 'overseas' }
const PURPOSE_FIX: Record<string, string> = { macroeconomic: 'balance_of_payments', sector_programme: 'programme', general_budget_support: 'budget_support' }
const INSTRUMENT_FIX: Record<string, string> = { government_contribution: 'govt_funds' }

// Readers sometimes record a per-unit figure (Rs 110 per meal, Rs 6,000 a month) as a total.
// Those become basis "rate", which the counting contract lists but never adds.
const RATE = /\b(per|each|monthly|a month|per month|every month|daily|a day|per day)\b(?! cent)/i
const RATE_SMALL = /\b(allowance|stipend|pension|salary|wage|subsidy|grant of)\b/i
// Programme totals often mention a per-unit figure too ("Rs 1.5bn, Rs 60m per district"), so the
// per-unit test only applies below programme scale.
const RATE_CEILING = (c: string) => c === 'LKR' ? 100_000_000 : 1_000_000
const isRate = (e: Json) => e.amount != null && e.basis !== 'rate' && e.amount < RATE_CEILING(e.currency)
  && (RATE.test(e.summary ?? '') || (e.amount < 1_000_000 && RATE_SMALL.test(e.summary ?? '')))

const overrides: Json = await read(`${ROOT}/overrides.json`)
const projects = new Map<string, Json>()
const lines = new Map<string, Json>()
const events: Json[] = []
const articles = new Map<string, Json>()
let articlesRead = 0, rejected = 0
const batches: Json[] = []

// 1. News batches, oldest first. A later batch may only add; it never rewrites earlier ids.
for (const file of (await readdir(`${ROOT}/news`)).filter(f => f.endsWith('.json')).sort()) {
  const b = await read(`${ROOT}/news/${file}`)
  if (b.schema_version !== 1) throw new Error(`${file}: unsupported schema`)
  batches.push({ file, kind: b.kind, window: b.window, language: b.language ?? 'en', upstream: b.upstream, extracted_by: b.extracted_by, events: b.events.length })
  articlesRead += b.articles_read ?? 0; rejected += b.rejected ?? 0
  for (const [id, a] of Object.entries<Json>(b.articles)) articles.set(id, a)
  for (const p of b.projects) if (!projects.has(p.id)) projects.set(p.id, { ...p })
  // A named company ("other:prime_land") is still a private funder: one id keeps totals and dedup honest.
  for (const l of b.lines) if (!lines.has(l.id)) lines.set(l.id, { ...l, funder: l.funder_type === 'private' && String(l.funder).startsWith('other:') ? 'private' : normFunder(l.funder), origin: ORIGIN_FIX[l.origin] ?? l.origin })
  for (const e of b.events) {
    // Overlapping weekly windows can propose the same act again: fold its reports in.
    const prior = events.find(x => x.id === e.id)
    if (prior) { prior.reports = [...new Set([...(prior.reports ?? []), ...(e.reports ?? [])])].sort(); continue }
    // Older batches may still carry the newspaper's quote; it is never published.
    const { evidence_quote: _quote, ...act } = e
    events.push({ ...act, evidence: 'machine_read', batch: file, ...(isRate(e) ? { basis: 'rate' } : {}) })
  }
}
const sourcesFor = (ids: string[]) => ids.filter(id => articles.has(id)).map(id => {
  const a = articles.get(id)!
  return { url: a.url, outlet: a.outlet, date: a.date, title: a.title, kind: 'news', doc_id: id }
})

// 2. Line aliases from review come first, so matching sees the corrected graph.
for (const [from, to] of Object.entries<string>(overrides.line_alias ?? {})) {
  for (const e of events) if (e.line_id === from) e.line_id = to
  lines.delete(from)
}

// 3. Reviewed official records. They confirm a news event (same act) or become their own event.
const reviewed = await read(`${ROOT}/reviewed.json`)
const cumulative = new Map<string, number>()
let confirmed = 0
const splits: Json[] = []
for (const r of reviewed.records) {
  if (r.measure === 'cumulative_disbursement') { cumulative.set(`${r.component_id}|${r.date}`, r.amount); continue }
  const stage = REVIEWED_STAGE[r.measure]
  if (!stage) throw new Error(`reviewed ${r.id}: unknown measure ${r.measure}`)
  const f = FUNDER[r.provider_id] ?? [r.provider_id, r.provider_name, 'unknown', r.origin]
  const sameFunder = (l?: Json) => !!l && (l.funder === f[0] || r.provider_id === 'unknown')
  const src = { url: r.source_url, outlet: r.source_name, date: r.verified_at, title: `${r.project_name} (official record)`, kind: 'official' }
  const compatible = (s: string) => s === stage || (new Set([s, stage]).size === 2 && ['allocated', 'govt_authorised', 'cost_estimate'].includes(s) && ['allocated', 'govt_authorised', 'cost_estimate'].includes(stage))
  const hit = events.find(e => e.evidence === 'machine_read' && e.currency === r.currency && e.amount && near(e.amount, r.amount)
    && days(e.date, r.date) <= 10 && sameFunder(lines.get(e.line_id)) && compatible(e.stage))
  if (hit) {
    if (hit.stage !== stage) hit.notes = `${hit.notes ? hit.notes + ' ' : ''}News read this as ${hit.stage}; the official record says ${stage}.`
    Object.assign(hit, { stage, amount: r.amount, evidence: 'reviewed', notes: r.basis })
    hit.sources = [...(hit.sources ?? []), src]
    confirmed++
    continue
  }
  // News that reported two reviewed parts as one total (ADB 50m + 50m reported as "100m").
  const siblings = reviewed.records.filter((x: Json) => x.provider_id === r.provider_id && x.measure === r.measure && x.currency === r.currency && x.date === r.date)
  if (siblings.length > 1) {
    const total = siblings.reduce((s: number, x: Json) => s + x.amount, 0)
    const agg = events.find(e => e.evidence === 'machine_read' && e.currency === r.currency && e.amount && near(e.amount, total)
      && e.stage === stage && days(e.date, r.date) <= 10 && sameFunder(lines.get(e.line_id)))
    if (agg && !splits.some(s => s.event === agg)) splits.push({ event: agg, components: siblings.map((x: Json) => x.component_id), date: r.date, stage })
  }
  let pid = r.project_id, lid = r.component_id
  const sameMoney = events.find(e => e.evidence === 'machine_read' && f[0] !== 'unknown' && lines.get(e.line_id)?.funder === f[0]
    && e.currency === r.currency && e.amount && near(e.amount, r.amount) && days(e.date, r.date) <= 60)
  if (sameMoney) { lid = sameMoney.line_id; pid = lines.get(lid)!.project_id }
  if (!projects.has(pid)) projects.set(pid, {
    id: pid, name: r.project_name, sector: (PURPOSE_FIX[r.purpose] ?? r.purpose) === 'balance_of_payments' ? 'governance' : 'other', status: 'unknown',
    place: r.latitude == null ? 'national' : r.location_note ?? '', lat: r.latitude, lon: r.longitude, parent_id: null,
  })
  if (!lines.has(lid)) lines.set(lid, {
    id: lid, project_id: pid, funder: f[0], funder_name: f[1], funder_type: f[2],
    origin: ORIGIN_FIX[r.origin] ?? (r.origin === 'unknown' ? f[3] : r.origin), instrument: INSTRUMENT_FIX[r.instrument] ?? r.instrument, purpose: PURPOSE_FIX[r.purpose] ?? r.purpose,
  })
  events.push({
    id: r.id, line_id: lid, date: r.date, date_basis: 'decision', stage, amount: r.amount, currency: r.currency, raw: null,
    basis: stage === 'disbursed' ? 'tranche' : 'total', equivalents: [], components: [], summary: null, confidence: 'high',
    evidence: 'reviewed', reports: [], sources: [src], first_reported: r.date, relation: 'new', notes: r.basis,
  })
}

// 4. World Bank board approvals since 2023 (official). Pipeline projects are proposals.
const wb = await read(`${ROOT}/world-bank.json`)
for (const p of wb.projects) {
  let d = String(p.boardapprovaldate ?? '').slice(0, 10)
  if (d < '2023-01-01' || p.status === 'Dropped' || !p.curr_total_commitment) continue
  const amount = Number(p.curr_total_commitment), grant = Number(p.grantamt ?? 0)
  const stage = p.status === 'Pipeline' ? 'proposed' : 'funder_approved'
  const planned = stage === 'proposed' ? d : null
  if (planned) d = wb.retrieved // seen in the pipeline on retrieval; the board date has not happened
  const src = { url: `https://projects.worldbank.org/en/projects-operations/project-detail/${p.id}`, outlet: 'World Bank', date: wb.retrieved, title: p.project_name, kind: 'official' }
  const hit = events.find(e => e.evidence === 'machine_read' && e.currency === 'USD' && e.amount && near(e.amount, amount)
    && lines.get(e.line_id)?.funder === 'world_bank' && days(e.date, d) <= 10)
  if (hit) { hit.evidence = 'reviewed'; hit.sources = [...(hit.sources ?? []), src]; confirmed++; continue }
  const pid = `wb-${p.id.toLowerCase()}`
  const name = String(p.project_name).replace(/^Sri Lanka[:’'s]*\s+/i, '').trim()
  if (!projects.has(pid)) projects.set(pid, { id: pid, name, sector: 'other', status: p.status === 'Active' ? 'underway' : p.status === 'Closed' ? 'completed' : 'planning', place: 'national', lat: null, lon: null, parent_id: null })
  const lid = `${pid}-wb`
  if (!lines.has(lid)) lines.set(lid, {
    id: lid, project_id: pid, funder: 'world_bank', funder_name: 'World Bank', funder_type: 'multilateral', origin: 'overseas',
    instrument: grant >= amount ? 'grant' : grant === 0 ? 'loan' : 'mixed',
    purpose: /Development Policy|Reforms for Growth|Turnaround/.test(p.project_name) ? 'budget_support' : 'project', lender_project_id: p.id,
  })
  events.push({
    id: `${pid}-${stage}`, line_id: lid, date: d, date_basis: 'decision', stage, amount, currency: 'USD', raw: null, basis: 'total',
    equivalents: [], components: [], summary: null, confidence: 'high', evidence: 'reviewed', reports: [], sources: [src],
    first_reported: d, relation: 'new', notes: `${planned ? `Board approval planned for ${planned}. ` : ''}Current commitment per the World Bank; may include later revisions.`,
  })
}

// 4b. Funders with an official transaction ledger (IMF, in SDR). News reports their approvals and
//     payments in USD equivalents, which would double count the official SDR amounts. Such news
//     events attach as reports to the nearest official event on the same line; otherwise they keep
//     no countable amount.
const OFFICIAL_LEDGER = new Set(['imf'])
const LEDGER_STAGES = new Set(['funder_approved', 'disbursed', 'released'])
for (const e of [...events]) {
  const l = lines.get(e.line_id)
  if (e.evidence !== 'machine_read' || !l || !OFFICIAL_LEDGER.has(l.funder) || !LEDGER_STAGES.has(e.stage)) continue
  const official = events.filter(x => x.evidence === 'reviewed' && lines.get(x.line_id)?.funder === l.funder && LEDGER_STAGES.has(x.stage) && days(x.date, e.date) <= 45)
    .sort((x, y) => days(x.date, e.date) - days(y.date, e.date))[0]
  if (official) {
    official.reports = [...new Set([...(official.reports ?? []), ...(e.reports ?? [])])].sort()
    events.splice(events.indexOf(e), 1)
  } else if (e.amount != null) {
    e.notes = `${e.notes ? e.notes + ' ' : ''}Reported as ${e.currency} ${e.amount}; not counted because the official IMF record (in SDR) is not matched yet.`
    e.amount = null; e.currency = null
  }
}

// 5. Resolve news totals that were really two reviewed parts.
for (const s of splits) {
  const targets = events.filter(e => s.components.includes(e.line_id) && e.evidence === 'reviewed' && e.date === s.date && e.stage === s.stage)
  if (targets.length !== s.components.length) continue
  for (const t of targets) {
    t.reports = [...new Set([...(t.reports ?? []), ...s.event.reports])].sort()
    t.notes = `${t.notes ? t.notes + ' ' : ''}News reported both parts together as one total.`
  }
  events.splice(events.indexOf(s.event), 1)
}

// 6. Deterministic duplicate collapse across batches: same line, stage, currency and amount
//    within 10 days is the same act. The earliest event keeps its id; reports merge.
events.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
for (let i = 0; i < events.length; i++) {
  const a = events[i]
  for (let j = i + 1; j < events.length; j++) {
    const b = events[j]
    if (days(a.date, b.date) > 10) break
    if (b.line_id === a.line_id && b.stage === a.stage && b.currency === a.currency && a.amount != null && b.amount != null && near(a.amount, b.amount) && a.batch !== b.batch) {
      a.reports = [...new Set([...(a.reports ?? []), ...(b.reports ?? [])])].sort()
      if (b.evidence === 'reviewed') a.evidence = 'reviewed'
      a.sources = [...(a.sources ?? []), ...(b.sources ?? [])]
      events.splice(j--, 1)
    }
  }
}

const STOP = new Set(['the', 'and', 'for', 'of', 'to', 'in', 'sri', 'lanka', 'project', 'programme', 'program', 'loan', 'grant', 'phase', 'development', 'cabinet', 'approves', 'approved', 'rs', 'usd', 'with', 'from', 'new', 'national'])
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w)).map(w => w.replace(/s$/, '')))
const projectName = (e: Json) => `${projects.get(lines.get(e.line_id)?.project_id)?.name ?? ''} ${e.summary ?? ''}`
// A shared word only links two reports when it is rare in the ledger: "rebuilding" is in every
// cyclone-fund donation, "naturub" or "ceylon" names one donor.
const df = new Map<string, number>()
for (const e of events) for (const w of words(projectName(e))) df.set(w, (df.get(w) ?? 0) + 1)
const DISTINCTIVE = 8 // documents a word may appear in and still count as name-like
const sharesWord = (x: string, y: string) => { const a = words(x); return [...words(y)].some(w => a.has(w) && (df.get(w) ?? 0) <= DISTINCTIVE) }
// Donor names are compared within line ids, where "commercial" or "cargills" is rare even if common in prose.
const lineDf = new Map<string, number>()
for (const id of lines.keys()) for (const w of words(id)) lineDf.set(w, (lineDf.get(w) ?? 0) + 1)
const sameDonor = (x: string, y: string) => { const a = words(x); return [...words(y)].some(w => a.has(w) && (lineDf.get(w) ?? 0) <= DISTINCTIVE) }

// 6a. Same act under different ids: independent batches (months, readers) can name one initiative
//     differently. Same named funder, stage and currency, amount within 1% and dates within 10 days
//     is the same act; the later event's reports fold into the earlier one.
events.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
for (let i = 0; i < events.length; i++) {
  const a = events[i], fa = lines.get(a.line_id)?.funder
  // Equal per-unit rates (Rs 4,000 a bag) say nothing about being the same act.
  if (a.amount == null || !fa || fa === 'unknown' || a.basis === 'rate') continue
  for (let j = i + 1; j < events.length; j++) {
    const b = events[j]
    if (days(a.date, b.date) > 10) break
    if (b.basis === 'rate') continue
    // Only machine-read events from different batches: official records with equal amounts on the
    // same day (e.g. ADB's two USD 50m loans) are distinct components, never merged by guesswork.
    const crossBatch = a.evidence === 'machine_read' && b.evidence === 'machine_read' && a.batch && b.batch && a.batch !== b.batch
    // Equal round amounts are common (two ADB USD 200m loans in one week), so the initiatives
    // must also share a meaningful word.
    // Private donations share a fund and round amounts (Rs 10m to Rebuilding Sri Lanka), so the
    // donor named in the line must match, not just the fund.
    const named = fa === 'private' ? sameDonor(b.line_id, a.line_id) : sharesWord(projectName(a), projectName(b))
    if (crossBatch && b.line_id !== a.line_id && named && b.amount != null && b.stage === a.stage && b.currency === a.currency && near(a.amount, b.amount) && lines.get(b.line_id)?.funder === fa) {
      a.reports = [...new Set([...(a.reports ?? []), ...(b.reports ?? [])])].sort()
      a.sources = [...(a.sources ?? []), ...(b.sources ?? [])]
      if (b.evidence === 'reviewed') a.evidence = 'reviewed'
      if (process.env.DEDUP_LOG) console.error(`6a merge ${a.id} <- ${b.id}`)
      events.splice(j--, 1)
    }
  }
}

// 6b. Repeats the extractor linked to an earlier event ("repeat_of:<id>") fold into it.
for (const e of [...events]) {
  const target = typeof e.relation === 'string' && e.relation.startsWith('repeat_of:') ? events.find(x => x.id === e.relation.slice(10)) : null
  if (!target || target === e) continue
  target.reports = [...new Set([...(target.reports ?? []), ...(e.reports ?? [])])].sort()
  events.splice(events.indexOf(e), 1)
}

// 7. Explicit review decisions. Project aliases join the same initiative named differently
//    by different sources (e.g. ADB's and Cabinet's names for one programme).
for (const [from, to] of Object.entries<string>(overrides.project_alias ?? {})) {
  if (!projects.has(to) || !projects.has(from)) throw new Error(`overrides.project_alias: unknown ${projects.has(to) ? from : to}`)
  for (const l of lines.values()) if (l.project_id === from) l.project_id = to
  projects.delete(from)
}
for (const [keep, drop] of overrides.merge_events ?? []) {
  const k = events.find(e => e.id === keep), d = events.find(e => e.id === drop)
  if (!k || !d) throw new Error(`overrides.merge_events: unknown ${k ? drop : keep}`)
  k.reports = [...new Set([...(k.reports ?? []), ...(d.reports ?? [])])].sort()
  k.sources = [...(k.sources ?? []), ...(d.sources ?? [])]
  events.splice(events.indexOf(d), 1)
}
for (const id of overrides.retract ?? []) {
  const e = events.find(x => x.id === id)
  if (!e) throw new Error(`overrides.retract: unknown ${id}`)
  e.evidence = 'retracted'
}
for (const [id, patch] of Object.entries<Json>(overrides.set_event ?? {})) {
  const e = events.find(x => x.id === id)
  if (!e) throw new Error(`overrides.set_event: unknown ${id}`)
  Object.assign(e, patch)
}
for (const [id, patch] of Object.entries<Json>(overrides.set_project ?? {})) {
  const p = projects.get(id)
  if (!p) throw new Error(`overrides.set_project: unknown ${id}`)
  Object.assign(p, patch)
}

// 8. Finish: news sources, cumulative positions, summaries; drop unused lines/projects.
for (const e of events) {
  const news = sourcesFor(e.reports ?? [])
  const official = (e.sources ?? []).filter((s: Json) => s.kind === 'official')
  e.sources = [...official, ...news].filter((s, i, all) => all.findIndex(x => x.url === s.url) === i)
  if (e.stage === 'disbursed' && cumulative.has(`${e.line_id}|${e.date}`)) e.cumulative_after = { amount: cumulative.get(`${e.line_id}|${e.date}`), currency: e.currency }
  e.summary ??= projects.get(lines.get(e.line_id)?.project_id)?.name ?? null
  delete e.batch
}
const usedLines = new Set(events.map(e => e.line_id))
const usedProjects = new Set([...usedLines].map(l => lines.get(l)?.project_id))

// 9. Validate everything we publish.
const errors: string[] = []
const stages = new Set<string>([...MONEY_STAGES, ...DELIVERY_STAGES])
for (const e of events) {
  const l = lines.get(e.line_id)
  if (!l) errors.push(`${e.id}: unknown line ${e.line_id}`)
  else if (!projects.has(l.project_id)) errors.push(`${l.id}: unknown project ${l.project_id}`)
  if (!stages.has(e.stage)) errors.push(`${e.id}: stage ${e.stage}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) errors.push(`${e.id}: date ${e.date}`)
  if (e.amount != null && (typeof e.amount !== 'number' || !Number.isFinite(e.amount) || e.amount < 0)) errors.push(`${e.id}: amount`)
  if ((e.amount == null) !== (e.currency == null) && !(e.amount == null && e.currency)) errors.push(`${e.id}: amount without currency`)
  if (e.basis && !(BASES as readonly string[]).includes(e.basis)) errors.push(`${e.id}: basis ${e.basis}`)
  if (!e.sources.length) errors.push(`${e.id}: no source`)
  for (const s of e.sources) if (!/^https?:\/\//.test(s.url)) errors.push(`${e.id}: source url ${s.url}`)
}
for (const id of usedLines) {
  const l = lines.get(id)!
  if (!(INSTRUMENTS as readonly string[]).includes(l.instrument)) errors.push(`${id}: instrument ${l.instrument}`)
  if (!(ORIGINS as readonly string[]).includes(l.origin)) errors.push(`${id}: origin ${l.origin}`)
  if (!(PURPOSES as readonly string[]).includes(l.purpose)) errors.push(`${id}: purpose ${l.purpose}`)
}
if (errors.length) throw new Error(`Money ledger invalid:\n${errors.slice(0, 40).join('\n')}`)

// 10. Coverage: a week counts as read for a language only if a batch for that language covers it.
const cov = await read(`${ROOT}/coverage.json`)
const readMonths: Record<string, Set<string>> = {}
for (const bt of batches) {
  if (!Array.isArray(bt.window)) continue
  for (let d = new Date(`${String(bt.window[0]).slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= String(bt.window[1]).slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) {
    (readMonths[bt.language] ??= new Set()).add(d.toISOString().slice(0, 7))
  }
}
const weeks: Json = {}
for (const [wk, counts] of Object.entries<Record<string, number>>(cov.weeks)) {
  const month = wk.slice(0, 7)
  const langs: Record<string, number> = { en: 0, si: 0, ta: 0 }
  let total = 0, read = 0, outlets = 0
  for (const [k, v] of Object.entries(counts)) {
    const lang = k.split('|')[1]!
    langs[lang] = (langs[lang] ?? 0) + v; total += v
    if (readMonths[lang]?.has(month)) { read += v; outlets++ }
  }
  weeks[wk] = { articles: read, collected: total, outlets, en: langs.en, si: langs.si, ta: langs.ta,
    news_read: Object.keys(readMonths).filter(l => readMonths[l]!.has(month)) }
}
const readLanguages = Object.keys(readMonths).sort()
const firstRead = Object.values(readMonths).flatMap(s => [...s]).sort()[0] ?? '2026-08'

const ledger = {
  schema_version: 1,
  meta: {
    title: 'Sri Lanka public money and projects',
    publisher: 'developing-country.org',
    licence: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', covers: 'The compilation: ids, stages, grouping, funder and sector tags, and our summaries and notes. Linked articles and official documents keep their publishers\u2019 rights.' },
    upstream: [...new Set(batches.map(b => b.upstream))],
    batches,
    counts: { articles_read: articlesRead, rejected, events: events.length, reports: events.reduce((s, e) => s + (e.reports?.length ?? 0), 0), confirmed_by_official_record: confirmed },
    news_read: { from: `${firstRead}-01`, to: cov.read_to, languages: readLanguages },
    note: 'News events are machine-read and not yet reviewed unless marked reviewed. Official records are checked against their publisher.',
  },
  projects: [...usedProjects].sort().map(id => projects.get(id!)),
  lines: [...usedLines].sort().map(id => lines.get(id)),
  events: events.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
  coverage: {
    weeks,
    gaps: [
      { from: '2023-01-01', to: `${firstRead}-01`, what: 'News not read for this period; official records only.' },
      { from: '2025-02-01', to: '2025-06-30', what: 'lk_news collected almost nothing in these months.' },
      ...(['si', 'ta'] as const).filter(l => !readMonths[l]?.size).map(l => ({ from: `${firstRead}-01`, to: cov.read_to, what: `${l === 'si' ? 'Sinhala' : 'Tamil'} news is not read yet.` })),
    ],
  },
}

const outputs = new Map<string, string>([['public/data/lk-initiatives.json', JSON.stringify(ledger) + '\n'], ...await writeTables(ledger)])
let stale = 0
for (const [path, text] of outputs) {
  let prev = ''
  try { prev = await readFile(path, 'utf8') } catch {}
  if (prev === text) continue
  stale++
  if (check) { console.error(`stale: ${path}`); continue }
  await writeFile(`${path}.tmp`, text)
  await rename(`${path}.tmp`, path)
}
if (check && stale) process.exit(1)
console.log(`money: ${ledger.events.length} events, ${ledger.lines.length} lines, ${ledger.projects.length} projects; ${confirmed} news events confirmed by official records${check ? '' : `; wrote ${stale} file(s)`}`)
