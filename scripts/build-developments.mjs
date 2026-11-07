// Builds public/data/developments.geojson — curated planned developments from
// Sri Lankan government planning documents, so each feature links back to its
// source (page-anchored where possible) for people to verify themselves.
//
// Provenance lives in scripts/data-sources.json (the catalogue): each project
// cites a source `id` from there, and we denormalise the source name / URL /
// refresh date onto the feature so the map popover can show them without a
// second fetch. Re-run: bun run build:developments
//
// Schema per feature (all of stages/cost/note/page optional):
//   name, type, status                        — what it is + where it stands
//   stages { proposed?, approved?,            — rough date per lifecycle stage
//            construction?, operational? }       (drives the popover timeline)
//   cost                                      — headline budget, source-consistent
//   note                                      — one-line descriptor
//   source, source_url, page, updated         — provenance (updated = last verified)

import { readFile, writeFile } from 'node:fs/promises'

const catalogue = JSON.parse(await readFile(new URL('./data-sources.json', import.meta.url), 'utf8'))
const SRC = Object.fromEntries(catalogue.sources.map((s) => [s.id, s]))

/** Stamp a project with provenance. `src` ties it to a catalogue source (for
 * the last-verified date + the refresh workflow); a project may override the
 * displayed `source` name / `source_url` with its own specific citation (an
 * operator release, a ministry announcement) while still tracking freshness
 * against the government body in the catalogue. */
const provenance = (id, over = {}) => {
  const s = SRC[id]
  if (!s) throw new Error(`unknown source id: ${id} (add it to data-sources.json)`)
  return { source: over.source ?? s.name, source_url: over.source_url ?? s.url, updated: s.refreshed }
}

const feature = ({ name, lat, lng, type, status, stages, cost, note, page, src, source, source_url }) => {
  const properties = {
    name,
    type,
    status,
    ...provenance(src, { source, source_url }),
  }
  if (stages) properties.stages = stages
  if (cost) properties.cost = cost
  if (note) properties.note = note
  if (page) properties.page = page
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'Point', coordinates: [lng, lat] },
  }
}

const features = []

// ---- Colombo Port City (CPCEC) -----------------------------------------------
// Official government SEZ; figures/dates verified against the CPCEC (.gov.lk).
// A 269 ha sea-reclamation new city adjoining the Colombo CBD.
features.push(
  feature({
    name: 'Colombo Port City',
    lat: 6.945,
    lng: 79.838,
    type: 'special-economic-zone',
    status: 'under-construction',
    stages: {
      proposed: '2014',
      approved: '2016',
      construction: '2019',
      operational: '2041 (target)',
    },
    cost: 'US$1.4B initial · ~US$20B at build-out',
    note: '269 ha sea-reclamation SEZ beside the Colombo CBD — five precincts, ~273,000 residents at completion. Land reclamation completed Jan 2019; marina open since 2022.',
    src: 'cpcec',
  }),
)

// ---- National megaprojects ---------------------------------------------------
// Ongoing / planned projects of national significance, compiled from official
// announcements and Sri Lankan media (2025–2026). Coordinates are representative
// (a project's key node); linear works (expressways, rail) also appear as
// alignments in the Highways layer — here they carry the budget, status and
// timeline. Each cites its own specific source; the catalogue `src` tracks
// which government body owns it for the refresh workflow.
const megaprojects = [
  // Ports — Colombo
  {
    name: 'Colombo West International Terminal (CWIT)',
    lat: 6.958, lng: 79.842, type: 'port-terminal', status: 'operational',
    stages: { proposed: '2021', approved: '2021', construction: '2022', operational: '2025' },
    cost: 'US$800M',
    note: 'Deep-water terminal (1,400 m quay, 20 m draught, ~3.2M TEU/yr). Adani Ports / John Keells / SLPA. Operations began Apr 2025.',
    src: 'slpa',
    source: 'Adani Ports / SLPA — CWIT',
    source_url: 'https://www.adaniports.com/newsroom/media-releases/adani-colombo-terminal-commences-operations',
  },
  {
    name: 'East Container Terminal (ECT)',
    lat: 6.966, lng: 79.849, type: 'port-terminal', status: 'under-construction',
    stages: { proposed: '2019', approved: '2021', construction: '2021', operational: '2026 (target)' },
    cost: 'US$475M',
    note: 'SLPA-funded deep-water terminal (1,300 m quay). Partially operating since 2025 while final infrastructure is completed.',
    src: 'slpa',
    source: 'Sri Lanka Ports Authority — ECT',
    source_url: 'https://www.slpa.lk/',
  },
  // NOTE: expressway projects (Central, Ruwanpura, Kurunegala–Dambulla) are NOT
  // here — they live in the Highways & projected expressways layer as marked
  // alignments (dotted = proposed), with the same budget/status/timeline on tap.
  // See scripts/fetch-expressways.mjs.
  // Aviation
  {
    name: 'Bandaranaike Int’l Airport — Phase 2 (Terminal 2)',
    lat: 7.176, lng: 79.884, type: 'airport', status: 'under-construction',
    stages: { proposed: '2016', approved: '2020', construction: '2024', operational: '2027 (target)' },
    cost: 'Rs 170bn (JICA loan)',
    note: 'New main terminal, two piers and elevated roadway, ~JICA-financed. Restarted 2024 after the debt-restructuring freeze; ~30-month build.',
    src: 'aasl',
    source: 'AASL / Embassy of Japan — BIA Phase 2',
    source_url: 'https://www.lk.emb-japan.go.jp/itpr_en/11_000001_00509.html',
  },
  // Rail / transit — Colombo
  {
    name: 'Colombo Light Rail Transit (LRT) — Fort–Malabe',
    lat: 6.909, lng: 79.894, type: 'rail', status: 'proposed',
    stages: { proposed: '2019', approved: '2019', construction: '—', operational: '2030s (target)' },
    cost: 'US$2.2B (US$1.85B JICA loan)',
    note: '15.8 km elevated light rail, 16 stations, Colombo Fort ↔ Malabe. Cancelled 2020; revival under discussion with Japan/JICA — not yet re-committed.',
    src: 'mot',
    source: 'Ministry of Transport / JICA (revival)',
    source_url: 'https://www.ft.lk/top-story/SL-to-roll-out-Japan-funded-2-2-b-LRT-projectagain/26-746444',
  },
  {
    name: 'Colombo Suburban Railway — electrification',
    lat: 6.929, lng: 79.864, type: 'rail', status: 'proposed',
    stages: { proposed: '2020', approved: '2026', construction: '2027 (target)', operational: '—' },
    cost: 'India LOC (~US$250M rail modernisation)',
    note: 'Electrify high-density corridors (Maradana–Makumbura / Kelani Valley line first). Feasibility underway; India-funded track, signalling (IRCON) and rolling stock.',
    src: 'mot',
    source: 'Ministry of Transport — CSRP',
    source_url: 'https://transport.gov.lk/web/index.php?option=com_content&view=article&id=136&Itemid=218&lang=en',
  },
  // Energy — south & east
  {
    name: 'Hambantota Oil Refinery (Sinopec)',
    lat: 6.145, lng: 81.075, type: 'energy', status: 'approved',
    stages: { proposed: '2019', approved: '2025', construction: '2026 (target)', operational: '2028 (target)' },
    cost: 'US$3.7B',
    note: '200,000 bpd refinery in the Hambantota port investment zone — the largest single FDI in Sri Lankan history. Agreement fast-tracked Jan 2025.',
    src: 'moe',
    source: 'BOI / Sinopec (via Daily FT)',
    source_url: 'https://www.ft.lk/columns/Sinopec-s-3-7-billion-oil-refinery-investment-in-Sri-Lanka/4-773663',
  },
  {
    name: 'Trincomalee Energy Hub — oil tank farm',
    lat: 8.556, lng: 81.205, type: 'energy', status: 'proposed',
    stages: { proposed: '2022', approved: '2025', construction: '—', operational: '—' },
    note: 'India–Sri Lanka–UAE agreement (Apr 2025) to develop Trincomalee as a regional energy hub, including the WWII-era oil tank farm.',
    src: 'moe',
    source: 'Ministry of Energy (India–SL–UAE)',
    source_url: 'https://www.lowyinstitute.org/the-interpreter/three-way-energy-play-india-sri-lanka-uae-deal-trincomalee',
  },
  {
    name: 'Mannar–Pooneryn Wind Power',
    lat: 8.98, lng: 79.92, type: 'energy', status: 'proposed',
    stages: { proposed: '2019', approved: '—', construction: '—', operational: '—' },
    note: '~484–500 MW wind. Adani Green withdrew (Feb 2025) after the power-purchase agreement was revoked; a committee is reassessing feasibility and tariff.',
    src: 'moe',
    source: 'SL Sustainable Energy Authority (via Mercom)',
    source_url: 'https://www.mercomindia.com/sri-lanka-awards-wind-power-projects-adani-green',
  },
  {
    name: 'Sampur Solar Power Park',
    lat: 8.45, lng: 81.27, type: 'energy', status: 'approved',
    stages: { proposed: '2022', approved: '2025', construction: '2026 (target)', operational: '—' },
    note: '50 MW solar park, Sampur (Trincomalee district). CEB–NTPC joint venture; permit issued.',
    src: 'moe',
    source: 'Ceylon Electricity Board · NTPC',
    source_url: 'https://www.themorning.lk/articles/wZg1n1IYYRgYamA7EW34',
  },
  {
    name: 'Sobadhanavi LNG Power Plant (Kerawalapitiya)',
    lat: 6.981, lng: 79.902, type: 'energy', status: 'operational',
    stages: { proposed: '2019', approved: '2021', construction: '2022', operational: '2025' },
    note: '350 MW LNG combined-cycle plant. Phase 1 (220 MW) commissioned Aug 2024; Phase 2 (130 MW steam) Sep 2025. India (Petronet) to build the LNG terminal.',
    src: 'moe',
    source: 'CEB / LTL — Sobadhanavi',
    source_url: 'https://www.newswire.lk/2024/08/28/sobadhanavi-lng-power-plant-declared-open/',
  },
  // Water / irrigation
  {
    name: 'North Central Province Canal (Mahaweli WSIP)',
    lat: 7.85, lng: 80.72, type: 'flood-mitigation', status: 'under-construction',
    stages: { proposed: '2013', approved: '2015', construction: '2016', operational: '2030 (target)' },
    cost: 'US$200M (ADB Stage 2)',
    note: 'Links Moragahakanda to the North Central dry-zone reservoirs (Huruluwewa, Manankattiya…). Mahaweli Water Security Program Stage 2 benefits ~35,600 farming households.',
    src: 'irrigation',
    source: 'Mahaweli Authority / ADB',
    source_url: 'https://www.adb.org/news/adb-approves-200-million-improve-water-food-security-north-central-sri-lanka',
  },
  {
    name: 'Uma Oya Multipurpose Project',
    lat: 6.90, lng: 81.00, type: 'energy', status: 'operational',
    stages: { proposed: '2008', approved: '2010', construction: '2011', operational: '2024' },
    cost: 'US$529M',
    note: 'Two dams + a 120 MW hydropower plant, inaugurated 2024. Adds ~231 GWh/yr and irrigates ~4,500 ha of the south-eastern dry zone.',
    src: 'irrigation',
    source: 'Ministry of Irrigation — Uma Oya',
    source_url: 'https://economynext.com/iran-president-to-open-sri-lanka-514mn-irrigation-hydro-power-project-159760/',
  },
  {
    name: 'Jaffna–Kilinochchi Water Supply & Sanitation',
    lat: 9.665, lng: 80.015, type: 'flood-mitigation', status: 'under-construction',
    stages: { proposed: '2010', approved: '2011', construction: '2013', operational: '2025 (target)' },
    note: 'ADB-funded piped, treated water for ~300,000 people across Jaffna, Poonakari and the islands (except Delft).',
    src: 'irrigation',
    source: 'NWSDB / ADB',
    source_url: 'https://www.adb.org/projects/37378-013/main',
  },
  // Northern reconstruction (India-funded)
  {
    name: 'Kankesanthurai (KKS) Harbour rehabilitation',
    lat: 9.815, lng: 80.043, type: 'port-terminal', status: 'approved',
    stages: { proposed: '2023', approved: '2024', construction: '2025 (target)', operational: '—' },
    cost: 'US$61.5M (India grant)',
    note: 'Rehabilitation & modernisation of the northern harbour to improve connectivity with southern India. Cabinet-approved under an Indian grant.',
    src: 'slpa',
    source: 'SLPA / High Commission of India',
    source_url: 'https://www.hcicolombo.gov.in/page/ongoing-projects/',
  },
  {
    name: 'Palaly Airport rehabilitation (Jaffna)',
    lat: 9.792, lng: 80.070, type: 'airport', status: 'approved',
    stages: { proposed: '2023', approved: '2024', construction: '2025 (target)', operational: '—' },
    note: 'India-funded rehabilitation of Palaly airport to expand northern air connectivity (alongside KKS harbour).',
    src: 'aasl',
    source: 'AASL / High Commission of India',
    source_url: 'https://www.hcicolombo.gov.in/page/ongoing-projects/',
  },
  // Ports — south
  {
    name: 'Hambantota International Port',
    lat: 6.122, lng: 81.118, type: 'port-terminal', status: 'operational',
    stages: { proposed: '2006', approved: '2008', construction: '2008', operational: '2010' },
    note: 'Deep-water port on the east–west shipping lane, operated by China Merchants under a 99-year lease; ongoing industrial-zone build-out (incl. the Sinopec refinery).',
    src: 'slpa',
    source: 'Hambantota International Port Group',
    source_url: 'https://www.hipg.lk/',
  },
  // Industrial
  {
    name: 'Paranthan Chemical Zone',
    lat: 9.370, lng: 80.402, type: 'industrial-zone', status: 'proposed',
    stages: { proposed: '2025', approved: '—', construction: '—', operational: '—' },
    cost: 'Rs 500M (2025 budget)',
    note: 'Dedicated chemical manufacturing zone at Paranthan (Kilinochchi), seeded by a 2025 budget allocation.',
    src: 'boi',
    source: 'Board of Investment (2025 budget)',
    source_url: 'https://investsrilanka.com/',
  },
]

for (const p of megaprojects) features.push(feature(p))

// ---- Kandy Development Plan projects -----------------------------------------
// [name, lat, lng, type, status, page]. Coordinates approximate (the KDP gives
// town names / chainages, not lat/lng). The Central Expressway alignment +
// interchanges live in the Highways layer (accurate OSM geometry), not here.
const kandyProjects = [
  ['Kandy Multimodal Transport Terminal (KMTT)', 7.293, 80.634, 'transport-hub', 'under-construction', 28],
  ['Getambe Junction Flyover', 7.259, 80.597, 'road', 'under-construction', 28],
  ['Kandy–Sarasavi Uyana Railway Upgrade', 7.27, 80.61, 'rail', 'proposed', 28],
  ['Meda Ela Canal Rehabilitation', 7.293, 80.64, 'flood-mitigation', 'under-construction', 29],
  ['Bogambara Bus Terminal', 7.291, 80.63, 'transport-hub', 'proposed', 30],
  ['Pallekele Industrial Estate / BOI Zone', 7.29, 80.703, 'industrial-zone', 'proposed', 31],
  ['Eriyagama New Town', 7.26, 80.58, 'new-town', 'proposed', 31],
  ['Dodangolla New Town', 7.3, 80.7, 'new-town', 'proposed', 31],
  ['Kundasale Town Development (IT park)', 7.281, 80.686, 'commercial-zone', 'proposed', 31],
  ['Nawayalatenna–Pallekele New Rail Line', 7.29, 80.75, 'rail', 'proposed', 32],
  ['Southern Bypass (Peradeniya–Tennekumbura)', 7.27, 80.63, 'road', 'proposed', 41],
  ['Katugastota Satellite Centre', 7.324, 80.622, 'satellite-town', 'proposed', 22],
  ['Peradeniya Knowledge Hub', 7.262, 80.598, 'satellite-town', 'proposed', 22],
  ['Digana Town Development', 7.283, 80.76, 'satellite-town', 'proposed', 40],
  ['Akurana Satellite Centre', 7.363, 80.616, 'satellite-town', 'proposed', 36],
  ['Kadugannawa Satellite Centre', 7.253, 80.523, 'satellite-town', 'proposed', 36],
  ['Pilimathalawa Satellite Centre', 7.264, 80.548, 'satellite-town', 'proposed', 36],
  ['Gampola Southern Satellite Centre', 7.164, 80.573, 'satellite-town', 'proposed', 36],
]

for (const [name, lat, lng, type, status, page] of kandyProjects) {
  features.push(feature({ name, lat, lng, type, status, page, src: 'kdp-2025' }))
}

const fc = { type: 'FeatureCollection', features }
await writeFile('public/data/developments.geojson', JSON.stringify(fc))
const byStatus = features.reduce((a, f) => ((a[f.properties.status] = (a[f.properties.status] || 0) + 1), a), {})
console.log(`Wrote ${features.length} developments →`, byStatus)
