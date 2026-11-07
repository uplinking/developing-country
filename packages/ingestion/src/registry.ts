// The browser-safe registry is also the allowlist for runtime dataset reads.
export const scheduledSources = [{
  id: 'nso-generation-api',
  datasetIds: ['electricity-generation-quarter-hourly', 'electricity-generation-daily'],
  startDate: '2026-09-11', timeZone: 'Asia/Colombo',
  lookbackDays: 3, backfillDaysPerRun: 3, maxResponseBytes: 2_000_000,
}] as const
export const sourceForDataset = (id: string) => scheduledSources.find(source => source.datasetIds.some(candidate => candidate === id))
