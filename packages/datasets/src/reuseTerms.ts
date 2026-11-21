import {
  DATASET_LICENCES,
  DATASET_PUBLISHER_IDS,
  PUBLISHERS,
  datasetLicence,
  type PublisherId,
} from './publishers'

/**
 * What a Dataset's Publisher says about reuse, recorded from the Publisher's
 * own site. It never upgrades silence into permission:
 *
 * - `open_licence`: the Publisher names an open licence (CC BY 4.0, ODbL …).
 * - `reuse_with_attribution`: the Publisher explicitly permits reproduction
 *   with acknowledgement, without naming a standard licence.
 * - `no_licence_stated`: we looked and found no reuse terms; the data are
 *   publicly downloadable, but that alone grants no permission.
 * - `all_rights_reserved`: the Publisher reserves rights or requires permission.
 */
export type ReuseTermsStatus = 'open_licence' | 'reuse_with_attribution' | 'no_licence_stated' | 'all_rights_reserved'

export const REUSE_TERMS_LABELS = {
  open_licence: 'Open licence',
  reuse_with_attribution: 'Reuse with attribution',
  no_licence_stated: 'No licence stated',
  all_rights_reserved: 'All rights reserved',
} as const satisfies Record<ReuseTermsStatus, string>

export interface PublisherTerms {
  status: ReuseTermsStatus
  /** A named open licence, only when status is open_licence. */
  licenceId?: OpenLicenceId
  /** What the Publisher states, in our words. */
  statement: string
  /** The page where the Publisher states it (or, when silent, the page we checked). */
  termsUrl: string
  /** Credit line the Publisher asks for, if it asks for one. */
  attribution?: string
  /** ISO date the terms were last read on the Publisher's site. */
  checkedOn: string
}

export interface DatasetReuseTerms {
  status: ReuseTermsStatus
  label: string
  licence: { id: string; name: string; url: string } | null
  statement: string
  terms_url: string
  attribution: string
  checked_on: string
}

/** Open licences a Publisher may name: the platform's own, plus upstream ones. */
export const OPEN_LICENCES = [
  ...DATASET_LICENCES,
  { id: 'cc-by-nc-3.0-igo', name: 'CC BY-NC 3.0 IGO', url: 'https://creativecommons.org/licenses/by-nc/3.0/igo/' },
  { id: 'mit', name: 'MIT', url: 'https://opensource.org/license/mit' },
] as const

export type OpenLicenceId = typeof OPEN_LICENCES[number]['id']

const CHECKED_ON = '2026-11-22'
const FOOTER_ONLY = 'The publisher’s website carries an “All Rights Reserved” copyright notice and states no reuse terms or licence. The figures are publicly downloadable, but that alone grants no permission to redistribute them.'

/**
 * Every Publisher's own reuse terms, read on the Publisher's site on
 * CHECKED_ON. A footer copyright notice is recorded as all_rights_reserved;
 * a page with no notice at all as no_licence_stated. Re-check before changing.
 */
export const PUBLISHER_TERMS = {
  'sri-lanka-dcs': {
    status: 'all_rights_reserved',
    statement: `${FOOTER_ONLY} Its Microdata Dissemination Policy covers licensed microdata only, not published tables.`,
    termsUrl: 'https://www.statistics.gov.lk/',
    checkedOn: CHECKED_ON,
  },
  'sri-lanka-cbsl': {
    status: 'all_rights_reserved',
    statement: `${FOOTER_ONLY} The statistical tables pages carry no reproduction or acknowledgement wording.`,
    termsUrl: 'https://www.cbsl.gov.lk/',
    checkedOn: CHECKED_ON,
  },
  'sri-lanka-treasury': {
    status: 'all_rights_reserved',
    statement: 'The Ministry’s copyright notice permits printing, downloading and copying for personal and non-commercial academic use. Redistribution or derivative works for commercial purposes need the Ministry’s written consent. It names no open licence.',
    termsUrl: 'https://www.treasury.gov.lk/web/disclaimer',
    checkedOn: CHECKED_ON,
  },
  'sri-lanka-pucsl': {
    status: 'all_rights_reserved',
    statement: FOOTER_ONLY,
    termsUrl: 'https://www.pucsl.gov.lk/',
    checkedOn: CHECKED_ON,
  },
  'sri-lanka-ceb': {
    status: 'no_licence_stated',
    statement: 'The publisher’s website shows only a copyright line and states no reuse terms or licence. Public availability alone grants no permission to redistribute.',
    termsUrl: 'https://www.ceb.lk/',
    checkedOn: CHECKED_ON,
  },
  'sri-lanka-nwsdb': {
    status: 'all_rights_reserved',
    statement: FOOTER_ONLY,
    termsUrl: 'https://www.waterboard.lk/',
    checkedOn: CHECKED_ON,
  },
  'sri-lanka-ntc': {
    status: 'no_licence_stated',
    statement: 'The publisher’s website shows only a copyright line; its “Terms & Conditions” link leads nowhere. No reuse terms or licence are stated.',
    termsUrl: 'https://www.ntc.gov.lk/',
    checkedOn: CHECKED_ON,
  },
  'sri-lanka-nso': {
    status: 'all_rights_reserved',
    statement: FOOTER_ONLY,
    termsUrl: 'https://www.nso.lk/',
    checkedOn: CHECKED_ON,
  },
  'sri-lanka-moh': {
    status: 'all_rights_reserved',
    statement: FOOTER_ONLY,
    termsUrl: 'https://www.health.gov.lk/home/',
    checkedOn: CHECKED_ON,
  },
  'sri-lanka-boi': {
    status: 'all_rights_reserved',
    statement: FOOTER_ONLY,
    termsUrl: 'https://investsrilanka.com/',
    checkedOn: CHECKED_ON,
  },
  'sri-lanka-irrigation': {
    status: 'all_rights_reserved',
    statement: FOOTER_ONLY,
    termsUrl: 'https://www.irrigation.gov.lk/web/index.php?lang=en',
    checkedOn: CHECKED_ON,
  },
  'sri-lanka-fhb': {
    status: 'reuse_with_attribution',
    statement: 'The Bureau’s terms of use permit reproducing its publications for non-commercial, educational and public-health purposes with attribution. Commercial use, modification or republication needs prior written permission.',
    termsUrl: 'https://fhb.health.gov.lk/terms-of-use',
    attribution: 'Family Health Bureau, Ministry of Health, Sri Lanka',
    checkedOn: CHECKED_ON,
  },
  'world-bank': {
    status: 'open_licence',
    licenceId: 'cc-by-nc-3.0-igo',
    statement: 'These figures come from World Bank Sri Lanka Development Updates. Each edition checked in the Open Knowledge Repository (October 2023 to October 2026) is licensed CC BY-NC 3.0 IGO, which bars commercial use. World Bank datasets, as distinct from reports, default to CC BY 4.0.',
    termsUrl: 'https://openknowledge.worldbank.org/handle/10986/45691',
    attribution: 'World Bank. Sri Lanka Development Update. © World Bank. License: CC BY-NC 3.0 IGO',
    checkedOn: CHECKED_ON,
  },
  'esa-worldcover': {
    status: 'open_licence',
    licenceId: 'cc-by-4.0',
    statement: 'ESA WorldCover maps are free of charge and released under CC BY 4.0; publications must cite the dataset.',
    termsUrl: 'https://esa-worldcover.org/en/data-access',
    attribution: '© ESA WorldCover project / Contains modified Copernicus Sentinel data processed by ESA WorldCover consortium',
    checkedOn: CHECKED_ON,
  },
  openstreetmap: {
    status: 'open_licence',
    licenceId: 'odbl-1.0',
    statement: 'OpenStreetMap data are licensed under the Open Database Licence; derived databases must stay under the same licence.',
    termsUrl: 'https://www.openstreetmap.org/copyright',
    attribution: '© OpenStreetMap contributors, ODbL',
    checkedOn: CHECKED_ON,
  },
  'nuwan-senaratna': {
    status: 'open_licence',
    licenceId: 'mit',
    statement: 'The lk_metro repository is released under the MIT licence; keep its copyright and permission notice.',
    termsUrl: 'https://github.com/nuuuwan/lk_metro/blob/main/LICENSE',
    attribution: 'Copyright (c) 2026 Nuwan I. Senaratna (nuuuwan/lk_metro), MIT',
    checkedOn: CHECKED_ON,
  },
  'developing-country-org': {
    status: 'open_licence',
    licenceId: 'cc-by-4.0',
    statement: 'developing-country.org releases its own compilations under the licence named for each Dataset. Each input source keeps its own terms.',
    termsUrl: 'https://developing-country.org/terms',
    attribution: 'developing-country.org',
    checkedOn: CHECKED_ON,
  },
} as const satisfies Record<PublisherId, PublisherTerms>

type RegisteredDatasetId = keyof typeof DATASET_PUBLISHER_IDS

/** Per-dataset overrides where one Dataset's terms differ from its Publisher's default. */
export const DATASET_TERMS_OVERRIDES: Partial<Record<RegisteredDatasetId, PublisherTerms>> = {}

function licenceById(id: OpenLicenceId | undefined) {
  if (!id) return null
  const licence = OPEN_LICENCES.find((candidate) => candidate.id === id)
  if (!licence) throw new Error(`Unknown licence ${id}`)
  return { id: licence.id, name: licence.name, url: licence.url }
}

/**
 * The reuse terms that apply to a Dataset: the per-dataset override, else the
 * licence developing-country.org releases its own Datasets under, else the
 * Publisher's default. Null only for ids that are not registered Datasets.
 */
function isRegisteredDatasetId(value: string): value is RegisteredDatasetId {
  return Object.hasOwn(DATASET_PUBLISHER_IDS, value)
}

export function datasetReuseTerms(datasetId: string): DatasetReuseTerms | null {
  if (!isRegisteredDatasetId(datasetId)) return null
  const publisherId: PublisherId = DATASET_PUBLISHER_IDS[datasetId]
  const override = DATASET_TERMS_OVERRIDES[datasetId]
  const platform = datasetLicence(datasetId)
  const terms: PublisherTerms = override ?? (platform
    ? {
        ...PUBLISHER_TERMS[publisherId],
        licenceId: platform.id,
        termsUrl: platform.url,
        statement: `developing-country.org releases this compilation under ${platform.name}. Each input source keeps its own terms.`,
      }
    : PUBLISHER_TERMS[publisherId])
  if (!terms) throw new Error(`Missing reuse terms for Publisher ${publisherId}`)
  const licence = terms.status === 'open_licence' ? licenceById(terms.licenceId) : null
  if (terms.status === 'open_licence' && !licence) throw new Error(`Open licence without a licence id for ${datasetId}`)
  return {
    status: terms.status,
    label: licence ? licence.name : REUSE_TERMS_LABELS[terms.status],
    licence,
    statement: terms.statement,
    terms_url: terms.termsUrl,
    attribution: terms.attribution ?? `Source: ${PUBLISHERS.find((p) => p.id === publisherId)?.name ?? publisherId}, via developing-country.org`,
    checked_on: terms.checkedOn,
  }
}
