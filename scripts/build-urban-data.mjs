#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { read as readWorkbook } from 'xlsx'
import { URBAN_DATASETS } from '../packages/datasets/src/urban.ts'
import { dim, measure, evidenceFields, evidence, invariant, readSource, pdfPages, writeTables } from './lib/reviewed-source.mjs'

export const URBAN_RECIPES = JSON.parse(readFileSync(new URL('./urban/recipes.json', import.meta.url), 'utf8'))
const compact = value => value.trim().replace(/\s+/g, ' ')

/** Keep unavailable and nil/negligible tokens distinct; never infer an exact zero. */
export function pocketCell(token) {
  if (token === '..' || token === '…') return { value: null, observation_status: 'not_available' }
  if (token === '-') return { value: null, observation_status: 'nil_or_negligible' }
  if (/^\((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\)$/.test(token)) return { value: -Number(token.slice(1, -1).replaceAll(',', '')), observation_status: 'reported' }
  invariant(/^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(token), `ambiguous numeric token ${JSON.stringify(token)}`)
  return { value: Number(token.replaceAll(',', '')), observation_status: 'reported' }
}

export function validateReviewedRow(row, columns, page) {
  invariant(row.cells.length === columns.length, `wrong column count for ${row.source_line}`)
  const line = compact(row.source_line)
  invariant(line.endsWith(row.cells.join(' ')), `cell order differs from reviewed row ${line}`)
  invariant(compact(page).includes(line), `reviewed row missing from original page: ${line}`)
}

export function reviewedPocketCell(token, review) {
  if (!review) return { ...pocketCell(token), review_note: null }
  invariant(review.note?.trim().length > 0, 'a reviewed numeric exception needs an explanation')
  invariant(review.value === null || Number.isFinite(review.value), 'reviewed value must be finite or null')
  invariant(['source_ambiguity', 'reviewed_typography', 'revised', 'provisional', 'estimate', 'reported', 'not_available'].includes(review.status), 'unknown numeric exception status')
  invariant(review.status !== 'source_ambiguity' || review.value === null, 'ambiguous source values must remain null')
  invariant(review.status !== 'not_available' || (review.value === null && ['', '..'].includes(token)), 'unavailable review requires a blank or unavailable source token')
  let observation_status = review.status
  if (['revised', 'provisional', 'estimate', 'reported'].includes(review.status)) {
    invariant(review.status !== 'reported' || ['%', '(a)', '(b)', '(c)', '(d)'].includes(review.marker), 'reported marker must be a unit suffix or a reviewed footnote')
    invariant(review.marker && token.endsWith(review.marker), 'reviewed source marker is missing')
    const unmarked = pocketCell(token.slice(0, -review.marker.length))
    invariant(unmarked.value === review.value, 'marked numeric value differs from its printed digits')
    if (review.status === 'reported') observation_status = unmarked.observation_status
  }
  return { value: review.value, observation_status, review_note: review.note }
}

export function validateReviewedWorkbookRow(section, row, workbook) {
  const sheet = workbook.Sheets[section.sheet]
  invariant(sheet, `missing reviewed worksheet ${section.sheet}`)
  invariant(row.source_cells?.length === section.columns.length && row.cells.length === section.columns.length, 'workbook cell count changed')
  for (const assertion of [...section.assertions, ...row.assertions]) {
    invariant((sheet[assertion.address]?.v ?? null) === assertion.value, `workbook header or label changed at ${section.sheet}!${assertion.address}`)
  }
  row.source_cells.forEach((expected, index) => {
    const actual = sheet[expected.address]
    invariant((actual?.v ?? null) === expected.value && (actual?.t ?? null) === expected.type, `workbook value changed at ${section.sheet}!${expected.address}`)
    invariant((actual?.f ?? null) === expected.formula, `workbook formula changed at ${section.sheet}!${expected.address}`)
    invariant((actual?.w ?? String(actual?.v ?? '')) === row.cells[index], `workbook display changed at ${section.sheet}!${expected.address}`)
  })
}

function reviewedWorkbookCell(row, index) {
  const cell = row.source_cells[index]
  invariant(cell.type === 'n' || cell.type === 'e' || cell.value === null, 'unexpected workbook value type')
  invariant(cell.type !== 'n' || (Number.isFinite(cell.value) && cell.value >= 0), 'invalid reviewed workbook measure')
  return { value: cell.type === 'n' ? cell.value : null, observation_status: cell.type === 'e' ? 'source_error' : cell.value === null ? 'not_available' : 'reported', review_note: null, source_formula: cell.formula }
}

export function buildUrbanTables(pagesBySource) {
  invariant(URBAN_RECIPES.datasets.length === URBAN_DATASETS.length, 'definitions and reviewed recipes differ')
  return URBAN_RECIPES.datasets.map(recipe => {
    const definition = URBAN_DATASETS.find(d => d.id === recipe.id)
    invariant(definition, `unknown dataset ${recipe.id}`)
    const rows = (recipe.tables ?? [recipe]).flatMap((section, sectionIndex) => {
      const source = URBAN_RECIPES.documents.find(d => d.sourceId === (section.source_id ?? definition.sourceIds[0]))
      invariant(source && definition.sourceIds.includes(source.sourceId), `missing or undeclared source for ${recipe.id}`)
      invariant(!section.sheet || source.format === 'workbook', `worksheet requires a workbook source for ${recipe.id}`)
      return section.rows.flatMap((row, rowIndex) => {
        if (pagesBySource) {
          const input = pagesBySource.get(source.sourceId)
          if (section.sheet) validateReviewedWorkbookRow(section, row, input)
          else {
            const page = input?.[section.pdf_page - 1]
            invariant(page && compact(page).includes(compact(section.heading)), `table heading changed for ${recipe.id}`)
            if (section.reviewed_image_cells) {
              // readSource has already verified the full PDF hash. Image-only cells
              // require an explicit visual review, never inferred graph positions.
              invariant(section.review_note?.trim().length > 0, 'image-only cells require a visual review note')
              invariant(row.source_label?.trim().length > 0 && row.cells.length === section.columns.length, 'image-only cell locator or column count is invalid')
            } else validateReviewedRow(row, section.columns, page)
          }
        }
        return section.columns.map((column, columnIndex) => {
          const cell = section.sheet ? reviewedWorkbookCell(row, columnIndex) : reviewedPocketCell(row.cells[columnIndex], row.cell_reviews?.[columnIndex])
          return {
            record_id: `${recipe.id}:${sectionIndex === 0 ? '' : `s${sectionIndex + 1}:`}${rowIndex + 1}:${columnIndex + 1}`,
            ...section.constants, ...row.dimensions, ...column, ...row.cell_dimensions?.[columnIndex], unit: column.unit ?? row.unit,
            value: cell.value,
            observation_status: cell.observation_status === 'reported' ? (column.observation_status ?? row.observation_status ?? section.observation_status ?? 'reported') : cell.observation_status,
            reported_token: row.cells[columnIndex],
            ...(section.sheet ? { source_formula: cell.source_formula } : {}),
            ...evidence(source, section.sheet ? `Worksheet ${JSON.stringify(section.sheet)}; cell ${row.source_cells[columnIndex].address}; ${section.metric}; ${row.source_label}; ${column.reported_month ? `reported month ${column.reported_month}` : Object.entries(column).filter(([key]) => key !== 'review_note').map(([key, value]) => `${key}=${value}`).join('; ')}` : `PDF page ${section.pdf_page}; printed page ${section.printed_page}; table ${section.table}; row ${rowIndex + 1} (${row.source_label}); column ${columnIndex + 1} (${Object.entries(column).filter(([key]) => key !== 'review_note').map(([, value]) => value).join(', ')})`, cell.review_note ?? row.cell_notes?.[columnIndex] ?? column.review_note ?? row.review_note ?? section.review_note ?? null),
          }
        })
      })
    })
    const dimensions = recipe.fields.map(f => dim(f.id, f.type, f.label))
    return {
      dataset_id: recipe.id, title: definition.title, source_ids: definition.sourceIds, vintage: definition.vintage,
      grain: recipe.grain, primary_key: ['record_id'],
      fields: [...evidenceFields, ...dimensions, dim('unit', 'string', 'Unit'), dim('reported_token', 'string', 'Printed value'), dim('observation_status', 'string', 'Observation status'), measure('value', 'Reported value', 'See unit field')],
      rows, notes: [definition.note.contains], caveats: [definition.note.limit, recipe.symbol_note ?? 'The source uses .. for unavailable figures and a dash for nil or negligible. Both retain their printed token and a distinct status; neither is converted to an exact zero.'],
    }
  })
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const directoryIndex = args.indexOf('--source-dir')
  const directory = resolve(directoryIndex < 0 ? '.context/urban-expansion/raw' : args[directoryIndex + 1])
  const pages = new Map(URBAN_RECIPES.documents.map(source => {
    const original = readSource(source, directory, args.includes('--fetch'))
    return [source.sourceId, source.format === 'workbook' ? readWorkbook(original.bytes, { type: 'buffer', cellText: true, cellFormula: true }) : pdfPages(original.path)]
  }))
  writeTables(buildUrbanTables(pages), 'public/data', args.includes('--check'))
}
