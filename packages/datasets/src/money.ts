/**
 * Money & projects tracker: shared vocabulary and the counting contract.
 *
 * One module is used by the build script (to write `lk-initiative-funding`), the public
 * dashboard (to total whatever the visitor filters) and the tests, so a total can never
 * be computed two different ways. See docs/initiatives/DATA_MODEL.md.
 */

export const MONEY_STAGES = [
  'proposed', 'pledged', 'cost_estimate',
  'funder_approved', 'govt_authorised', 'allocated',
  'contract_awarded', 'agreement_signed',
  'disbursed', 'released', 'spent',
] as const
export const DELIVERY_STAGES = ['launched', 'underway', 'completed', 'halted', 'unclear'] as const
export type MoneyStage = (typeof MONEY_STAGES)[number]
export type EventStage = MoneyStage | (typeof DELIVERY_STAGES)[number]

export const BUCKETS = ['announced', 'approved', 'contracted', 'paid'] as const
export type Bucket = (typeof BUCKETS)[number]

export const STAGE_BUCKET: Readonly<Record<MoneyStage, Bucket>> = {
  proposed: 'announced', pledged: 'announced', cost_estimate: 'announced',
  funder_approved: 'approved', govt_authorised: 'approved', allocated: 'approved',
  contract_awarded: 'contracted', agreement_signed: 'contracted',
  disbursed: 'paid', released: 'paid', spent: 'paid',
}

export const STAGE_LABEL: Readonly<Record<EventStage, string>> = {
  proposed: 'Proposed', pledged: 'Pledged', cost_estimate: 'Cost estimate',
  funder_approved: 'Lender approved', govt_authorised: 'Cabinet cleared', allocated: 'Budgeted',
  contract_awarded: 'Contract awarded', agreement_signed: 'Signed',
  disbursed: 'Paid out', released: 'Released', spent: 'Spent',
  launched: 'Launched', underway: 'Underway', completed: 'Completed', halted: 'Halted', unclear: 'Unclear',
}

export const BUCKET_LABEL: Readonly<Record<Bucket, string>> = {
  announced: 'Announced', approved: 'Approved', contracted: 'Contracted', paid: 'Paid',
}

/** What an initiative is for. culture_sport covers heritage, religion, the arts and sport; defence covers the armed forces and security. */
export const SECTORS = ['transport', 'water', 'energy', 'health', 'education', 'agriculture', 'housing', 'environment', 'digital',
  'social_protection', 'disaster_recovery', 'urban', 'governance', 'industry', 'tourism', 'culture_sport', 'defence', 'other'] as const

export const INSTRUMENTS = ['loan', 'grant', 'govt_funds', 'equity', 'guarantee', 'in_kind', 'mixed', 'unknown'] as const
export const ORIGINS = ['overseas', 'domestic', 'unknown'] as const
export const PURPOSES = ['project', 'programme', 'budget_support', 'balance_of_payments', 'relief', 'unknown'] as const
/** `rate` is a per-person, per-unit or per-month figure (Rs 110 per meal): never a total, never summed. */
export const BASES = ['total', 'tranche', 'cumulative', 'annual', 'component', 'rate'] as const
export const EVIDENCE = ['machine_read', 'reviewed', 'disputed', 'retracted'] as const

export function bucketOf(stage: string): Bucket | null {
  return (STAGE_BUCKET as Record<string, Bucket>)[stage] ?? null
}

/** The fields the counting contract reads. Real events carry more. */
export interface CountableEvent {
  id: string
  line_id: string
  date: string
  stage: string
  amount: number | null
  currency: string | null
  basis?: string | null
  evidence?: string
}

export interface CurrencyTotal { amount: number; ids: string[] }
export interface MoneyTotals {
  totals: Record<Bucket, Record<string, CurrencyTotal>>
  /** Events in a bucket whose amount was not reported: never counted as zero. */
  missing: Record<Bucket, string[]>
}

/**
 * Totals per public stage per currency for an already-filtered set of events.
 *
 * - Never adds across stages or currencies.
 * - Announced / Approved / Contracted: each funding line counts once per stage, using its
 *   latest event in the set. A Cabinet clearance after a lender approval of the same money is
 *   not extra money, and a revised estimate replaces the old one.
 * - Paid: tranches add up. A cumulative position counts only for a line with no tranches in
 *   the set, and then only its latest value.
 * - Retracted events never count. A rate (per person, per unit, per month) or a disputed amount
 *   (the source printed an impossible figure, e.g. "USD 85bn" for a university grant) is listed
 *   as missing, never added.
 */
export function moneyTotals(events: readonly CountableEvent[]): MoneyTotals {
  const totals = { announced: {}, approved: {}, contracted: {}, paid: {} } as MoneyTotals['totals']
  const missing: MoneyTotals['missing'] = { announced: [], approved: [], contracted: [], paid: [] }
  const latest = new Map<string, CountableEvent>()
  const tranched = new Set<string>()
  const uncountable = (e: CountableEvent) => e.basis === 'rate' || e.evidence === 'disputed'
  const live = events.filter(e => e.evidence !== 'retracted')
  for (const e of live) {
    if (bucketOf(e.stage) === 'paid' && e.basis !== 'cumulative' && !uncountable(e) && e.amount != null && e.currency) tranched.add(`${e.line_id}|${e.currency}`)
  }
  const add = (b: Bucket, e: CountableEvent) => {
    const c = (totals[b][e.currency!] ??= { amount: 0, ids: [] })
    c.amount += e.amount!
    c.ids.push(e.id)
  }
  for (const e of live) {
    const b = bucketOf(e.stage)
    if (!b) continue
    if (e.amount == null || !e.currency || uncountable(e)) { missing[b].push(e.id); continue }
    if (b === 'paid' && e.basis !== 'cumulative') { add(b, e); continue }
    if (b === 'paid' && tranched.has(`${e.line_id}|${e.currency}`)) continue
    const key = `${b}|${e.line_id}|${e.currency}`
    const cur = latest.get(key)
    if (!cur || e.date > cur.date || (e.date === cur.date && e.id > cur.id)) latest.set(key, e)
  }
  for (const [key, e] of latest) add(key.split('|')[0] as Bucket, e)
  return { totals, missing }
}
