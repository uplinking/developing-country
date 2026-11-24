// Sri Lanka company map → four queryable indicator tables in apps/explore/public/data/.
//   bun scripts/companies/build.ts          write the tables
//   bun scripts/companies/build.ts --check  fail if they are stale
//
// Input: scripts/companies/source/*.json, the flat export of the company map (companies, sector tags,
// relationships, segments). It is compiled from the 2025/26 annual reports of every CSE-listed company
// and from web research on large unlisted companies; every row carries a source URL.
//
// query_data filters with eq / gte / lte / in on scalar columns, so every filter people need is its
// own column (operates_abroad, exports, employees, revenue_growth_pct, …), and the multi-valued
// sector tags get their own table, one row per company and tag, with the main measures repeated.
import { readFile, writeFile, rename } from 'node:fs/promises'
import { COMPANY_SECTOR_BY_TAG } from '../../packages/datasets/src/companySectors'
import { parseIndicatorTable, type IndicatorField, type IndicatorRow } from '../../packages/datasets/src/table'

type Json = Record<string, any>
const check = process.argv.includes('--check')
const SRC = new URL('./source/', import.meta.url)
const OUT = 'apps/explore/public/data'
const SOURCE_IDS = ['lk-company-map']
const VINTAGE = 'Annual reports for financial years ending Mar 2025 to Mar 2026; web research Nov 2026'
const CAVEATS = [
  'Coverage: all 262 companies with ordinary shares on the Colombo Stock Exchange and the companies their annual reports name, plus about 850 large unlisted companies found by web research. Not a census of Sri Lankan companies.',
  'Figures from annual reports were extracted by software and each one checked against the report page it cites; facts about unlisted companies come from the web sources linked on each row and were not re-checked.',
  'Seven listed companies have no usable report text (six files were errata notices and one a scanned image), so their financial figures are empty.',
  'Revenue is in LKR. US dollar figures are converted at a fixed LKR 300 to the dollar. What counts as revenue differs by business: revenue_kind says whether it is sales, gross income (banks and finance companies), insurance premium or interest income.',
  'Growth is given twice: nominal (in rupees, as reported) and real (after inflation). Real growth deflates nominal growth by the average change in the Colombo Consumer Price Index (CCPI, dataset ccpi-monthly) over the company\'s own financial year.',
  'Margins are net profit margin (profit after tax ÷ revenue) and pre-tax margin (profit before tax ÷ revenue); they are left empty for banks, insurers and finance companies, whose revenue is not sales, and where they exceed ±100% (investment and property companies).',
  'A parent company\'s revenue is consolidated and already includes its subsidiaries. To add up revenue or employees, use revenue_additive_lkr and employees_additive, which are filled only for top-level companies with comparable figures.',
  'Booleans such as exports and foreign_owned are true where a source says so and empty where nothing is known; empty does not mean false.',
  'Sectors are assigned from each company\'s own description and carry the words that justify them; companies with no description have no sector.',
]
const common = { schema_version: 1 as const, country: 'LK', source_ids: SOURCE_IDS, vintage: VINTAGE, caveats: CAVEATS }

const f = (id: string, label: string, type: IndicatorField['type'], role: IndicatorField['role'] = 'dimension', extra: Partial<IndicatorField> = {}): IndicatorField =>
  ({ id, label, role, type, ...extra }) as IndicatorField
const lkr = (id: string, label: string) => f(id, label, 'number', 'measure', { unit: 'LKR', aggregation: 'none' })
const lkrSum = (id: string, label: string) => f(id, label, 'number', 'measure', { unit: 'LKR', aggregation: 'sum' })
const pctM = (id: string, label: string) => f(id, label, 'number', 'measure', { unit: '%', aggregation: 'none' })
const int = (id: string, label: string, aggregation: 'none' | 'sum' = 'none') => f(id, label, 'integer', 'measure', { aggregation })

const load = async (name: string): Promise<Json[]> => JSON.parse(await readFile(new URL(name, SRC), 'utf8'))

/** Coerce every cell to its declared type; empty and unparseable cells become null. */
function typed(rows: Json[], fields: IndicatorField[]): IndicatorRow[] {
  return rows.map(r => Object.fromEntries(fields.map(fd => {
    const v = r[fd.id]
    if (v === undefined || v === null || v === '') return [fd.id, null]
    if (fd.type === 'boolean') return [fd.id, v === true || v === 'True' || v === 'true']
    if (fd.type === 'number' || fd.type === 'integer') {
      const n = Number(v)
      return [fd.id, Number.isFinite(n) ? (fd.type === 'integer' ? Math.round(n) : n) : null]
    }
    return [fd.id, String(v).slice(0, 4000)]
  })))
}

const companyFields: IndicatorField[] = [
  f('company_id', 'Company id', 'string'), f('name', 'Company', 'string'), f('registration_no', 'Registration number', 'string'),
  f('country', 'Country of incorporation', 'string'), f('legal_form', 'Legal form', 'string'),
  f('ownership', 'Ownership (listed, state_owned, family_group, foreign_multinational, private_local, …)', 'string'),
  f('listed', 'Listed on the CSE', 'boolean'), f('cse_symbol', 'CSE symbol', 'string'),
  f('group_id', 'Group id (company id of the parent company)', 'string'), f('group_name', 'Group', 'string'),
  f('relation_to_group', 'Position in the group (ultimate_parent, subsidiary, associate, joint_venture, …)', 'string'),
  f('is_group_head', 'Top-level company (parent of a group, or not in any group)', 'boolean'), int('group_companies', 'Companies in the group, including the parent'),
  f('what_it_does', 'What it does', 'string'),
  f('primary_sector', 'Main sector', 'string'), f('sector_family', 'Broad sector of the main sector', 'string'),
  f('sector_tags', 'All sectors (filter them in lk-company-sectors)', 'string'),
  f('isic4', 'ISIC Rev. 4 class', 'string'), f('isic_section', 'ISIC section', 'string'), f('isic_section_label', 'ISIC section (label)', 'string'),
  f('period_end', 'Financial year end (listed companies)', 'string'), f('revenue_year', 'Year the revenue figure is for', 'integer'),
  lkr('revenue_lkr', 'Revenue, latest year'), lkr('revenue_prior_lkr', 'Revenue, the year before'),
  f('revenue_kind', 'What the revenue figure is (sales, sales_incl_excise, gross_income, insurance_premium, interest_income, as_reported)', 'string'),
  f('revenue_comparable', 'Revenue can be compared and ranked: a full year from 2024 on, from an annual report or a web figure in rupees', 'boolean'),
  f('revenue_may_include_overseas', 'Revenue may include business outside Sri Lanka (group with overseas operations, or a figure in US dollars)', 'boolean'),
  lkrSum('revenue_additive_lkr', 'Revenue that can be added up: top-level companies with comparable revenue only'),
  pctM('revenue_growth_nominal_pct', 'Revenue growth, nominal: latest year on the year before, in rupees as reported'),
  pctM('inflation_pct', 'Inflation over the financial year (average CCPI, latest year on the year before)'),
  pctM('revenue_growth_real_pct', 'Revenue growth, real: nominal growth after removing CCPI inflation'),
  f('revenue_growth_note', 'Caution on the growth figure', 'string'),
  f('revenue_scope', 'Revenue covers (group = whole group, consolidated; company = this company only)', 'string'),
  f('revenue_label', 'Name of the revenue line in the report', 'string'), f('revenue_basis', 'Where the revenue figure comes from', 'string'),
  lkr('profit_before_tax_lkr', 'Profit before tax, latest year'), lkr('profit_before_tax_prior_lkr', 'Profit before tax, the year before'),
  lkr('profit_after_tax_lkr', 'Profit after tax (net profit), latest year'), lkr('profit_after_tax_prior_lkr', 'Profit after tax (net profit), the year before'),
  pctM('profit_after_tax_growth_pct', 'Growth in profit after tax, nominal (only when both years are profits)'),
  pctM('pretax_margin_pct', 'Pre-tax margin: profit before tax ÷ revenue'),
  pctM('net_profit_margin_pct', 'Net profit margin: profit after tax ÷ revenue'),
  pctM('return_on_equity_pct', 'Return on equity: profit after tax ÷ total equity at year end'),
  pctM('return_on_assets_pct', 'Return on assets: profit after tax ÷ total assets at year end'),
  pctM('equity_to_assets_pct', 'Equity ÷ total assets (lower means more borrowing)'),
  lkr('total_assets_lkr', 'Total assets, latest year end'), lkr('total_equity_lkr', 'Total equity, latest year end'), lkr('total_equity_prior_lkr', 'Total equity, the year before'),
  f('performance', 'Performance: profitable_growing, profitable_shrinking, profitable, back_to_profit, fell_into_loss, loss_both_years, negative_equity', 'string'),
  f('financial_notes', 'Notes on the financial figures (restatements, units, comparability)', 'string'),
  int('employees', 'Employees, latest year'), int('employees_prior', 'Employees, the year before'), int('employees_additive', 'Employees that can be added up: top-level companies only', 'sum'),
  f('employees_band', 'Employees (band)', 'string'),
  lkr('revenue_per_employee_lkr', 'Revenue per employee (group revenue ÷ group employees, listed groups)'),
  f('revenue_band', 'Revenue (band)', 'string'), lkr('revenue_outside_sri_lanka_lkr', 'Revenue from outside Sri Lanka'),
  f('exports', 'Exporter (names export markets or earns revenue outside Sri Lanka); empty means not known', 'boolean'),
  f('operates_abroad', 'Exports or operates overseas (exports, overseas subsidiaries or operations, or registered abroad); empty means not known', 'boolean'),
  f('export_markets', 'Export markets named', 'string'), f('countries_of_operation', 'Countries of operation', 'string'),
  int('foreign_subsidiaries', 'Overseas subsidiaries (whole group, for a parent company)'),
  int('foreign_links', 'Links to foreign companies (shareholders, partners, companies it has invested in)'),
  f('foreign_owned', 'Foreign-owned or has a foreign parent (false: shareholders known, no foreign majority; empty: not known)', 'boolean'),
  f('foreign_parent', 'Foreign parent or majority shareholder', 'string'),
  f('controller_name', 'Largest shareholder (listed companies), or the group a company belongs to', 'string'),
  f('controller_type', 'Type of the largest shareholder (person, company, state, state_enterprise, pension_fund, fund, nominee_or_custodian, group)', 'string'),
  pctM('controller_pct', 'Stake of the largest shareholder'), f('controller_country', 'Country of the largest shareholder', 'string'),
  pctM('state_holding_pct', 'Stake held by the state and state enterprises among the largest shareholders'),
  f('hq_city', 'Head office city', 'string'), f('major_shareholders', 'Largest shareholders as printed (listed companies only; see lk-company-shareholders)', 'string'),
  f('data_origin', 'Where the row comes from (annual_report, web_research, named_as_holder, …)', 'string'),
  f('status', 'Status', 'string'), f('source_url', 'Source', 'string'), f('source_name', 'Source name', 'string'),
]
const sectorFields: IndicatorField[] = [
  f('id', 'Row id', 'string'), f('company_id', 'Company id', 'string'), f('name', 'Company', 'string'), f('group_name', 'Group', 'string'),
  f('sector', 'Sector', 'string'), f('sector_family', 'Broad sector', 'string'), f('primary', 'Is the company\'s main sector', 'boolean'),
  f('evidence', 'Words in the company description that justify the sector', 'string'),
  lkr('revenue_lkr', 'Revenue, latest year (the whole company, repeated under each of its sectors)'),
  lkrSum('revenue_additive_lkr', 'Revenue that can be added up: under the main sector only, top-level companies with comparable revenue'),
  pctM('revenue_growth_nominal_pct', 'Revenue growth, nominal'), pctM('revenue_growth_real_pct', 'Revenue growth, real (deflated by the Colombo Consumer Price Index)'),
  pctM('net_profit_margin_pct', 'Net profit margin'), f('performance', 'Performance', 'string'),
  int('employees', 'Employees'), int('employees_additive', 'Employees that can be added up: main sector only, top-level companies', 'sum'),
  f('exports', 'Exporter; empty means not known', 'boolean'), f('operates_abroad', 'Exports or operates overseas; empty means not known', 'boolean'),
  f('ownership', 'Ownership', 'string'), f('controller_type', 'Type of the largest shareholder', 'string'),
  f('listed', 'Listed on the CSE', 'boolean'), f('is_group_head', 'Top-level company (parent of a group, or not in any group)', 'boolean'), f('source_url', 'Source', 'string'),
]
const relFields: IndicatorField[] = [
  f('id', 'Row id', 'string'), f('from_id', 'Shareholder company id', 'string'), f('from_name', 'Shareholder', 'string'),
  f('from_country', 'Shareholder country', 'string'), f('from_group_id', 'Shareholder\'s group id', 'string'),
  f('to_id', 'Company held (id)', 'string'), f('to_name', 'Company held', 'string'),
  f('to_country', 'Country of the company held', 'string'), f('to_group_id', 'Group id of the company held', 'string'),
  f('cross_group', 'Link between two different groups', 'boolean'),
  f('type', 'Link (holding, other_group_holding, associate, joint_venture, major_shareholder, member_per_web_sources, …)', 'string'),
  pctM('direct_pct', 'Direct stake'),
  f('reported_by', 'Annual report that states it (CSE symbol)', 'string'), f('source_url', 'Source', 'string'),
]
const segFields: IndicatorField[] = [
  f('id', 'Row id', 'string'), f('company_id', 'Company id', 'string'), f('company_name', 'Company', 'string'), f('cse_symbol', 'CSE symbol', 'string'),
  f('segment', 'Operating segment', 'string'), lkr('revenue_lkr', 'Segment revenue'), lkr('profit_lkr', 'Segment profit'),
  f('isic4', 'ISIC Rev. 4 class', 'string'), f('description', 'What the segment does', 'string'), f('products', 'Products and services', 'string'),
  f('countries', 'Countries', 'string'), f('source_url', 'Source', 'string'),
]
const holderFields: IndicatorField[] = [
  f('id', 'Row id', 'string'), f('company_id', 'Company id', 'string'), f('company_name', 'Company', 'string'),
  int('rank', 'Rank among the company\'s largest shareholders'),
  f('holder_id', 'Shareholder id (a company id when the shareholder is in the map; the same id across companies)', 'string'),
  f('holder_name', 'Shareholder', 'string'), f('holder_name_as_printed', 'Shareholder as printed in the report', 'string'),
  f('share_class', 'Share class (voting or non_voting) where the company prints them separately; the stake is a percentage of that class', 'string'),
  f('holder_type', 'Shareholder type (person, company, state, state_enterprise, pension_fund, fund, nominee_or_custodian, other)', 'string'),
  f('holder_country', 'Shareholder country (where known)', 'string'), f('holder_in_map', 'Shareholder is itself a company in lk-companies', 'boolean'),
  pctM('pct', 'Stake'), f('source_url', 'Source', 'string'),
]

const [companies, sectors, rels, segs, holders] = await Promise.all(['companies.json', 'company_sectors.json', 'relationships.json', 'segments.json', 'shareholders.json'].map(load))
const withId = (rows: Json[], key: (r: Json, i: number) => string) => rows.map((r, i) => ({ id: key(r, i), ...r }))

const tables = [
  parseIndicatorTable({ ...common, source_ids: [...SOURCE_IDS, 'dcs-ccpi-2021'], dataset_id: 'lk-companies', title: 'Sri Lankan companies and groups',
    grain: 'One row per company: listed companies, the companies their annual reports name, and large unlisted companies.',
    primary_key: ['company_id'], fields: companyFields, rows: typed(companies, companyFields),
    notes: [
      'is_group_head = true gives each group\'s parent company and every company outside any group; a group\'s companies share its group_id.',
      'Growth compares the latest and prior year printed in the same annual report (listed companies only). It is empty where the report says the years are not comparable (a changed year end, a 15-month period).',
      'To rank or add up revenue, filter revenue_comparable = true; revenue_additive_lkr and employees_additive can be summed with group_by.',
      'To filter by sector use lk-company-sectors; for shareholders use lk-company-shareholders.',
    ] }),
  parseIndicatorTable({ ...common, dataset_id: 'lk-company-sectors', title: 'Company sectors',
    grain: 'One row per company and sector tag.',
    primary_key: ['id'], fields: sectorFields, rows: typed(withId(sectors, r => `${r.company_id}|${r.sector}`), sectorFields),
    notes: ['A company has one to four sectors; primary = true marks its main one. Sum revenue_additive_lkr or employees_additive by sector_family to total a sector without counting a company twice.'] }),
  parseIndicatorTable({ ...common, dataset_id: 'lk-company-relationships', title: 'Company ownership',
    grain: 'One row per link between two companies, as stated in an annual report or a web source.',
    primary_key: ['id'], fields: relFields, rows: typed(withId(rels, (_, i) => `r${i + 1}`), relFields),
    notes: ['The largest stated shareholder (type holding) defines the group structure; smaller stakes are other_group_holding. Links of type named_in_report (a company mentioned without a stated stake) are not used to build group structure. Where reports disagree on a percentage, the holder\'s own report is used.'] }),
  parseIndicatorTable({ ...common, dataset_id: 'lk-company-segments', title: 'Company operating segments',
    grain: 'One row per operating segment of a listed group, as reported in its segment note.',
    primary_key: ['id'], fields: segFields, rows: typed(withId(segs, (r, i) => `${r.company_id}|${i + 1}`), segFields),
    notes: ['Segment revenue is external revenue in LKR where the report gives it. Where a segment note uses a different unit from the statements, it is rescaled to match the group\'s revenue.'] }),
  parseIndicatorTable({ ...common, dataset_id: 'lk-company-shareholders', title: 'Company shareholders',
    grain: 'One row per listed company and each of its largest shareholders, as printed in its annual report.',
    primary_key: ['id'], fields: holderFields, rows: typed(holders, holderFields),
    notes: [
      'Filter by holder_id to see everything one shareholder holds across listed companies (for example the Employees\' Provident Fund or the Secretary to the Treasury).',
      'Margin and joint accounts ("Bank PLC/Mr X") are shown under the person they are held for; account numbers are removed from names, and a holder\'s numbered accounts in one company are added together.',
      'Seven companies have voting and non-voting shares and print a shareholder list for each: share_class says which, and a stake is a percentage of that class, so a company\'s stakes can add up to more than 100%. The largest shareholder in lk-companies counts voting shares only.',
      'holder_type is assigned from the name and is not checked against company registries.',
    ] }),
]

for (const s of sectors) if (!COMPANY_SECTOR_BY_TAG.has(s.sector)) throw new Error(`unknown sector tag: ${s.sector}`)
// Self-checks: ids unique, every group id is a head, every company row has a source.
const ids = new Set(companies.map(c => c.company_id))
if (ids.size !== companies.length) throw new Error('duplicate company_id')
const heads = new Set(companies.filter(c => c.is_group_head === true || c.is_group_head === 'True').map(c => c.company_id))
for (const c of companies) if (!heads.has(c.group_id)) throw new Error(`group_id is not a head: ${c.company_id}`)
for (const t of tables) for (const r of t.rows) if ('source_url' in r && !r.source_url && !String(r.data_origin ?? '').startsWith('named_as')) throw new Error(`no source: ${t.dataset_id} ${JSON.stringify(r).slice(0, 120)}`)

let stale = 0
for (const t of tables) {
  const path = `${OUT}/${t.dataset_id}.json`
  const text = JSON.stringify(t) + '\n'
  const old = await readFile(path, 'utf8').catch(() => '')
  if (old === text) continue
  stale++
  if (check) { console.error(`stale: ${path}`); continue }
  await writeFile(`${path}.tmp`, text)
  await rename(`${path}.tmp`, path)
}
if (check && stale) process.exit(1)
console.log(`companies: ${companies.length} companies (${heads.size} groups), ${sectors.length} sector tags, ${rels.length} links, ${segs.length} segments, ${holders.length} shareholdings${check ? '' : `; wrote ${stale} file(s)`}`)
