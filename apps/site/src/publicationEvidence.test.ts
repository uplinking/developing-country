import { describe, expect, test } from 'bun:test'
import { PUBLICATION_CONTRACT, viewUrlsInContent } from '@developing-country/emdash-blocks'
import { publicationIssues } from './publicationEvidence'

const checksum = `sha256:${'a'.repeat(64)}`
const viewUrl = 'https://explore.developing-country.org/views/view_0123abcd'

interface TestArticle {
  format: 'analysis' | 'dataset_note'
  dataset_id?: string
  dataset_preview_url?: string
  country_code: string
  research_question: string
  methodology: string
  evidence_bundle: {
    version: number
    kind: string
    country: string
    generatedAt: string
    datasetVersions: Array<Record<string, unknown>>
    dataViews: Array<Record<string, unknown>>
  }
  source_manifest: Array<{ sourceId?: string; title: string; url?: string; type?: string }>
  primary_view_url?: string
  content: Array<Record<string, unknown>>
}

function article(): TestArticle {
  return {
    format: 'analysis',
    country_code: 'LK',
    research_question: 'Which communities are outside reliable transit access?',
    methodology: 'We ran a bounded platform gap query and reviewed the cited source coverage.',
    evidence_bundle: {
      version: 1,
      kind: 'platform-query',
      country: 'LK',
      generatedAt: '2026-08-26T00:00:00.000Z',
      datasetVersions: [{
        datasetId: 'demographics', versionId: `dsv_${'b'.repeat(32)}`, country: 'LK',
        sourceIds: ['lk-census-2024'], vintage: '2024', refreshedAt: '2026-08-20', checksum,
      }],
      dataViews: [{ viewUrl, queryId: 'query_abc123', resultChecksum: checksum }],
    },
    source_manifest: [{
      sourceId: 'lk-census-2024', title: 'Sri Lanka Census 2024', url: 'https://statistics.gov.lk/',
    }],
    primary_view_url: viewUrl,
    content: [{ _type: 'block', children: [{ _type: 'span', text: 'Evidence-led finding.' }] }],
  }
}

describe('Research Article publication evidence', () => {
  test('keeps the MCP contract example valid', () => {
    expect(publicationIssues(PUBLICATION_CONTRACT.exampleDesignNote)).toEqual([])
  })

  test('accepts a complete platform-query evidence contract', () => {
    expect(publicationIssues(article())).toEqual([])
  })

  test('requires every data note to identify its dataset', () => {
    const value = article()
    value.format = 'dataset_note'
    expect(publicationIssues(value).map((issue) => issue.path)).toContain('dataset_id')
    value.dataset_id = 'demographics'
    value.dataset_preview_url = 'https://explore.developing-country.org/?embed=dataset&pop=gnd&lng=80.72&lat=7.85&zoom=6.8'
    expect(publicationIssues(value)).toEqual([])
  })

  test('requires the registered preview URL for visual dataset notes', () => {
    const value = article()
    value.format = 'dataset_note'
    value.dataset_id = 'demographics'
    expect(publicationIssues(value).map((issue) => issue.path)).toContain('dataset_preview_url')
    value.dataset_preview_url = 'https://explore.developing-country.org/?embed=dataset&layers=metro&lng=79.88&lat=6.92&zoom=11.2'
    expect(publicationIssues(value).map((issue) => issue.path)).toContain('dataset_preview_url')
  })

  test('accepts only the registered chart preset URL for indicator dataset notes', () => {
    const value = article()
    value.format = 'dataset_note'
    value.dataset_id = 'labour-force'
    value.dataset_preview_url =
      'https://explore.developing-country.org/datasets/labour-force/unemployment?embed=dataset'
    value.evidence_bundle.datasetVersions[0]!.datasetId = 'labour-force'
    expect(publicationIssues(value)).toEqual([])

    value.dataset_preview_url =
      'https://explore.developing-country.org/datasets/labour-force/unemployment'
    expect(publicationIssues(value).map((issue) => issue.path)).toContain('dataset_preview_url')
  })

  test('accepts the registered land-cover map with matching Dataset Version evidence', () => {
    const value = article()
    value.format = 'dataset_note'
    value.dataset_id = 'land-cover-grid'
    value.dataset_preview_url =
      'https://explore.developing-country.org/?embed=dataset&layers=land-cover-grid&lng=80.72&lat=7.85&zoom=6.8'
    value.evidence_bundle.datasetVersions[0]!.datasetId = 'land-cover-grid'
    expect(publicationIssues(value)).toEqual([])
  })

  test('requires a dataset note to cite the version of the dataset it previews', () => {
    const value = article()
    value.format = 'dataset_note'
    value.dataset_id = 'labour-force'
    value.dataset_preview_url =
      'https://explore.developing-country.org/datasets/labour-force/unemployment?embed=dataset'
    expect(publicationIssues(value)).toContainEqual({
      path: 'evidence_bundle.datasetVersions',
      message: 'must include the Dataset Version for labour-force',
    })
  })

  test('allows a source-backed design note without Dataset Versions', () => {
    const value = article()
    value.evidence_bundle = {
      version: 1, kind: 'design-note', country: 'LK', generatedAt: '2026-08-26T00:00:00.000Z',
      datasetVersions: [], dataViews: [],
    }
    value.source_manifest = [{ title: 'developing-country data contract', type: 'platform-design' }]
    delete value.primary_view_url
    expect(publicationIssues(value)).toEqual([])
  })

  test('requires every Dataset Version source to be auditable', () => {
    const value = article()
    value.source_manifest = [{ title: 'Unrelated source', url: 'https://example.com/' }]
    expect(publicationIssues(value).map((issue) => issue.message)).toContain(
      'source lk-census-2024 is missing from source_manifest',
    )
  })

  test('does not let empirical evidence masquerade as a URL-less design source', () => {
    const value = article()
    value.source_manifest = [{
      sourceId: 'lk-census-2024', title: 'Unverifiable census reference', type: 'platform-design',
    }]
    expect(publicationIssues(value).map((issue) => issue.message)).toContain(
      'source lk-census-2024 must have an HTTPS URL',
    )
  })

  test('rejects malformed, padded, or credentialed Source URLs', () => {
    for (const url of ['https:// ', 'https://.', 'https://@', ' https://statistics.gov.lk/', 'https://user:secret@statistics.gov.lk/', 'https://statistics.gov.lk/@private']) {
      const value = article()
      value.source_manifest[0]!.url = url
      expect(publicationIssues(value).map((issue) => issue.path)).toContain('source_manifest[0].url')
    }
  })

  test('requires canonical raw identifiers instead of silently trimming them', () => {
    const mutations: Array<(value: TestArticle) => void> = [
      (value) => { value.source_manifest[0]!.sourceId = ' lk-census-2024' },
      (value) => { value.evidence_bundle.datasetVersions[0]!.datasetId = 'demographics ' },
      (value) => { value.evidence_bundle.datasetVersions[0]!.versionId = ` dsv_${'b'.repeat(32)}` },
      (value) => { value.evidence_bundle.datasetVersions[0]!.checksum = `${checksum} ` },
      (value) => { value.evidence_bundle.datasetVersions[0]!.sourceIds = ['lk-census-2024 '] },
      (value) => { value.evidence_bundle.dataViews[0]!.viewUrl = ` ${viewUrl}` },
      (value) => { value.evidence_bundle.dataViews[0]!.queryId = 'query_abc123 ' },
      (value) => { value.evidence_bundle.dataViews[0]!.resultChecksum = ` ${checksum}` },
      (value) => { value.primary_view_url = `${viewUrl} ` },
    ]
    for (const mutate of mutations) {
      const value = article()
      mutate(value)
      expect(publicationIssues(value).length).toBeGreaterThan(0)
    }
  })

  test('validates real timestamps and source-precision calendar dates', () => {
    for (const generatedAt of [
      '2026-02-30T00:00:00.000Z',
      '2026-08-26T24:00:00.000Z',
      '2026-08-26T00:00:00.12Z',
    ]) {
      const value = article()
      value.evidence_bundle.generatedAt = generatedAt
      expect(publicationIssues(value).map((issue) => issue.path)).toContain('evidence_bundle.generatedAt')
    }

    for (const refreshedAt of ['0000', '2026-00', '2026-13', '2026-02-30', '2025-02-29', '2026-02-30T00:00:00.000Z']) {
      const value = article()
      value.evidence_bundle.datasetVersions[0]!.refreshedAt = refreshedAt
      expect(publicationIssues(value).map((issue) => issue.path))
        .toContain('evidence_bundle.datasetVersions[0].refreshedAt')
    }
    for (const refreshedAt of ['2000', '2026-08', '2024-02-29', '2026-08-20T00:00:00.000Z']) {
      const value = article()
      value.evidence_bundle.datasetVersions[0]!.refreshedAt = refreshedAt
      expect(publicationIssues(value)).toEqual([])
    }
  })

  test('rejects duplicate Dataset Version and Data View identities', () => {
    const duplicateDataset = article()
    duplicateDataset.evidence_bundle.datasetVersions.push({
      ...duplicateDataset.evidence_bundle.datasetVersions[0]!,
      versionId: `dsv_${'c'.repeat(32)}`,
    })
    expect(publicationIssues(duplicateDataset).map((issue) => issue.path))
      .toContain('evidence_bundle.datasetVersions[1].datasetId')

    const duplicateVersion = article()
    duplicateVersion.evidence_bundle.datasetVersions.push({
      ...duplicateVersion.evidence_bundle.datasetVersions[0]!,
      datasetId: 'transport',
    })
    expect(publicationIssues(duplicateVersion).map((issue) => issue.path))
      .toContain('evidence_bundle.datasetVersions[1].versionId')

    const duplicateSource = article()
    duplicateSource.evidence_bundle.datasetVersions[0]!.sourceIds = ['lk-census-2024', 'lk-census-2024']
    expect(publicationIssues(duplicateSource).map((issue) => issue.path))
      .toContain('evidence_bundle.datasetVersions[0].sourceIds')

    const duplicateView = article()
    duplicateView.evidence_bundle.dataViews.push({
      viewUrl,
      queryId: 'query_conflicting',
      resultChecksum: `sha256:${'b'.repeat(64)}`,
    })
    expect(publicationIssues(duplicateView).map((issue) => issue.path))
      .toContain('evidence_bundle.dataViews[1].viewUrl')
  })

  test('uses the same first-present live-view field precedence as D1', () => {
    const value = article()
    value.content.push({ _type: 'dcLiveView', view_url: '', url: viewUrl })
    expect(publicationIssues(value).map((issue) => issue.path)).toContain('content[1].view_url')
  })

  test('requires every published view to belong to the Evidence Bundle', () => {
    const value = article()
    value.evidence_bundle.dataViews = []
    value.content.push({ _type: 'dcLiveView', view_url: viewUrl })
    const paths = publicationIssues(value).map((issue) => issue.path)
    expect(paths).toContain('primary_view_url')
    expect(paths).toContain('content[1].view_url')
  })

  test('validates JSON strings read directly from D1 columns', () => {
    const value = article()
    const fromD1 = {
      ...value,
      evidence_bundle: JSON.stringify(value.evidence_bundle),
      source_manifest: JSON.stringify(value.source_manifest),
      content: JSON.stringify(value.content),
    }
    expect(publicationIssues(fromD1)).toEqual([])
  })

  test('allows views to be reused across blocks and with primary_view_url', () => {
    const value = article()
    value.content.push({ _type: 'dcLiveView', view_url: viewUrl }, { _type: 'dcLiveView', view_url: viewUrl })
    expect(publicationIssues(value)).toEqual([])
  })
})

describe('interactive article blocks (ADR 0009)', () => {
  const second = 'https://explore.developing-country.org/views/view_districtrank'

  function storyArticle() {
    const value = article()
    value.evidence_bundle.dataViews.push({ viewUrl: second, queryId: 'query_rank', resultChecksum: checksum })
    value.content.push(
      { _type: 'dcGuess', guess_id: 'g', question: 'How many?', min: 0, max: 100, view_url: second, field: 'share' },
      { _type: 'dcFigure', view_url: viewUrl, size: 'wide' },
      { _type: 'dcScrolly', steps: [
        { text: 'One', view_url: viewUrl, center_lng: '', center_lat: '', zoom: '' },
        { text: 'Two', view_url: second, highlight: 'Colombo' },
      ] },
      { _type: 'dcStat', view_url: second, label: 'share', field: 'share', guess_id: 'g' },
      { _type: 'dcExplorer', view_url: viewUrl, title_field: 'name', metrics: [{ field: 'share', label: 'Share' }] },
    )
    return value
  }

  test('accepts a story whose every view, including scrolly steps, is evidenced', () => {
    expect(publicationIssues(storyArticle())).toEqual([])
  })

  test('requires every scrolly step view in the Evidence Bundle', () => {
    const value = storyArticle()
    value.evidence_bundle.dataViews = value.evidence_bundle.dataViews.filter((view) => view.viewUrl !== second)
    const paths = publicationIssues(value).map((issue) => issue.path)
    expect(paths).toContain('content[3].steps[1].view_url')
    expect(paths).toContain('content[1].view_url')
    expect(paths).toContain('content[4].view_url')
  })

  test('rejects non-canonical and missing block URLs and incomplete blocks', () => {
    const value = article()
    value.content.push(
      { _type: 'dcFigure', view_url: `${viewUrl}?x=1` },
      { _type: 'dcScrolly', steps: [] },
      { _type: 'dcScrolly', steps: [{ text: 'x' }] },
      { _type: 'dcGuess', guess_id: 'g', question: 'q', min: 5, max: 5, view_url: viewUrl, field: 'v' },
      { _type: 'dcStat', view_url: viewUrl, field: 'v' },
      { _type: 'dcExplorer', view_url: viewUrl, title_field: 'name', metrics: [] },
    )
    const paths = publicationIssues(value).map((issue) => issue.path)
    expect(paths).toEqual(expect.arrayContaining([
      'content[1].view_url', 'content[2].steps', 'content[3].steps[0].view_url', 'content[4].max', 'content[5].label', 'content[6].metrics',
    ]))
  })

  test('keeps the contract block examples publishable', () => {
    const value = article()
    const blocks = PUBLICATION_CONTRACT.interactiveBlocks
    const examples = [blocks.dcFigure.example, blocks.dcScrolly.example, blocks.dcStat.example, blocks.dcGuess.example, blocks.dcExplorer.example]
    const urls = new Set<string>(viewUrlsInContent(examples))
    value.evidence_bundle.dataViews = [...urls].map((url, index) => ({ viewUrl: url, queryId: `query_${index}`, resultChecksum: checksum }))
    value.primary_view_url = [...urls][0]
    value.content.push(...examples.map((example) => JSON.parse(JSON.stringify(example)) as Record<string, unknown>))
    expect(publicationIssues(value)).toEqual([])
  })

  test('requires every underlay, on figures and scrolly steps, in the Evidence Bundle', () => {
    const value = storyArticle()
    value.content.push(
      { _type: 'dcFigure', view_url: viewUrl, underlay_urls: `${second}, ${viewUrl}` },
      { _type: 'dcScrolly', steps: [{ text: 'a', view_url: second, underlay_urls: viewUrl }] },
    )
    expect(publicationIssues(value)).toEqual([])
    const unevidenced = 'https://explore.developing-country.org/views/view_outlines'
    value.content.push(
      { _type: 'dcFigure', view_url: viewUrl, underlay_urls: unevidenced },
      { _type: 'dcScrolly', steps: [{ text: 'a', view_url: viewUrl, underlay_urls: `${second},https://evil.example/views/view_x` }] },
      { _type: 'dcFigure', view_url: '', underlay_urls: second },
    )
    const paths = publicationIssues(value).map((issue) => issue.path)
    expect(paths).toEqual(expect.arrayContaining(['content[8].underlay_urls', 'content[9].steps[0].underlay_urls', 'content[10].view_url']))
  })
})
