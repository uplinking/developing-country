const checksum = `sha256:${'0'.repeat(64)}`
const VIEW_EXAMPLE = 'https://explore.developing-country.org/views/view_'

/**
 * Agent-readable authoring contract exposed through the CMS MCP server.
 * Keep the example executable: the site validator imports and tests it.
 */
export const PUBLICATION_CONTRACT = {
  version: 1,
  collection: 'articles',
  authority: 'Contributor agents may submit new drafts. The human editorial desk owns revisions and publication.',
  workflow: [
    'Call this tool before drafting an article.',
    'Create one articles draft with the required fields below; Contributors cannot revise it after submission.',
    'Leave status as draft and include editorial_notes for the reviewing editor.',
    'For a data story, save every map or chart first as a Data View (query_data with a view), then compose the body from the interactive blocks in interactiveBlocks below.',
    'List every Data View URL the body uses (dcLiveView, dcFigure and its underlay_urls, every dcScrolly step and its underlay_urls, dcStat, dcGuess, dcExplorer) in evidence_bundle.dataViews with its queryId and resultChecksum.',
    'Never type a number that a dcStat or dcGuess can bind from a view; numbers in prose must match the bound values.',
    'The database rejects every incomplete transition to published, regardless of client.',
  ],
  requiredArticleFields: {
    format: 'analysis for an argued essay; dataset_note for documentation of one platform dataset.',
    analysis_kind: 'essay or tracked_claim; tracked claims live in Analysis and link to the original report.',
    missing_data: 'For tracked claims: JSON array of existing data_gaps CMS content IDs. Reuse records shared by claims. Awaiting-data claims need at least one.',
    claim_source_url: 'For tracked claims: original report HTTPS URL, also present in source_manifest. Include claim_source_title and claim_reported_at (UTC timestamp).',
    claim_status: 'awaiting_data, supported, contradicted or mixed. A source-only claim-review may only use awaiting_data.',
    dataset_id: 'Required for dataset_note; exact platform Dataset ID. Omit for analysis.',
    country_code: 'Registered ISO alpha-2 code; currently LK.',
    research_question: 'A specific question of at least 12 characters.',
    methodology: 'How evidence was selected and analysed; at least 20 characters.',
    evidence_bundle: 'JSON object following evidenceBundle below.',
    source_manifest: 'Non-empty JSON array following sourceManifest below.',
    content: 'Non-empty Portable Text array. dcLiveView blocks must use view_url. Interactive blocks (dcFigure, dcScrolly, dcStat, dcGuess, dcExplorer) follow interactiveBlocks; every view_url they carry, including each dcScrolly step and every underlay_urls entry, must appear in evidence_bundle.dataViews.',
  },
  formats: {
    analysis: 'An argued essay about a public question. Evidence supports the argument.',
    dataset_note: 'A short factual note explaining one dataset, its use, sources, freshness, and limits.',
  },
  evidenceBundle: {
    version: 1,
    kinds: {
      'platform-query': 'Empirical article; requires at least one immutable Dataset Version.',
      'claim-review': 'Tracks an external report and missing evidence, not an independently verified result. Only for analysis_kind tracked_claim with claim_status awaiting_data. May have no Dataset Versions.',
      'design-note': 'Platform or methodology note; may use an empty datasetVersions array.',
    },
    requiredFields: ['version', 'kind', 'country', 'generatedAt', 'datasetVersions', 'dataViews'],
    datasetVersion: {
      requiredFields: ['datasetId', 'versionId', 'country', 'checksum', 'vintage', 'refreshedAt', 'sourceIds'],
      versionId: 'dsv_ followed by 32 lowercase hexadecimal characters.',
      checksum: 'sha256: followed by 64 lowercase hexadecimal characters.',
      sourceIds: 'Non-empty array; every ID must occur in source_manifest.',
    },
    dataView: {
      requiredFields: ['viewUrl', 'queryId', 'resultChecksum'],
      viewUrl: 'Canonical https://explore.developing-country.org/views/view_* URL without query or fragment.',
      rule: 'Every primary_view_url and every view_url in the body (dcLiveView, dcFigure, each dcScrolly step, dcStat, dcGuess, dcExplorer), plus every underlay_urls entry on dcFigure and dcScrolly steps, must occur here. Views may be reused: several blocks (and primary_view_url) may cite the same view, but each view appears once in dataViews.',
    },
  },
  interactiveBlocks: {
    rule: 'Blocks store canonical Data View URLs and intent only, never rows, numbers, geometry or chart configuration. Renderers fetch the view at read time; a non-canonical URL renders an explicit unavailable notice.',
    dcFigure: {
      purpose: 'One inline map or chart. size: inline (text column), wide (breaks out) or full (edge to edge). underlay_urls (optional, map views only): comma-separated view URLs drawn beneath view_url in the same map, lowest first; the main view keeps the camera, tooltips, highlight and annotations.',
      example: { _type: 'dcFigure', view_url: `${VIEW_EXAMPLE}gndcoverage`, underlay_urls: `${VIEW_EXAMPLE}gnddensity`, title: 'Who lives within ten minutes of a metro stop', caption: 'Coverage falls away sharply beyond the Fort–Maradana spine.', size: 'wide' },
    },
    dcScrolly: {
      purpose: 'Sticky figure with steps. Each step names its view and may override the camera (center_lng, center_lat, zoom), show only some layer ids (comma-separated), highlight row ids (comma-separated) and draw other map views beneath it (underlay_urls). Consecutive map steps reuse one map and cross-fade; underlays shared by consecutive steps stay put.',
      example: {
        _type: 'dcScrolly',
        title: 'Walking to the metro',
        steps: [
          { text: 'Start with the whole network.', view_url: `${VIEW_EXAMPLE}gndcoverage` },
          { text: 'Zoom into Colombo 1–3.\n\nThe darkest divisions are within ten minutes.', view_url: `${VIEW_EXAMPLE}gndcoverage`, center_lng: 79.85, center_lat: 6.92, zoom: 12.5, highlight: 'LK-1103005,LK-1103010' },
          { text: 'Where the gaps cluster, over population density.', view_url: `${VIEW_EXAMPLE}gapclusters`, underlay_urls: `${VIEW_EXAMPLE}gnddensity` },
          { text: 'Ranked by district.', view_url: `${VIEW_EXAMPLE}districtrank`, highlight: 'Colombo' },
        ],
      },
    },
    dcStat: {
      purpose: 'A number bound to a view: field, optional where_field/where_value row filter, aggregate (first, sum, mean, min, max, count) and scale. format: number, compact or percent. guess_id compares it with a dcGuess.',
      example: { _type: 'dcStat', view_url: `${VIEW_EXAMPLE}districtrank`, label: 'of Colombo district residents live within ten minutes of a stop', field: 'share', where_field: 'district', where_value: 'Colombo', aggregate: 'first', scale: 100, format: 'percent', guess_id: 'metro-share' },
    },
    dcGuess: {
      purpose: 'Reader guesses on a slider (min, max, step) before the bound answer is revealed. Same binding fields as dcStat. guess_id must be unique within the article.',
      example: { _type: 'dcGuess', guess_id: 'metro-share', question: 'What share of Colombo district lives within a ten-minute walk of a metro stop?', min: 0, max: 100, step: 1, format: 'percent', view_url: `${VIEW_EXAMPLE}districtrank`, field: 'share', where_field: 'district', where_value: 'Colombo', scale: 100, reveal_hint: 'We will check after the map.' },
    },
    dcExplorer: {
      purpose: 'Searchable, sortable small multiples, one card per row. metrics: up to six { field, label, unit?, format? }.',
      example: { _type: 'dcExplorer', view_url: `${VIEW_EXAMPLE}gndcoverage`, title: 'Find your GN division', title_field: 'name', subtitle_field: 'district', search_fields: 'name,district', metrics: [{ field: 'share', label: 'Within 10 min', format: 'percent' }, { field: 'pop', label: 'Residents', format: 'compact' }], sort_field: 'share', sort_dir: 'desc' },
    },
  },
  sourceManifest: {
    requiredFields: ['title'],
    empiricalSourceFields: ['sourceId', 'title', 'url'],
    url: 'Canonical credential-free HTTPS URL. A design note may omit it only when type is platform-design.',
  },
  exampleDesignNote: {
    format: 'analysis',
    country_code: 'LK',
    research_question: 'What evidence should remain attached to a public-data claim?',
    methodology: 'A platform design review of the versioning, provenance, and completeness contracts.',
    evidence_bundle: {
      version: 1,
      kind: 'design-note',
      country: 'LK',
      generatedAt: '2026-08-26T00:00:00.000Z',
      datasetVersions: [],
      dataViews: [],
    },
    source_manifest: [{ title: 'developing-country.org data contract', type: 'platform-design' }],
    content: [{ _type: 'block', children: [{ _type: 'span', text: 'Evidence travels with the claim.' }] }],
  },
  checksumExample: checksum,
} as const
