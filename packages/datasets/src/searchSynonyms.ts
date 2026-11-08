// The one reviewable synonym map for dataset search. The /data page reads it
// from the R2 dataset catalogue (so the size-constrained site Worker never
// bundles it); the explore Worker imports it here for get_layer_catalog {q}.
// Kept out of ./search so importing the scorer does not pull the map in.

import file from './search-synonyms.json'
import type { SynonymMap } from './search'

export const SEARCH_SYNONYMS: SynonymMap = file.synonyms
