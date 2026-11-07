// Test fixture: /data search documents built from the checked-in catalogue and
// CMS seed through the same builders the page uses.
import catalogJson from '../data/dataset-catalog.json'
import seedJson from '../seed/seed.json'
import runtimeJson from '../seed/runtime.json'
import { gapFields } from './lib/claims'
import { parseDatasetCatalog } from './lib/datasetCatalog'
import { datasetSearchDocument, gapSearchDocument } from './lib/dataSearch'
import { datasetMeta, datasetNotes, isDatasetId } from './lib/datasets'

export const catalog = parseDatasetCatalog(catalogJson, datasetNotes.map((dataset) => dataset.id))

export const datasetDocuments = seedJson.content.articles.flatMap((entry) => {
  const id = 'dataset_id' in entry.data ? entry.data.dataset_id : undefined
  if (entry.data.format !== 'dataset_note' || !isDatasetId(id)) return []
  const dataset = datasetMeta(catalog, id)
  return [datasetSearchDocument({
    ...dataset,
    title: entry.data.title,
    dek: entry.data.dek,
    question: entry.data.research_question,
    terms: catalog.search.datasets[id],
  })]
})

export const gapDocuments = runtimeJson.content.data_gaps.flatMap((entry) => {
  const gap = gapFields(entry.id, entry.data)
  return gap ? [gapSearchDocument(gap, [])] : []
})
