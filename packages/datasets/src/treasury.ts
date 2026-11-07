import type { IndicatorDatasetDefinition } from './presets'
import type { PublicDataThemeId } from './themes'

export const TREASURY_TABLES = [
  {
    "id": "treasury-public-debt",
    "title": "Quarterly public debt composition",
    "source": "treasury-debt",
    "description": "Public debt composition across every listed quarterly edition from September 2022 to June 2026, retaining each edition’s historical comparisons and debt scope.",
    "caveat": "Reported totals overlap components. June values are provisional; debt perimeter differs from the CBSL annual continuity series. Historical reporting perimeters and classifications change; comparison-period revisions remain separate by reporting_period. No Q4 2022 bulletin is listed; December 2022 appears as a comparison in Q1 2023.",
    "default_metric": "Outstanding debt",
    "default_period": "2026-06-30",
    "default_unit": "LKR billion",
    "family": "comparison",
    "vintage": "2022 Q3–2026 Q2; 15 reporting editions with earlier comparison periods",
    "url": "https://www.treasury.gov.lk/web/quarterly-debt-bulletin-erd"
  },
  {
    "id": "treasury-domestic-debt",
    "title": "Domestic government debt by instrument",
    "source": "treasury-debt",
    "description": "Domestic government instruments across all 15 listed quarterly editions, including original USD and USD-million/LKR-billion reporting units.",
    "caveat": "Bills include interest. Amounts are positions, not new borrowing. Historical reporting perimeters and classifications change; comparison-period revisions remain separate by reporting_period. No Q4 2022 bulletin is listed; December 2022 appears as a comparison in Q1 2023. Earlier tables use USD, not USD million.",
    "default_metric": "Outstanding debt",
    "default_period": "2026-06-30",
    "default_unit": "LKR billion",
    "family": "comparison",
    "vintage": "2022 Q3–2026 Q2; 15 reporting editions with earlier comparison periods",
    "url": "https://www.treasury.gov.lk/web/quarterly-debt-bulletin-erd"
  },
  {
    "id": "treasury-external-creditors",
    "title": "External debt by creditor",
    "source": "treasury-debt",
    "description": "External government debt by creditor country and organization across all 15 listed quarterly editions; unpaid principal is included where published.",
    "caveat": "Subtotal rows overlap individual creditors; creditor classes must not be combined blindly. Historical reporting perimeters and classifications change; comparison-period revisions remain separate by reporting_period. No Q4 2022 bulletin is listed; December 2022 appears as a comparison in Q1 2023.",
    "default_metric": "Outstanding debt",
    "default_period": "2026-06-30",
    "default_unit": "USD million",
    "family": "comparison",
    "vintage": "2022 Q3–2026 Q2; 15 reporting editions with earlier comparison periods",
    "url": "https://www.treasury.gov.lk/web/quarterly-debt-bulletin-erd"
  },
  {
    "id": "treasury-province-debt",
    "title": "Local-authority debt by province",
    "source": "treasury-debt",
    "description": "Local-authority debt and reporting-authority counts by province across the seven quarterly tables from December 2024 through June 2026.",
    "caveat": "These are local-authority aggregates within provinces, not the borrowing of provincial councils. September 2025 Central Province has a printed USD/LKR conversion discrepancy retained as reported.",
    "default_metric": "Outstanding debt",
    "default_period": "2026-06-30",
    "default_unit": "LKR million",
    "family": "comparison",
    "vintage": "2024 Q4–2026 Q2",
    "url": "https://www.treasury.gov.lk/web/quarterly-debt-bulletin-erd"
  },
  {
    "id": "treasury-soe-finances",
    "title": "SOE annual financial performance",
    "source": "treasury-annual",
    "description": "Financial line items for named public enterprises from the 2025 Final Budget Position Report.",
    "caveat": "Accounts and line items differ by enterprise. Subtotals overlap components. Latest values may be provisional; each row cites its table page.",
    "default_metric": "Revenue",
    "default_period": "2025",
    "default_unit": "LKR million",
    "family": "comparison",
    "vintage": "2021–2025; 2025 final budget report",
    "url": "https://www.treasury.gov.lk/web/annual-reports"
  },
  {
    "id": "treasury-soe-sector-outturn",
    "title": "SOE sector financial outturn",
    "source": "treasury-annual",
    "description": "2025 revenue, 2024–2025 pre-tax profit/loss and SOE counts by sector.",
    "caveat": "Sector totals cover the stated SOEs, with provisional values; this is not every state-linked enterprise.",
    "default_metric": "Profit before tax",
    "default_period": "2025",
    "default_unit": "LKR million",
    "family": "comparison",
    "vintage": "2021–2025; 2025 final budget report",
    "url": "https://www.treasury.gov.lk/web/annual-reports"
  },
  {
    "id": "treasury-revenue-budget-outturn",
    "title": "Government revenue budget and outturn",
    "source": "treasury-annual",
    "description": "Government revenue estimates and actual receipts from the Treasury annual report.",
    "caveat": "Revenue categories include subtotals. Preserve source accounting classification and units.",
    "default_metric": "Actual revenue",
    "default_period": "2025",
    "default_unit": "LKR million",
    "family": "comparison",
    "vintage": "2021–2025; 2025 final budget report",
    "url": "https://www.treasury.gov.lk/web/annual-reports"
  },
  {
    "id": "treasury-fiscal-performance",
    "title": "Fiscal budget versus actual performance",
    "source": "treasury-fiscal",
    "description": "2025 fiscal performance against budget in the 2027 Fiscal Strategy Statement.",
    "caveat": "Actual, budget, deviation and GDP shares are different measures; rows overlap in the source hierarchy.",
    "default_metric": "Actual",
    "default_period": "2025",
    "default_unit": "LKR billion",
    "family": "comparison",
    "vintage": "2024–2026 observations; 2027 strategy statement",
    "url": "https://www.treasury.gov.lk/web/fiscal-strategy-statement"
  },
  {
    "id": "treasury-fiscal-in-year",
    "title": "In-year fiscal performance",
    "source": "treasury-fiscal",
    "description": "January–April fiscal receipts and spending compared with annual budgets, 2025 and 2026.",
    "caveat": "Jan–Apr flows are not full-year values; percentage columns retain the published denominator.",
    "default_metric": "Jan–Apr actual",
    "default_period": "2026",
    "default_unit": "LKR billion",
    "family": "comparison",
    "vintage": "2024–2026 observations; 2027 strategy statement",
    "url": "https://www.treasury.gov.lk/web/fiscal-strategy-statement"
  },
  {
    "id": "treasury-financial-soundness",
    "title": "Banking and finance-company soundness",
    "source": "treasury-fiscal",
    "description": "Published financial soundness indicators for banks and finance companies.",
    "caveat": "Sector aggregates; 2025 provisional. Indicator definitions and denominators differ.",
    "default_metric": "Stage 3 Loans Ratiob",
    "default_period": "2025",
    "default_unit": "percent",
    "family": "comparison",
    "vintage": "2024–2026 observations; 2027 strategy statement",
    "url": "https://www.treasury.gov.lk/web/fiscal-strategy-statement"
  },
  {
    "id": "treasury-procurement-status",
    "title": "Procurement outcomes",
    "source": "treasury-procurement",
    "description": "Reported procurement monitoring for selected public institutions, 2022–2024, 2025 and 2026 H1.",
    "caveat": "Selected high-value procurements only. ND is missing, not zero. The 2022–2024 window is pooled; its award-value column is an average.",
    "default_metric": "Procurement count",
    "default_period": "2026 H1",
    "default_unit": "procurements",
    "family": "comparison",
    "vintage": "2022–2024 pooled, 2025, 2026 H1",
    "default_category": "Awarded",
    "url": "https://www.treasury.gov.lk/web/pfd-public-procurement-data"
  },
  {
    "id": "treasury-procurement-bids",
    "title": "Procurement bid competition",
    "source": "treasury-procurement",
    "description": "Reported procurement monitoring for selected public institutions, 2022–2024, 2025 and 2026 H1.",
    "caveat": "Selected high-value procurements only. ND is missing, not zero. The 2022–2024 window is pooled; its award-value column is an average.",
    "default_metric": "Procurement count",
    "default_period": "2026 H1",
    "default_unit": "procurements",
    "family": "comparison",
    "vintage": "2022–2024 pooled, 2025, 2026 H1",
    "default_category": "1",
    "url": "https://www.treasury.gov.lk/web/pfd-public-procurement-data"
  },
  {
    "id": "treasury-procurement-competitiveness",
    "title": "Competitive procurement awards",
    "source": "treasury-procurement",
    "description": "Reported procurement monitoring for selected public institutions, 2022–2024, 2025 and 2026 H1.",
    "caveat": "Selected high-value procurements only. ND is missing, not zero. The 2022–2024 window is pooled; its award-value column is an average.",
    "default_metric": "Procurement count",
    "default_period": "2026 H1",
    "default_unit": "procurements",
    "family": "comparison",
    "vintage": "2022–2024 pooled, 2025, 2026 H1",
    "default_category": "Competitive",
    "url": "https://www.treasury.gov.lk/web/pfd-public-procurement-data"
  },
  {
    "id": "treasury-province-transfers",
    "title": "Government transfers to provinces",
    "source": "treasury-annual",
    "description": "2025 recurrent and capital transfers to provincial councils.",
    "caveat": "Central-government transfers are not the same as provincial expenditure. Values are provisional.",
    "default_metric": "Recurrent transfers",
    "default_period": "2025",
    "default_unit": "LKR million",
    "family": "comparison",
    "vintage": "2021–2025; 2025 final budget report",
    "url": "https://www.treasury.gov.lk/web/annual-reports"
  },
  {
    "id": "treasury-women-msme-finance",
    "title": "Women-owned and led MSME finance",
    "source": "treasury-women",
    "description": "Loan and deposit balances/counts by women-owned/led status in the 2025/2026 WE Finance Code report.",
    "caveat": "Reporting signatory counts differ by indicator. This is not a national firm census or household data.",
    "default_metric": "Outstanding loan value",
    "default_period": "2025/2026",
    "default_unit": "LKR million",
    "family": "comparison",
    "vintage": "2025/2026 reporting cycle",
    "url": "https://www.treasury.gov.lk/web/publications"
  },
  {
    "id": "treasury-guarantees",
    "title": "Treasury guarantees by institution and facility",
    "source": "treasury-debt",
    "description": "June 2026 facility-level original commitments and outstanding capital, with banks, issue/expiry dates and separate currency columns.",
    "caveat": "Merged outstanding balances are separate shared-facility records, never allocated to individual loans. Blank currency cells remain missing. Printed guarantee totals do not fully reconcile with the listed cells; consult the source discrepancy note.",
    "default_metric": "Outstanding principal",
    "default_period": "2026-06-30",
    "default_unit": "LKR million",
    "family": "comparison",
    "vintage": "2026 Q2",
    "url": "https://www.treasury.gov.lk/web/quarterly-debt-bulletin-erd"
  },
  {
    "id": "treasury-letters-of-comfort",
    "title": "Treasury letters of comfort by institution",
    "source": "treasury-debt",
    "description": "June 2026 facility-level original commitments and outstanding capital, with banks, issue/expiry dates and separate currency columns.",
    "caveat": "Three printed facilities with original and outstanding amounts in separate currencies. Expired issue/expiry dates are retained as printed; blanks are not zeros.",
    "default_metric": "Outstanding principal",
    "default_period": "2026-06-30",
    "default_unit": "LKR million",
    "family": "comparison",
    "vintage": "2026 Q2",
    "url": "https://www.treasury.gov.lk/web/quarterly-debt-bulletin-erd"
  }
] as const

/** Public names and reading notes for the reviewed Treasury tables. */
const TREASURY_COPY = {
  "treasury-public-debt": {
    "title": "Public debt composition",
    "chartTitle": "Public debt composition",
    "question": "How is public debt divided between government and public enterprises?",
    "use": "Compare the June 2026 debt components, or follow domestic debt across quarterly reports. Check the currency and debt coverage when comparing periods.",
    "chartDescription": "Public debt outstanding on 30 June 2026, in LKR billions.",
    "description": "Quarterly public debt by borrower and debt category, including government and public-enterprise totals."
  },
  "treasury-domestic-debt": {
    "title": "Domestic government debt by instrument",
    "chartTitle": "Domestic debt by instrument",
    "question": "Which instruments make up domestic government debt?",
    "use": "Compare outstanding debt by instrument. The historical tables include different currencies and units, so select one unit for each comparison.",
    "chartDescription": "Domestic government debt outstanding on 30 June 2026, in LKR billions.",
    "description": "Outstanding domestic government debt by borrowing instrument."
  },
  "treasury-external-creditors": {
    "title": "External government debt by creditor",
    "chartTitle": "External debt by creditor",
    "question": "Who are the government’s external creditors?",
    "use": "Compare debt owed to creditor countries and organisations. Historical reports also include unpaid principal where published.",
    "chartDescription": "External government debt outstanding on 30 June 2026, in USD millions.",
    "description": "Outstanding external government debt by creditor country and organisation."
  },
  "treasury-province-debt": {
    "title": "Local-authority debt by province",
    "chartTitle": "Local-authority debt by province",
    "question": "How does local-authority debt vary by province?",
    "use": "Compare local-authority debt across provinces, or use the historical tables to examine changes since December 2024.",
    "chartDescription": "Local-authority debt outstanding on 30 June 2026, in LKR millions.",
    "description": "Local-authority debt and the number of reporting authorities, grouped by province."
  },
  "treasury-soe-finances": {
    "title": "State-owned enterprise finances",
    "chartTitle": "State-owned enterprise revenue",
    "question": "How do the finances of state-owned enterprises compare?",
    "use": "Compare enterprise revenue, profit, losses and other reported accounts. The chart shows revenue; other financial measures are available in the table.",
    "chartDescription": "Reported enterprise revenue in 2025, in LKR millions.",
    "description": "Revenue, profit, losses and other financial measures for named state-owned enterprises."
  },
  "treasury-soe-sector-outturn": {
    "title": "State-owned enterprise finances by sector",
    "chartTitle": "State-owned enterprise profit by sector",
    "question": "How do state-owned enterprise profits differ by sector?",
    "use": "Compare sector revenue and pre-tax profit or loss, with the number of enterprises covered by each sector.",
    "chartDescription": "Pre-tax profit or loss in 2025, in LKR millions.",
    "description": "State-owned enterprise revenue, pre-tax profit or loss, and enterprise counts by sector."
  },
  "treasury-revenue-budget-outturn": {
    "title": "Government revenue: budget and actual",
    "chartTitle": "Government revenue by category",
    "question": "How did actual government revenue compare with the budget?",
    "use": "Compare budgeted revenue with actual receipts and the reported difference for each revenue category.",
    "chartDescription": "Actual revenue in 2025, in LKR millions.",
    "description": "Budgeted government revenue, actual receipts and differences by revenue category."
  },
  "treasury-fiscal-performance": {
    "title": "Government budget and fiscal results",
    "chartTitle": "Government fiscal results",
    "question": "How did government revenue and spending compare with the budget?",
    "use": "Compare 2025 budget and actual figures for fiscal measures. Amounts, budget differences and shares of GDP are separate measures.",
    "chartDescription": "Actual fiscal figures for 2025, in LKR billions, from the 2027 Fiscal Strategy Statement.",
    "description": "Government revenue, spending and balances compared with the 2025 budget."
  },
  "treasury-fiscal-in-year": {
    "title": "Government finances, January–April",
    "chartTitle": "Government revenue and spending",
    "question": "How much of the annual budget was collected or spent by April?",
    "use": "Compare January–April receipts and spending with the annual budgets for 2025 and 2026.",
    "chartDescription": "January–April 2026 receipts and spending, in LKR billions.",
    "description": "Government receipts and spending for January–April, compared with annual budgets for 2025 and 2026."
  },
  "treasury-financial-soundness": {
    "title": "Financial soundness indicators",
    "chartTitle": "Stage 3 loan ratio",
    "question": "What do the indicators show about banks and finance companies?",
    "use": "Compare the published banking and finance-company ratios. The chart shows Stage 3 loans as a percentage of loans; check each indicator’s denominator before comparison.",
    "chartDescription": "Stage 3 loans as a percentage of loans in 2025. Figures are provisional.",
    "description": "Financial soundness ratios for banks and finance companies."
  },
  "treasury-procurement-status": {
    "title": "Procurement status",
    "chartTitle": "Procurement status",
    "question": "What stage have the monitored procurements reached?",
    "use": "Compare procurement counts and values by outcome and institution. The chart shows awarded procurements in the first half of 2026.",
    "chartDescription": "Awarded procurement counts by institution, January–June 2026.",
    "description": "Counts and values of monitored public procurements by status and institution."
  },
  "treasury-procurement-bids": {
    "title": "Procurement bid counts",
    "chartTitle": "Procurements receiving one bid",
    "question": "How many bids were received for the monitored procurements?",
    "use": "Compare procurement counts across bid-count bands and institutions. The chart shows procurements receiving one bid.",
    "chartDescription": "Number of monitored procurements receiving one bid, by institution, January–June 2026.",
    "description": "Counts of monitored public procurements by the number of bids received."
  },
  "treasury-procurement-competitiveness": {
    "title": "Competitive procurement awards",
    "chartTitle": "Competitive procurement awards",
    "question": "How many monitored awards used competitive procurement?",
    "use": "Compare competitive and noncompetitive awards by institution, using procurement counts or reported award values. The chart shows competitive awards.",
    "chartDescription": "Competitive procurement counts by institution, January–June 2026.",
    "description": "Counts and values of competitive and noncompetitive public procurement awards."
  },
  "treasury-province-transfers": {
    "title": "Transfers to provincial councils",
    "chartTitle": "Recurrent transfers to provinces",
    "question": "How are government transfers distributed among provincial councils?",
    "use": "Compare recurrent and capital transfers to provincial councils. The chart shows recurrent transfers.",
    "chartDescription": "Recurrent transfers in 2025, in LKR millions.",
    "description": "Recurrent and capital government transfers to provincial councils."
  },
  "treasury-women-msme-finance": {
    "title": "Finance for women-owned and women-led MSMEs",
    "chartTitle": "MSME loan balances",
    "question": "What loans and deposits are reported for women-owned and women-led businesses?",
    "use": "Compare loan and deposit balances and account counts for women-owned or women-led micro, small and medium enterprises and the other businesses in the report.",
    "chartDescription": "Outstanding loan balances in the 2025/2026 WE Finance Code report, in LKR millions.",
    "description": "Loan and deposit balances and account counts for women-owned or women-led MSMEs, compared with other businesses."
  },
  "treasury-guarantees": {
    "title": "Treasury guarantees",
    "chartTitle": "Outstanding guaranteed principal",
    "question": "What loan commitments and outstanding balances are covered by Treasury guarantees?",
    "use": "Compare commitments and outstanding principal by facility, institution or currency. Balances shared by several facilities are listed once.",
    "chartDescription": "Outstanding guaranteed principal on 30 June 2026, in LKR millions.",
    "description": "Treasury guarantee commitments and outstanding principal by facility, institution and currency."
  },
  "treasury-letters-of-comfort": {
    "title": "Treasury letters of comfort",
    "chartTitle": "Outstanding principal under letters of comfort",
    "question": "Which facilities are covered by Treasury letters of comfort?",
    "use": "Compare the three reported facilities, their original commitments, outstanding principal, banks and issue or expiry dates.",
    "chartDescription": "Outstanding principal on 30 June 2026, in LKR millions.",
    "description": "Commitments and outstanding principal for facilities covered by Treasury letters of comfort."
  }
} as const

/** Every Treasury table is ECON + GOVE; these add the subject a table crosses into. */
const TREASURY_EXTRA_THEMES: Partial<Record<keyof typeof TREASURY_COPY, PublicDataThemeId[]>> = {
  'treasury-external-creditors': ['INTR'],
  'treasury-province-debt': ['REGI'],
  'treasury-province-transfers': ['REGI'],
  'treasury-women-msme-finance': ['SOCI'],
}

export const TREASURY_DATASETS: readonly IndicatorDatasetDefinition[] = TREASURY_TABLES.map(d => ({
  id: d.id, title: TREASURY_COPY[d.id].title, label: TREASURY_COPY[d.id].title, themeIds: ['ECON', 'GOVE', ...(TREASURY_EXTRA_THEMES[d.id] ?? [])],
  description: TREASURY_COPY[d.id].description, sourceIds: [d.source], vintage: d.vintage,
  note: {
    dek: TREASURY_COPY[d.id].description,
    question: TREASURY_COPY[d.id].question,
    contains: `${d.description} The table includes selected measures from the cited publications.`,
    use: TREASURY_COPY[d.id].use,
    limit: `${d.caveat} Only the listed measures are included. Totals and components overlap. A dash or ND means missing data.`,
  },
  presets: [{
    id: 'reported-values', title: TREASURY_COPY[d.id].chartTitle, description: TREASURY_COPY[d.id].chartDescription,
    query: { fields: ['label', 'value'], where: [
      { field: 'metric', op: 'eq', value: d.default_metric },
      { field: 'period', op: 'eq', value: d.default_period },
      { field: 'unit', op: 'eq', value: d.default_unit },
      ...('default_category' in d ? [{ field: 'category', op: 'eq' as const, value: d.default_category }] : []),
    ], order_by: [{ field: 'value', direction: 'desc' }], limit: 100 },
    chart: { family: 'comparison', dimension: { field: 'label', label: 'Reported item' }, measure: { field: 'value', label: d.id === 'treasury-financial-soundness' ? 'Stage 3 loan ratio' : d.default_metric, unit: d.default_unit }, orientation: 'horizontal' },
  }, ...(d.id === 'treasury-public-debt' ? [{
    id: 'domestic-history', title: 'Domestic debt',
    description: 'Domestic debt at the end of each available reporting quarter, in USD millions at the reported exchange rates.',
    query: { fields: ['period', 'value'], where: [
      { field: 'subject', op: 'eq' as const, value: 'Domestic Debt' },
      { field: 'unit', op: 'eq' as const, value: 'USD million' },
      { field: 'observation_role', op: 'eq' as const, value: 'current edition period' },
    ], order_by: [{ field: 'period', direction: 'asc' as const }], limit: 100 },
    chart: { family: 'trend' as const, dimension: { field: 'period', label: 'Quarter end' }, measure: { field: 'value', label: 'Domestic debt', unit: 'USD million' } },
  }] : [])],
}))
