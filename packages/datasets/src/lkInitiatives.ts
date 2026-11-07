import type { IndicatorDatasetDefinition } from './presets'

const VINTAGE = 'News read from Aug 2026; IMF since 2023; World Bank since 2023'

export const LK_INITIATIVE_DATASETS: IndicatorDatasetDefinition[] = [
  {
    id: 'lk-initiative-events',
    title: 'Initiative events',
    label: 'Initiatives',
    themeIds: ['GOVE', 'INTR'],
    sourceIds: ['lk-initiatives-ledger'],
    vintage: VINTAGE,
    description: 'What happened to public initiatives and money in Sri Lanka, one real act per row: proposals, approvals, contracts, payments, launches and halts.',
    note: {
      dek: 'Follow public initiatives and the money behind them, one decision at a time.',
      question: 'What has been proposed, approved, contracted, paid or launched, by whom and when?',
      contains: 'Weekly news from the lk_news archive (English, from Aug 2026) read into events, plus official IMF, World Bank, ADB and Cabinet records. Repeated news reports of one decision are folded into one event.',
      use: 'Filter by funder, stage, sector or date. Use lk-initiative-funding for amounts: this table mixes stages and currencies.',
      limit: 'Partial coverage, not a national inventory. Events marked machine_read are extracted from news and not yet reviewed. Sinhala and Tamil news are not read yet.',
    },
    presets: [{
      id: 'events-by-funder',
      title: 'Events by funder',
      description: 'Counts events, not money.',
      query: { fields: ['funder_name', 'event_count'], limit: 200 },
      chart: { family: 'ranking', dimension: { field: 'funder_name', label: 'Funder' }, measure: { field: 'event_count', label: 'Events', unit: 'events' }, orientation: 'horizontal' },
    }],
  },
  {
    id: 'lk-initiative-funding',
    title: 'Initiative funding by stage',
    label: 'Initiative funding',
    themeIds: ['GOVE', 'INTR'],
    sourceIds: ['lk-initiatives-ledger'],
    vintage: VINTAGE,
    description: 'How much money was announced, approved, contracted or paid, by funder, origin, instrument or sector, in the currency it was published in.',
    note: {
      dek: 'Read honest totals: one stage, one currency, each decision counted once.',
      question: 'How much has a funder approved or paid in a year, and for what?',
      contains: 'Totals per year (and all years), grouping, money stage and currency, computed from lk-initiative-events. A lender approval and a later Cabinet clearance of the same money count once.',
      use: 'Pick one period, one group_by (funder, origin, instrument, sector or all) and one bucket, then read amount for each currency.',
      limit: 'Recorded totals, not national totals. Rows overlap across groupings and periods and must not be summed. Currencies are never converted. Whole budgets (Appropriation Acts, council budgets, supplementary estimates) and debt operations are never added; they stay in lk-initiative-events.',
    },
    presets: [{
      id: 'approved-by-funder-usd',
      title: 'Approved in US dollars, by funder',
      description: 'Approved money published in USD, all recorded years.',
      query: {
        fields: ['group_label', 'amount'],
        where: [
          { field: 'period', op: 'eq', value: 'all' },
          { field: 'group_by', op: 'eq', value: 'funder' },
          { field: 'bucket', op: 'eq', value: 'approved' },
          { field: 'currency', op: 'eq', value: 'USD' },
        ],
        limit: 200,
      },
      chart: { family: 'ranking', dimension: { field: 'group_label', label: 'Funder' }, measure: { field: 'amount', label: 'Approved', unit: 'USD' }, orientation: 'horizontal' },
    }],
  },
]
