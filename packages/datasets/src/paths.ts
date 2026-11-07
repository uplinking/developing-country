export function indicatorDatasetPath(datasetId: string): string {
  return `/data/${encodeURIComponent(datasetId)}.json`
}

export function indicatorPresetPath(datasetId: string, presetId: string): string {
  return `/datasets/${encodeURIComponent(datasetId)}/${encodeURIComponent(presetId)}`
}
