import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { indicatorDataset } from '@developing-country/datasets'
import { datasetExploreUrl, datasetNotes } from '../src/lib/datasets'

interface DatasetVersion {
  checksum: string
  country: string
  datasetId: string
  refreshedAt: string
  rowCount?: number
  sourceIds: string[]
  versionId: string
  vintage: string
}

interface SourceRecord {
  id: string
  name: string
  url: string
  licence?: string
  licence_status?: string
}

interface NoteCopy {
  dek: string
  question: string
  contains: string
  use: string
  limit: string
}

const copy: Record<string, NoteCopy> = {
  attractions: {
    dek: '1,129 named attractions from OpenStreetMap, gathered into one national layer.',
    question: 'Which visitor attractions have been mapped across Sri Lanka?',
    contains: 'This layer brings together 1,129 named places tagged as visitor attractions on OpenStreetMap. It includes cultural sites, landmarks and other places people have chosen to map for visitors.',
    use: 'Open the live map to see where those places cluster and where the map becomes thin. It can be combined with roads, population and other layers in the explorer.',
    limit: 'OpenStreetMap is built by contributors, so coverage varies from place to place. A blank area does not mean there is nothing to visit, and a mapped point does not tell us about quality, opening hours or accessibility.',
  },
  'boi-zones': {
    dek: 'The 15 investment zones listed by Sri Lanka’s Board of Investment.',
    question: 'Where are Sri Lanka’s Board of Investment zones located?',
    contains: 'This layer contains the 15 investment zones listed by the Board of Investment. It gives each zone a consistent location so it can be read alongside transport, population and other public infrastructure.',
    use: 'The live map shows where the zones sit in relation to cities and transport.',
    limit: 'The layer shows designated zones, not how much land is occupied, how many firms are active or how many people work there. Those measures require separate records that are not yet part of the platform.',
  },
  cycling: {
    dek: 'Two cycling-route features mapped in OpenStreetMap.',
    question: 'What cycling routes are currently mapped in Sri Lanka?',
    contains: 'This national layer currently contains two route features tagged for cycling on OpenStreetMap. It records what is mapped, rather than presenting a complete inventory of safe cycling infrastructure.',
    use: 'Compare the mapped cycling routes with roads, population and destinations.',
    limit: 'Two mapped routes are not evidence that Sri Lanka has only two cycle routes. Informal paths, painted lanes and local projects may be absent, and the layer does not measure safety or physical separation from traffic.',
  },
  demographics: {
    dek: 'Administrative boundaries and population figures from the 2012 and 2024 censuses.',
    question: 'How is Sri Lanka’s population distributed across its administrative areas?',
    contains: 'The demographic layer connects census population tables to provinces, districts, divisional secretariats and Grama Niladhari divisions. The platform holds 2012 and 2024 material so changes can be examined without hiding the census year.',
    use: 'Use the explorer to shade administrative areas by population and combine them with services or infrastructure. Every view should keep the census vintage attached.',
    limit: 'The 2024 Grama Niladhari join currently matches 97.43 per cent of identifiers, below the platform’s 98 per cent target. The published map tiles still use 2012 values while that join is resolved, so the interface must not present every small-area value as 2024 data.',
  },
  developments: {
    dek: '36 announced development projects from public plans and announcements.',
    question: 'What major development projects have been announced in Sri Lanka, and what is known about their progress?',
    contains: 'This layer assembles 36 projects from public plans and announcements across transport, ports, energy, investment and urban development. Records can include a location, responsible body, expected cost, dates and the latest reported status.',
    use: 'The map lets a reader inspect the projects geographically and open their available details. Over time, the layer can help compare what was announced with what was funded, built, delayed or abandoned.',
    limit: 'A public announcement is not proof that construction began or finished. Updates are uneven and a project may look active when no later public record has been found.',
  },
  expressways: {
    dek: '626 expressway road segments from OpenStreetMap, read alongside the Road Development Authority’s programme.',
    question: 'Where does Sri Lanka’s expressway network run, and which extensions have been publicly described?',
    contains: 'The geometry contains 626 road segments tagged as part of the expressway network on OpenStreetMap. Road Development Authority material provides the public programme context used elsewhere in the platform.',
    use: 'The live map shows the network as connected road geometry and allows it to be compared with cities, population and development projects.',
    limit: 'Segment counts are a property of the map data, not a count of separate expressways. Construction and opening status can change faster than the source material, so proposed or incomplete sections need a recent official check before being described as operational.',
  },
  hospitals: {
    dek: '1,045 hospitals and clinics mapped by OpenStreetMap contributors—not an official health-service register.',
    question: 'Where have hospitals and clinics been mapped in Sri Lanka?',
    contains: 'This layer contains 1,045 named healthcare places mapped in OpenStreetMap, including hospitals and clinics. It provides usable locations for broad access questions when no official national facility map has been ingested.',
    use: 'The points can be viewed on their own or alongside population, roads and transport. That makes the layer useful for forming questions about geographic access, not for making claims about service capacity.',
    limit: 'This is not the Ministry of Health facility register. Places may be missing, duplicated, closed or classified inconsistently, and the layer does not tell us about beds, staff, services, cost or opening hours.',
  },
  'irrigation-gauges': {
    dek: 'Forty Irrigation Department hydrology stations, each with published alert, minor-flood and major-flood levels.',
    question: 'Where are Sri Lanka’s published river-gauge stations, and what flood thresholds are attached to them?',
    contains: 'This layer plots 40 hydrology stations compiled from Irrigation Department material. Each point keeps the station name, river, district identifier and the published alert, minor-flood and major-flood levels in metres.',
    use: 'Open the live map to see the stations along the main rivers. Click a station for the published thresholds. Combine it with water bodies or population, not as a substitute for a flood map.',
    limit: 'This is a static station list, not a live flood bulletin and not a flood-hazard zonation map. Live water levels are not included. The department describes 42 permanent gauges; two are not in this compilation. A published 0 m threshold may mean that station has no flood-warning levels in the source.',
  },
  metro: {
    dek: 'Seven Colombo Metro Bus lines and 110 stops from a community survey.',
    question: 'What routes and stops make up the community-mapped Colombo Metro Bus network?',
    contains: 'This dataset comes from the community-maintained lk_metro project and describes seven Metro Bus lines with 110 surveyed stops in and around Colombo. The stored records also include the route features needed to draw the network.',
    use: 'The explorer shows the lines and stops together. It can also combine them with walking catchments to ask what is reachable from each stop rather than treating the route line as access by itself.',
    limit: 'This is a community survey, not a current National Transport Commission feed. Routes, stop names and service patterns can change, and the layer does not contain live arrivals, frequency, reliability or ridership.',
  },
  metro_catchment: {
    dek: '67,080 walking-access calculations around Colombo Metro Bus stops, based on the mapped street network.',
    question: 'Which streets and places can be reached on foot from Colombo Metro Bus stops?',
    contains: 'This dataset stores 67,080 reachability records calculated from Metro Bus stops over the Colombo walking network. It models walking along connected streets and paths instead of drawing simple circles around each stop.',
    use: 'Compare the walking network reachable from bus stops with nearby places and transport routes.',
    limit: 'The result is only as complete as the OpenStreetMap walking network. Missing footpaths or crossings can shorten a catchment, while a mapped connection may still be unsafe, obstructed or inaccessible. Walking time is modelled, not observed.',
  },
  workplaces: {
    dek: '4,057 office listings around the Colombo Metro Bus lines from Overture Maps, grouped as government, corporate, financial, professional and other offices.',
    question: 'Where are the offices around the Colombo Metro Bus lines?',
    contains: 'This layer keeps the Overture Maps Places listings for corporate and business offices, government offices, banks and financial services, and professional, real-estate, media, design and logistics services in the Colombo study area. Listings with confidence below 0.5 or marked closed are dropped.',
    use: 'Open the live map to see where offices cluster along the Metro Bus corridors. The metro coverage tables count how many are within a 5- or 10-minute walk of a stop.',
    limit: 'These are business listings, not jobs: they carry no headcount or floor area. Overture combines several listing sources, so coverage is uneven, some offices are missing and some may be duplicated or out of date.',
  },
  metro_walksheds: {
    dek: 'The areas within a 5- and 10-minute walk of Colombo Metro Bus stops, compared with the 800 m circles usually drawn around them.',
    question: 'How much of Colombo can actually walk to a Metro Bus stop?',
    contains: 'This layer stores 354 areas: for each of the 110 stops, each of the seven lines and the whole network, the area within a 5- and 10-minute walk along the mapped streets and paths, and the 800 m straight-line circle. Each area carries its estimated residents, schools and hospitals.',
    use: 'Compare the walking areas with the circles to see where rivers, rail lines and missing street links cut people off. About 510,000 residents live within a 10-minute walk of a stop, against 898,000 inside the circles.',
    limit: 'Residents are estimated by spreading each GN division’s Census 2024 population evenly over its area, and daytime workers and students are not counted. Walks follow OpenStreetMap streets and paths at 80 m a minute, ignore slope, crossings and footpath quality, and start from stop locations compiled by lk_metro.',
  },
  osm_foot_graph: {
    dek: 'The OpenStreetMap-derived walking network used to calculate access around Colombo.',
    question: 'What street and path network supports the platform’s Colombo walking calculations?',
    contains: 'This is the routing graph behind the Colombo walking-access analysis. It turns connected streets and footpaths from OpenStreetMap into a network that the platform can traverse from a stop or other starting point.',
    use: 'The graph is an input to walking catchments rather than a finished public indicator. Its most visible use is in the Metro Bus access layer, where routes are calculated along mapped connections.',
    limit: 'A routing graph cannot see pavement condition, lighting, traffic danger, steps, gates or temporary obstructions unless those details are mapped. Missing connections can materially change a result, so calculated access should not be mistaken for an on-the-ground accessibility audit.',
  },
  parks: {
    dek: '60 named parks mapped in OpenStreetMap.',
    question: 'Where have public parks been mapped in Sri Lanka?',
    contains: 'This layer contains 60 named places tagged as parks on OpenStreetMap. It provides a simple national view that can be compared with population, neighbourhoods and transport.',
    use: 'Compare mapped park locations with population, neighbourhoods and transport.',
    limit: 'The layer is probably incomplete and does not distinguish every kind of green space. It does not measure area consistently, public access, maintenance, facilities, safety or ecological value.',
  },
  'population-change': {
    dek: 'The 25 districts shaded by how much resident population changed between Census 2012 and Census 2024.',
    question: 'Which districts grew fastest between the 2012 and 2024 censuses?',
    contains: 'The explorer paints each district by percent change between Census 2012 counts and Census 2024 Person-Sex totals joined on the same district identifiers. District match is 100 percent. Every district grew.',
    use: 'Open the live map to compare growth across the island. A ranking table of the same 25 districts is published as a separate dataset.',
    limit: 'This is district grain only. Divisional Secretariat and Grama Niladhari comparisons across 2012 and 2024 are misleading where those codes were recoded. The colour scale shows how much each district grew, not growth versus decline. 2012 totals come from the gig-data geometries and differ from Final Report Table 6.1.11 in four districts; 2024 totals match the identity tables.',
  },
  schools: {
    dek: '4,620 schools and other education sites mapped in OpenStreetMap.',
    question: 'Where have schools and other education places been mapped in Sri Lanka?',
    contains: 'This layer brings together 4,620 named schools, colleges, universities and kindergartens mapped in OpenStreetMap. It creates a usable national point layer while an official Ministry of Education GIS is not available on the platform.',
    use: 'Compare mapped education sites with population, transport and walking access.',
    limit: 'An absent point does not prove that an area has no school. The layer is community-mapped and may omit facilities or mix institution types; it does not include enrolment, capacity, staffing, quality or catchment boundaries.',
  },
  'sea-routes': {
    dek: '27 computed paths over a global marine network, used to show plausible connections from Sri Lankan ports.',
    question: 'What plausible marine paths connect selected Sri Lankan and international ports?',
    contains: 'This layer contains 27 routes calculated over the Eurostat marnet marine network using searoute software. It gives the platform consistent path geometry between selected ports.',
    use: 'The routes can be displayed with ports and development projects to put maritime connections in geographic context.',
    limit: 'These are computed shortest paths, not tracks observed from ships. They do not represent traffic volume, schedules, shipping lanes in current use, weather diversions, draught constraints or commercial importance.',
  },
  trails: {
    dek: '24 hiking-route features currently mapped in OpenStreetMap.',
    question: 'What hiking routes are currently mapped in Sri Lanka?',
    contains: 'This layer contains 24 route features tagged for hiking in OpenStreetMap. It provides a small, reproducible starting point for viewing mapped trails across the country.',
    use: 'The live map shows the routes in their geographic setting and can be combined with attractions, terrain-related features and roads.',
    limit: 'Coverage is sparse. A mapped route may be informal, closed, hazardous or incorrectly aligned, while many real trails may be absent. The data is not a safety guide and does not include current conditions or permissions.',
  },
  waterfalls: {
    dek: '137 named waterfalls mapped in OpenStreetMap.',
    question: 'Where have waterfalls been mapped in Sri Lanka?',
    contains: 'This layer contains 137 named waterfalls contributed to OpenStreetMap. It gathers the available locations into one national view and lets them be read alongside trails, roads and other destinations.',
    use: 'The map is useful for exploring geographic patterns and checking how well different areas have been mapped.',
    limit: 'Locations and names are community-supplied and may be incomplete or imprecise. The layer does not describe seasonal flow, access, land ownership, danger or whether a site is suitable for visitors.',
  },
  'land-cover-grid': {
    dek: '2,360 coarse display cells showing the dominant modeled ESA WorldCover 2021 class across Sri Lanka.',
    question: 'What dominant land-cover class does the ESA WorldCover 2021 model assign across Sri Lanka?',
    contains: 'The platform summarizes ESA WorldCover 2021 v200 into an approximately five-kilometre display grid. Each cell keeps the dominant class among deterministic samples, its official class code and a categorical vegetation grouping.',
    use: 'The live map opens the land-cover layer across the island, with the registered class legend and a source-backed readout for each selected cell.',
    limit: 'A dominant coarse-grid class hides smaller and mixed patches. WorldCover reports modeled categorical land cover—not NDVI, live greenness or current vegetation condition—and its global accuracy does not establish the accuracy of every local cell.',
  },
}

const root = resolve(import.meta.dir, '../../..')
const seedPath = resolve(import.meta.dir, '../seed/seed.json')
const versions = (JSON.parse(readFileSync(resolve(root, 'scripts/dataset-versions.json'), 'utf8')) as { versions: DatasetVersion[] }).versions
const sources = (JSON.parse(readFileSync(resolve(root, 'scripts/data-sources.json'), 'utf8')) as { sources: SourceRecord[] }).sources
const versionsById = new Map(versions.map((version) => [version.datasetId, version]))
const sourcesById = new Map(sources.map((source) => [source.id, source]))

function block(datasetId: string, suffix: string, style: 'h2' | 'normal', text: string) {
  return {
    _type: 'block',
    _key: `${datasetId}-${suffix}`,
    style,
    children: [{ _type: 'span', _key: `${datasetId}-${suffix}-span`, text }],
  }
}

function createArticle(dataset: typeof datasetNotes[number]) {
  const note = indicatorDataset(dataset.id)?.note ?? copy[dataset.id]
  const version = versionsById.get(dataset.id)
  if (!note || !version) throw new Error(`Missing note copy or Dataset Version for ${dataset.id}`)
  const sourceManifest = version.sourceIds.map((sourceId) => {
    const source = sourcesById.get(sourceId)
    if (!source) throw new Error(`Missing source ${sourceId} for ${dataset.id}`)
    return {
      sourceId: source.id,
      title: source.name,
      url: source.url,
      licence: source.licence ?? null,
      licenceStatus: source.licence_status ?? 'not_recorded',
    }
  })

  return {
    id: dataset.id,
    slug: dataset.id,
    status: 'published',
    bylines: [{ byline: 'developing-country-editorial' }],
    taxonomies: { topic: ['data-quality'] },
    data: {
      title: dataset.title,
      dek: note.dek,
      format: 'dataset_note',
      dataset_id: dataset.id,
      dataset_preview_url: dataset.preview ? datasetExploreUrl(dataset.id, true) : undefined,
      country_code: 'LK',
      research_question: note.question,
      methodology: 'This note uses the platform’s immutable Dataset Version and cited Source records. Its source, vintage, normalization method and caveats come from the registered artifact without adding unverified claims.',
      evidence_bundle: {
        version: 1,
        kind: 'platform-query',
        country: 'LK',
        datasetVersions: [{
          datasetId: version.datasetId,
          versionId: version.versionId,
          country: version.country,
          checksum: version.checksum,
          vintage: version.vintage,
          refreshedAt: version.refreshedAt,
          sourceIds: version.sourceIds,
        }],
        dataViews: [],
        generatedAt: '2026-08-31T00:00:00.000Z',
      },
      source_manifest: sourceManifest,
      content: [
        block(dataset.id, 'contains-heading', 'h2', 'What this dataset contains'),
        block(dataset.id, 'contains-body', 'normal', note.contains),
        block(dataset.id, 'use-heading', 'h2', 'How it is used here'),
        block(dataset.id, 'use-body', 'normal', note.use),
        block(dataset.id, 'limit-heading', 'h2', 'What it cannot tell you'),
        block(dataset.id, 'limit-body', 'normal', note.limit),
      ],
    },
  }
}

const expected = datasetNotes.map(createArticle)
const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as {
  content: { articles: Array<{ data?: { format?: string } }> }
}

if (process.argv.includes('--check')) {
  const actual = seed.content.articles.filter((article) => article.data?.format === 'dataset_note')
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error('Dataset notes are out of sync. Run bun run seed:sync-notes.')
    process.exit(1)
  }
  console.log(`Dataset notes are in sync (${expected.length}).`)
} else {
  const otherArticles = seed.content.articles.filter((article) => article.data?.format !== 'dataset_note')
  seed.content.articles = [...otherArticles, ...expected]
  writeFileSync(seedPath, `${JSON.stringify(seed, null, 2)}\n`)
  console.log(`Synced ${expected.length} dataset notes into ${seedPath}.`)
}
