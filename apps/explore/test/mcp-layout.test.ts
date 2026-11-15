import { describe, expect, test } from 'bun:test'
import { inlineHeight, safeAreaVars } from '../src/mcpLayout'

describe('MCP App inline frame height', () => {
  test('desktop hosts get the map and data heights the app was tuned for', () => {
    expect(inlineHeight({ containerDimensions: { width: 760, maxHeight: undefined } }, false, 1200)).toBe(480)
    expect(inlineHeight({}, true, 1200)).toBe(640)
  })

  test('a narrow container or a mobile platform gets the phone heights', () => {
    expect(inlineHeight({ containerDimensions: { width: 390 } }, false, 1200)).toBe(360)
    expect(inlineHeight({ platform: 'mobile' }, true, 1200)).toBe(560)
    expect(inlineHeight(undefined, false, 400)).toBe(360)
  })

  test("the host's maxHeight always caps the request", () => {
    expect(inlineHeight({ containerDimensions: { width: 760, maxHeight: 420 } }, true, 1200)).toBe(420)
    expect(inlineHeight({ containerDimensions: { width: 760, maxHeight: 900 } }, true, 1200)).toBe(640)
    expect(inlineHeight({ containerDimensions: { width: 760, maxHeight: 0 } }, false, 1200)).toBe(480)
    expect(inlineHeight({ containerDimensions: { width: 760 } }, true, 1200, 300)).toBe(300)
  })

  test('a fixed container height is taken as given', () => {
    expect(inlineHeight({ containerDimensions: { width: 760, height: 520 } }, true, 1200)).toBe(520)
    expect(inlineHeight({ containerDimensions: { width: 760, height: 0 } }, false, 1200)).toBe(480)
  })

  test('maxWidth decides phone layout when the host gives no width', () => {
    expect(inlineHeight({ containerDimensions: { maxWidth: 400 } }, false, 1200)).toBe(360)
    expect(inlineHeight({ containerDimensions: { maxWidth: 900 } }, false, 400)).toBe(480)
  })
})

describe('MCP App safe-area insets', () => {
  test('a host without insets leaves the stylesheet fallback alone', () => {
    expect(safeAreaVars(undefined)).toEqual([])
    expect(safeAreaVars({})).toEqual([])
  })

  test('insets become rounded, non-negative pixel custom properties', () => {
    expect(safeAreaVars({ safeAreaInsets: { top: 47.4, right: 0, bottom: 34, left: -3 } })).toEqual([
      ['--mcp-safe-top', '47px'],
      ['--mcp-safe-right', '0px'],
      ['--mcp-safe-bottom', '34px'],
      ['--mcp-safe-left', '0px'],
    ])
  })
})
