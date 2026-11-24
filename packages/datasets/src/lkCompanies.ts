import type { IndicatorDatasetDefinition } from './presets'

const VINTAGE = 'Annual reports for years ending Mar 2025 to Mar 2026; web research Nov 2026'
const SOURCE_IDS = ['lk-company-map']

export const LK_COMPANY_DATASETS: IndicatorDatasetDefinition[] = [
  {
    id: 'lk-companies',
    title: 'Companies',
    label: 'Companies',
    themeIds: ['ECON', 'INTR'],
    sourceIds: SOURCE_IDS,
    vintage: VINTAGE,
    description: 'Sri Lankan companies and the groups they belong to: what each does, its sector, revenue and growth, profit, employees, ownership, and whether it exports or operates abroad.',
    note: {
      dek: 'See who owns what in Sri Lankan business, what each company does and how fast it is growing.',
      question: 'Which companies work in a sector, how big are they, are they growing, and which group owns them?',
      contains: 'Every company with ordinary shares on the Colombo Stock Exchange and the subsidiaries, associates and joint ventures its 2025/26 annual report names, plus about 850 large unlisted companies (state enterprises, banks, exporters, family groups, multinationals) found by web research. Two years of revenue, profit and employees for listed companies.',
      use: 'Filter groups with is_group_head = true, or a group\'s companies by group_id. Filter by revenue_growth_pct, employees, operates_abroad, exports, foreign_owned or ownership. For sectors (solar, tea, gloves, fintech, …) use lk-company-sectors.',
      limit: 'Not a census: small and medium private companies are missing, and unlisted companies rarely publish revenue. Growth is available for listed companies only. A group head\'s revenue already includes its subsidiaries.',
    },
    presets: [{
      id: 'largest-groups',
      title: 'Largest groups by revenue',
      description: 'Consolidated revenue of group heads, latest financial year, in LKR.',
      query: {
        fields: ['name', 'revenue_lkr'],
        where: [{ field: 'is_group_head', op: 'eq', value: true }, { field: 'revenue_lkr', op: 'gte', value: 1 }],
        order_by: [{ field: 'revenue_lkr', direction: 'desc' }],
        limit: 25,
      },
      chart: { family: 'ranking', dimension: { field: 'name', label: 'Group' }, measure: { field: 'revenue_lkr', label: 'Revenue', unit: 'LKR' }, orientation: 'horizontal' },
    }],
  },
  {
    id: 'lk-company-sectors',
    title: 'Company sectors',
    label: 'Company sectors',
    themeIds: ['ECON', 'INTR'],
    sourceIds: SOURCE_IDS,
    vintage: VINTAGE,
    description: 'Each company\'s sectors, one row per company and sector tag (solar, hydro, tea, apparel, gloves, banking, fintech, hotels and 70 more), with revenue, growth, employees and export flags repeated for filtering.',
    note: {
      dek: 'Find every company in a sector, from solar to gloves.',
      question: 'Which companies work in a sector, and which of them are large, growing or exporting?',
      contains: 'One to four sector tags per company from a fixed list of 81, grouped into 16 families. Each tag cites the words in the company\'s own description that justify it.',
      use: 'Filter by sector or sector_family, then by revenue_growth_pct, employees, exports or operates_abroad. Use primary = true to count each company once.',
      limit: 'Companies with no description (about one in six) carry no tag. Tags describe what a company does, not its revenue split.',
    },
    presets: [{
      id: 'companies-by-sector-family',
      title: 'Companies by sector',
      description: 'Companies counted once, by the family of their main sector tag.',
      query: { fields: ['sector_family', 'company_id'], where: [{ field: 'primary', op: 'eq', value: true }], limit: 200 },
      chart: { family: 'ranking', dimension: { field: 'sector_family', label: 'Sector' }, measure: { field: 'company_id', label: 'Companies', unit: 'companies' }, orientation: 'horizontal' },
    }],
  },
  {
    id: 'lk-company-relationships',
    title: 'Company ownership and links',
    label: 'Company ownership',
    themeIds: ['ECON', 'INTR'],
    sourceIds: SOURCE_IDS,
    vintage: VINTAGE,
    description: 'Who holds whom among Sri Lankan companies: one row per holding, associate, joint venture or major shareholding, with the percentage and the annual report page that states it.',
    note: {
      dek: 'Trace each group\'s ownership tree, stake by stake.',
      question: 'Who owns a company, what does a group hold, and which companies are linked to foreign partners?',
      contains: 'Holdings, associates, joint ventures and major shareholdings stated in the annual reports of listed companies, and parent links named by web sources for unlisted companies.',
      use: 'Filter by from_id to list what a company holds, or by to_id to see who holds it. type = holding is the link that defines the group tree.',
      limit: 'Stakes are as printed in the latest annual report. Links for unlisted companies (member_per_web_sources) rarely carry a percentage.',
    },
    presets: [{
      id: 'largest-holdings',
      title: 'Majority holdings',
      description: 'Direct holdings of more than half a company, as stated in annual reports.',
      query: {
        fields: ['to_name', 'direct_pct'],
        where: [{ field: 'type', op: 'eq', value: 'holding' }, { field: 'direct_pct', op: 'gte', value: 50 }],
        order_by: [{ field: 'direct_pct', direction: 'desc' }],
        limit: 50,
      },
      chart: { family: 'ranking', dimension: { field: 'to_name', label: 'Company held' }, measure: { field: 'direct_pct', label: 'Direct holding', unit: '%' }, orientation: 'horizontal' },
    }],
  },
  {
    id: 'lk-company-segments',
    title: 'Company operating segments',
    label: 'Company segments',
    themeIds: ['ECON', 'INTR'],
    sourceIds: SOURCE_IDS,
    vintage: VINTAGE,
    description: 'The operating segments of listed Sri Lankan groups, with each segment\'s revenue, profit, products and countries, as reported in the segment note of the annual report.',
    note: {
      dek: 'See what each listed group actually earns its money from.',
      question: 'Which businesses inside a group bring in its revenue and profit?',
      contains: 'Operating segments from the segment note of each listed company\'s 2025/26 annual report, with a short description from the segment review.',
      use: 'Filter by company_id or cse_symbol to read one group\'s segments; sort by revenue_lkr.',
      limit: 'Segments are defined by each company and are not comparable across groups. Some reports give no segment revenue.',
    },
    presets: [{
      id: 'largest-segments',
      title: 'Largest operating segments',
      description: 'Segment revenue in LKR, latest financial year.',
      query: { fields: ['segment', 'revenue_lkr'], where: [{ field: 'revenue_lkr', op: 'gte', value: 1 }], order_by: [{ field: 'revenue_lkr', direction: 'desc' }], limit: 25 },
      chart: { family: 'ranking', dimension: { field: 'segment', label: 'Segment' }, measure: { field: 'revenue_lkr', label: 'Revenue', unit: 'LKR' }, orientation: 'horizontal' },
    }],
  },
]
