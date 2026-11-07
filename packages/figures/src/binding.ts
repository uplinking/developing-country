import {
  formatBoundValue,
  resolveBoundValue,
  type StatFormat,
  type ValueBinding,
} from '@developing-country/emdash-blocks/figure-blocks'
import type { DataViewState } from './useDataView'
import { provenanceText } from './provenance'
import { optionalNumber } from './steps'

export type BoundValue =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'ready'; value: number; text: string; source: string; viewTitle: string }

const AGGREGATES = new Set(['first', 'sum', 'mean', 'min', 'max', 'count'])

/** Normalise a stored binding (CMS numbers may be strings; unknown aggregates fail closed). */
export function normaliseBinding(input: Record<string, unknown>): Omit<ValueBinding, 'view_url'> | null {
  const field = typeof input.field === 'string' ? input.field.trim() : ''
  const aggregate = typeof input.aggregate === 'string' && input.aggregate ? input.aggregate : 'first'
  if (!AGGREGATES.has(aggregate)) return null
  if (!field && aggregate !== 'count') return null
  const whereField = typeof input.where_field === 'string' && input.where_field.trim() ? input.where_field.trim() : undefined
  const scale = optionalNumber(input.scale)
  return {
    field,
    aggregate: aggregate as ValueBinding['aggregate'],
    ...(whereField ? { where_field: whereField, where_value: String(input.where_value ?? '') } : {}),
    ...(scale !== undefined ? { scale } : {}),
  }
}

/** A bound number for display: never a placeholder number, always an explicit state. */
export function boundValue(
  state: DataViewState,
  input: Record<string, unknown>,
  format?: StatFormat,
  unit?: string,
): BoundValue {
  const binding = normaliseBinding(input)
  if (!binding) return { status: 'unavailable', reason: 'This number is not bound to a field.' }
  if (state.status === 'loading') return { status: 'loading' }
  if (state.status === 'error') return { status: 'unavailable', reason: state.error.message }
  const value = resolveBoundValue(state.data.rows, binding)
  if (value === null) return { status: 'unavailable', reason: 'The data view has no value for this number.' }
  return {
    status: 'ready',
    value,
    text: formatBoundValue(value, format, unit),
    source: provenanceText(state.data.view),
    viewTitle: state.data.view.title,
  }
}

export function statFormat(value: unknown): StatFormat | undefined {
  return value === 'number' || value === 'compact' || value === 'percent' ? value : undefined
}
