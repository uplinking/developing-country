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
  'Figures from annual reports were machine-read and each one checked against the report page it cites; facts about unlisted companies come from the web sources linked on each row and were not re-checked.',
  'Seven listed companies have no usable report text (six cached files are errata letters, one is a scan), so their financial figures are empty.',
  'Revenue is in LKR. US dollar figures are converted at a fixed LKR 300. Banks report gross income and insurers gross written premium as revenue.',
  'A group head\'s revenue is consolidated and already includes its subsidiaries: never add a group to its members.',
  'Sector tags are assigned from each company\'s own description and carry the words that justify them; companies with no description have no tag.',
]
const common = { schema_version: 1 as const, country: 'LK', source_ids: SOURCE_IDS, vintage: VINTAGE, caveats: CAVEATS }

const f = (id: string, label: string, type: IndicatorField['type'], role: IndicatorField['role'] = 'dimension', extra: Partial<IndicatorField> = {}): IndicatorField =>
  ({ id, label, role, type, ...extra }) as IndicatorField
const lkr = (id: string, label: string) => f(id, label, 'number', 'measure', { unit: 'LKR', aggregation: 'none' })

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
  f('group_id', 'Group id (company id of the group head)', 'string'), f('group_name', 'Group', 'string'),
  f('relation_to_group', 'Relation to group (ultimate_parent, subsidiary, associate, joint_venture, …)', 'string'),
  f('is_group_head', 'Heads a group', 'boolean'), f('group_companies', 'Companies in the group (heads only)', 'integer', 'measure', { aggregation: 'none' }),
  f('what_it_does', 'What it does', 'string'),
  f('primary_sector', 'Main sector tag', 'string'), f('sector_family', 'Sector family of the main tag', 'string'),
  f('sector_tags', 'All sector tags (see lk-company-sectors to filter)', 'string'),
  f('isic4', 'ISIC Rev. 4 class', 'string'), f('isic_section', 'ISIC section', 'string'), f('isic_section_label', 'ISIC section (label)', 'string'),
  f('period_end', 'Financial year end', 'string'),
  lkr('revenue_lkr', 'Revenue, latest year'), lkr('revenue_prior_lkr', 'Revenue, prior year'),
  f('revenue_growth_pct', 'Revenue growth', 'number', 'measure', { unit: '%', aggregation: 'none' }),
  f('revenue_scope', 'Revenue scope (group = consolidated, company = this company alone)', 'string'),
  f('revenue_label', 'Revenue line as printed', 'string'), f('revenue_basis', 'Revenue basis', 'string'),
  lkr('profit_after_tax_lkr', 'Profit after tax, latest year'), lkr('profit_after_tax_prior_lkr', 'Profit after tax, prior year'),
  f('profit_growth_pct', 'Profit after tax growth', 'number', 'measure', { unit: '%', aggregation: 'none' }),
  lkr('total_assets_lkr', 'Total assets'),
  f('employees', 'Employees', 'integer', 'measure', { aggregation: 'none' }), f('employees_band', 'Employees (band)', 'string'),
  f('revenue_band', 'Revenue (band)', 'string'), lkr('revenue_outside_sri_lanka_lkr', 'Revenue from outside Sri Lanka'),
  f('operates_abroad', 'Operates abroad (exports, foreign subsidiaries or operations, or incorporated abroad)', 'boolean'),
  f('exports', 'Exports or earns revenue abroad', 'boolean'), f('export_markets', 'Export markets named', 'string'),
  f('countries_of_operation', 'Countries of operation', 'string'),
  f('foreign_subsidiaries', 'Foreign subsidiaries (group-wide for heads)', 'integer', 'measure', { aggregation: 'none' }),
  f('foreign_links', 'Links to foreign companies (holders, partners, investees)', 'integer', 'measure', { aggregation: 'none' }),
  f('foreign_owned', 'Foreign-owned or foreign parent', 'boolean'), f('foreign_parent', 'Foreign parent or holder', 'string'),
  f('hq_city', 'Head office city', 'string'), f('major_shareholders', 'Major shareholders (listed)', 'string'),
  f('financial_notes', 'Notes on the financial figures (restatements, units, comparability)', 'string'),
  f('data_origin', 'Where the row comes from (annual_report, web_research, named_as_holder, …)', 'string'),
  f('status', 'Status', 'string'), f('source_url', 'Source', 'string'), f('source_name', 'Source name', 'string'),
]
const sectorFields: IndicatorField[] = [
  f('id', 'Row id', 'string'), f('company_id', 'Company id', 'string'), f('name', 'Company', 'string'), f('group_name', 'Group', 'string'),
  f('sector', 'Sector tag', 'string'), f('sector_family', 'Sector family', 'string'), f('primary', 'Main tag of the company', 'boolean'),
  f('evidence', 'Words in the company description that justify the tag', 'string'),
  lkr('revenue_lkr', 'Revenue, latest year'), f('revenue_growth_pct', 'Revenue growth', 'number', 'measure', { unit: '%', aggregation: 'none' }),
  f('employees', 'Employees', 'integer', 'measure', { aggregation: 'none' }),
  f('operates_abroad', 'Operates abroad', 'boolean'), f('exports', 'Exports', 'boolean'), f('ownership', 'Ownership', 'string'),
  f('listed', 'Listed on the CSE', 'boolean'), f('is_group_head', 'Heads a group', 'boolean'), f('source_url', 'Source', 'string'),
]
const relFields: IndicatorField[] = [
  f('id', 'Row id', 'string'), f('from_id', 'From company id', 'string'), f('from_name', 'From', 'string'),
  f('to_id', 'To company id', 'string'), f('to_name', 'To', 'string'),
  f('type', 'Link (holding, other_group_holding, associate, joint_venture, major_shareholder, member_per_web_sources, …)', 'string'),
  f('direct_pct', 'Direct holding', 'number', 'measure', { unit: '%', aggregation: 'none' }),
  f('reported_by', 'Annual report that states it (CSE symbol)', 'string'), f('source_url', 'Source', 'string'),
]
const segFields: IndicatorField[] = [
  f('id', 'Row id', 'string'), f('company_id', 'Company id', 'string'), f('company_name', 'Company', 'string'), f('cse_symbol', 'CSE symbol', 'string'),
  f('segment', 'Operating segment', 'string'), lkr('revenue_lkr', 'Segment revenue'), lkr('profit_lkr', 'Segment profit'),
  f('isic4', 'ISIC Rev. 4 class', 'string'), f('description', 'What the segment does', 'string'), f('products', 'Products and services', 'string'),
  f('countries', 'Countries', 'string'), f('source_url', 'Source', 'string'),
]

const [companies, sectors, rels, segs] = await Promise.all(['companies.json', 'company_sectors.json', 'relationships.json', 'segments.json'].map(load))
const withId = (rows: Json[], key: (r: Json, i: number) => string) => rows.map((r, i) => ({ id: key(r, i), ...r }))

const tables = [
  parseIndicatorTable({ ...common, dataset_id: 'lk-companies', title: 'Companies',
    grain: 'One row per company: listed companies, the companies their annual reports name, and large unlisted companies.',
    primary_key: ['company_id'], fields: companyFields, rows: typed(companies, companyFields),
    notes: [
      'Filter groups with is_group_head = true; a group\'s companies share its group_id.',
      'revenue_growth_pct compares the latest and prior year printed in the same annual report (listed companies only); it is empty where the report says the years are not comparable (a changed year end, a 15-month period).',
      'To filter by sector use lk-company-sectors (one row per company and tag).',
    ] }),
  parseIndicatorTable({ ...common, dataset_id: 'lk-company-sectors', title: 'Company sectors',
    grain: 'One row per company and sector tag.',
    primary_key: ['id'], fields: sectorFields, rows: typed(withId(sectors, r => `${r.company_id}|${r.sector}`), sectorFields),
    notes: ['A company carries one to four tags; primary = true marks its main one. Count companies with primary = true to avoid counting a company twice.'] }),
  parseIndicatorTable({ ...common, dataset_id: 'lk-company-relationships', title: 'Company ownership and links',
    grain: 'One row per link between two companies, as stated in an annual report or a web source.',
    primary_key: ['id'], fields: relFields, rows: typed(withId(rels, (_, i) => `r${i + 1}`), relFields),
    notes: ['The largest stated holder (type holding) defines the group tree; smaller stakes are other_group_holding. named_in_report links never shape the tree.'] }),
  parseIndicatorTable({ ...common, dataset_id: 'lk-company-segments', title: 'Company operating segments',
    grain: 'One row per operating segment of a listed group, as reported in its segment note.',
    primary_key: ['id'], fields: segFields, rows: typed(withId(segs, (r, i) => `${r.company_id}|${i + 1}`), segFields),
    notes: ['Segment revenue is external revenue in LKR where the report gives it.'] }),
]

for (const s of sectors) if (!COMPANY_SECTOR_BY_TAG.has(s.sector)) throw new Error(`unknown sector tag: ${s.sector}`)
// Self-checks: ids unique, every group id is a head, every company row has a source.
const ids = new Set(companies.map(c => c.company_id))
if (ids.size !== companies.length) throw new Error('duplicate company_id')
const heads = new Set(companies.filter(c => c.is_group_head === true || c.is_group_head === 'True').map(c => c.company_id))
for (const c of companies) if (!heads.has(c.group_id)) throw new Error(`group_id is not a head: ${c.company_id}`)
for (const t of tables) for (const r of t.rows) if ('source_url' in r && !r.source_url && r.data_origin !== 'named_as_holder') throw new Error(`no source: ${t.dataset_id} ${JSON.stringify(r).slice(0, 120)}`)

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
console.log(`companies: ${companies.length} companies (${heads.size} groups), ${sectors.length} sector tags, ${rels.length} links, ${segs.length} segments${check ? '' : `; wrote ${stale} file(s)`}`)
