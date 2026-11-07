import { readFileSync } from 'node:fs'

/** Decode the small XML surface used by Office Open XML string and value cells. */
export function decodeXmlText(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

export function parseSharedStringsXml(xml) {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((text) => decodeXmlText(text[1]))
      .join(''),
  )
}

export function columnIndex(reference) {
  const letters = /^([A-Z]+)/.exec(reference)?.[1]
  if (!letters) throw new Error(`Invalid spreadsheet reference: ${reference}`)
  let index = 0
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64
  return index - 1
}

function attribute(source, name) {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(source)?.[1]
}

/**
 * Parse one worksheet into sparse row arrays. Values are strings, numbers,
 * booleans, or null; formulas use their cached value. Styling and merged-cell
 * display are deliberately ignored because ingestion scripts own the table
 * semantics explicitly.
 */
export function parseSheetXml(xml, sharedStrings = []) {
  const rows = []
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const declared = Number(attribute(rowMatch[1], 'r'))
    const rowIndex = Number.isInteger(declared) && declared > 0 ? declared - 1 : rows.length
    const row = []
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1]
      const reference = attribute(attrs, 'r')
      if (!reference) continue
      const type = attribute(attrs, 't')
      const body = cellMatch[2] ?? ''
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      let value = null
      if (type === 'inlineStr') {
        value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
          .map((text) => decodeXmlText(text[1]))
          .join('')
      } else if (raw !== undefined) {
        const decoded = decodeXmlText(raw)
        if (type === 's') value = sharedStrings[Number(decoded)] ?? null
        else if (type === 'b') value = decoded === '1'
        else if (type === 'str' || type === 'e') value = decoded
        else {
          const number = Number(decoded)
          value = Number.isFinite(number) ? number : decoded
        }
      }
      row[columnIndex(reference)] = value
    }
    rows[rowIndex] = row
  }
  return rows
}

function unzipEntry(path, entry, optional = false) {
  const result = Bun.spawnSync(['unzip', '-p', path, entry])
  if (result.exitCode !== 0) {
    if (optional) return ''
    throw new Error(`Could not read ${entry} from ${path}: ${new TextDecoder().decode(result.stderr).trim()}`)
  }
  return new TextDecoder().decode(result.stdout)
}

export function readXlsxSheet(path, sheet = 'xl/worksheets/sheet1.xml') {
  // Fail with a clearer error than unzip for a missing workbook.
  readFileSync(path, { flag: 'r' })
  const shared = parseSharedStringsXml(unzipEntry(path, 'xl/sharedStrings.xml', true))
  return parseSheetXml(unzipEntry(path, sheet), shared)
}
