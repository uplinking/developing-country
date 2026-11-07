import { describe, expect, test } from 'bun:test'
import { columnIndex, decodeXmlText, parseSharedStringsXml, parseSheetXml } from './lib/xlsx.mjs'

describe('minimal XLSX reader', () => {
  test('decodes entities and rich shared strings', () => {
    const xml = '<sst><si><t>A &amp; B</t></si><si><r><t>North</t></r><r><t> West</t></r></si></sst>'
    expect(parseSharedStringsXml(xml)).toEqual(['A & B', 'North West'])
    expect(decodeXmlText('&#x41;&#66;&lt;')).toBe('AB<')
  })

  test('converts spreadsheet columns', () => {
    expect(columnIndex('A1')).toBe(0)
    expect(columnIndex('Z1')).toBe(25)
    expect(columnIndex('AA1')).toBe(26)
    expect(columnIndex('AU14014')).toBe(46)
  })

  test('parses sparse typed rows and cached values', () => {
    const xml = `
      <worksheet><sheetData>
        <row r="2">
          <c r="A2" t="s"><v>0</v></c>
          <c r="C2"><f>1+1</f><v>2</v></c>
          <c r="D2" t="b"><v>1</v></c>
          <c r="E2"/>
        </row>
      </sheetData></worksheet>`
    const rows = parseSheetXml(xml, ['Colombo'])
    expect(rows[1]).toEqual(['Colombo', undefined, 2, true, null])
  })
})
