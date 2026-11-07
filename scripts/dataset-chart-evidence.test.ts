import { describe, expect, test } from 'bun:test'
import { INDICATOR_DATASETS } from '@developing-country/datasets'
import { canonicalRows, datasetVersionEvidence, resultChecksum } from '../src/views/datasetChartEvidence'

describe('static dataset chart evidence', () => {
  test('hashes the actual selected rows canonically instead of using a placeholder', async () => {
    const left = [{ period: '2026-01', flow: 'exports', value: 1 }]
    const right = [{ value: 1, flow: 'exports', period: '2026-01' }]
    expect(canonicalRows(left)).toBe(canonicalRows(right))
    expect(await resultChecksum(left)).toBe(await resultChecksum(right))
    expect(await resultChecksum(left)).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(await resultChecksum(left)).not.toBe(`sha256:${'0'.repeat(64)}`)
  })

  test('projects the immutable manifest identity for every indicator preset', () => {
    for (const dataset of INDICATOR_DATASETS) {
      const evidence = datasetVersionEvidence(dataset.id, dataset.sourceIds)
      expect(evidence.datasetId).toBe(dataset.id)
      expect(evidence.versionId).toMatch(/^dsv_[0-9a-f]{32}$/)
      expect(evidence.checksum).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect([...evidence.sourceIds].sort()).toEqual([...dataset.sourceIds].sort())
    }
  })
})
