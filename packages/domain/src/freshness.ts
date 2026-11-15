export type RefreshKind = 'automated' | 'curated' | 'live'
export type FreshnessStatus = 'fresh' | 'due' | 'overdue' | 'live' | 'invalid'

export interface FreshnessPolicy {
  automated_default_days: number
  curated_default_days: number
  overdue_multiplier?: number
}

export interface FreshnessSource {
  refreshed: string
  refresh: string
  refresh_mode?: RefreshKind
  freshness_days?: number
  scheduled?: boolean
}

export interface FreshnessState {
  status: FreshnessStatus
  kind: RefreshKind
  assessed_at: string
  refreshed_at: string
  age_days: number | null
  due_at: string | null
  stale_after_days: number | null
  scheduled: boolean
}

const DAY_MS = 86_400_000
const STATUS_PRIORITY: Record<FreshnessStatus, number> = {
  live: 0,
  fresh: 1,
  due: 2,
  overdue: 3,
  invalid: 4,
}

export function refreshKind(source: FreshnessSource): RefreshKind {
  if (source.refresh_mode) return source.refresh_mode
  if (source.refresh === 'live') return 'live'
  if (source.refresh === 'curated') return 'curated'
  return 'automated'
}

function parseAsOf(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isNaN(timestamp) || isoDate(timestamp) !== value ? null : timestamp
}

// Imprecise registry dates mean "verified sometime in this period". Use the
// period end so a YYYY or YYYY-MM value is not declared stale prematurely.
export function refreshedPeriod(value: string): { start: number; end: number } | null {
  if (/^\d{4}$/.test(value)) {
    return { start: Date.UTC(Number(value), 0, 1), end: Date.UTC(Number(value), 11, 31) }
  }
  const month = /^(\d{4})-(\d{2})$/.exec(value)
  if (month) {
    const monthNumber = Number(month[2])
    if (monthNumber < 1 || monthNumber > 12) return null
    return {
      start: Date.UTC(Number(month[1]), monthNumber - 1, 1),
      end: Date.UTC(Number(month[1]), monthNumber, 0),
    }
  }
  const timestamp = parseAsOf(value)
  return timestamp === null ? null : { start: timestamp, end: timestamp }
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

export function freshnessOf(
  source: FreshnessSource,
  policy: FreshnessPolicy,
  assessedAt = new Date().toISOString().slice(0, 10),
): FreshnessState {
  const kind = refreshKind(source)
  if (kind === 'live') {
    return {
      status: 'live',
      kind,
      assessed_at: assessedAt,
      refreshed_at: source.refreshed,
      age_days: null,
      due_at: null,
      stale_after_days: null,
      scheduled: false,
    }
  }

  const assessed = parseAsOf(assessedAt)
  const refreshed = refreshedPeriod(source.refreshed)
  const threshold = source.freshness_days ?? (
    kind === 'curated' ? policy.curated_default_days : policy.automated_default_days
  )
  if (
    assessed === null || refreshed === null || refreshed.start > assessed ||
    !Number.isInteger(threshold) || threshold < 1
  ) {
    return {
      status: 'invalid',
      kind,
      assessed_at: assessedAt,
      refreshed_at: source.refreshed,
      age_days: null,
      due_at: null,
      stale_after_days: Number.isInteger(threshold) ? threshold : null,
      scheduled: source.scheduled === true && kind === 'automated',
    }
  }

  const ageDays = Math.max(0, Math.floor((assessed - refreshed.end) / DAY_MS))
  const overdueAfter = threshold * (policy.overdue_multiplier ?? 2)
  const status: FreshnessStatus = ageDays > overdueAfter ? 'overdue' : ageDays > threshold ? 'due' : 'fresh'
  return {
    status,
    kind,
    assessed_at: assessedAt,
    refreshed_at: source.refreshed,
    age_days: ageDays,
    due_at: isoDate(refreshed.end + (threshold + 1) * DAY_MS),
    stale_after_days: threshold,
    scheduled: source.scheduled === true && kind === 'automated',
  }
}

export function aggregateFreshness(states: FreshnessState[]): FreshnessState {
  if (states.length === 0) {
    return {
      status: 'invalid', kind: 'curated', assessed_at: new Date().toISOString().slice(0, 10),
      refreshed_at: '', age_days: null, due_at: null, stale_after_days: null, scheduled: false,
    }
  }
  return states.reduce((worst, state) =>
    STATUS_PRIORITY[state.status] > STATUS_PRIORITY[worst.status] ? state : worst,
  )
}
