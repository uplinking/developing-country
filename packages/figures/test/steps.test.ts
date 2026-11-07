import { describe, expect, test } from 'bun:test'
import { activeStepIndex, stepTriggerLine } from '../src/steps'

describe('activeStepIndex', () => {
  test('starts on the first step before any step reaches the middle', () => {
    expect(activeStepIndex([500, 1200, 1900], 400)).toBe(0)
  })

  test('is the last step whose top has passed the middle', () => {
    expect(activeStepIndex([-900, -200, 380, 1100], 400)).toBe(2)
  })

  test('a fast scroll that jumps several steps lands on the right one', () => {
    // Every step above the middle at once: no intermediate frame needed.
    expect(activeStepIndex([-4000, -3300, -2600, -1900, -1200, -500, 200], 434)).toBe(6)
  })

  test('ignores unmounted steps', () => {
    expect(activeStepIndex([-100, null, 900], 400)).toBe(0)
  })
})

describe('stepTriggerLine', () => {
  test('is the viewport middle when figure and steps sit side by side', () => {
    expect(stepTriggerLine(800, 780, false)).toBe(400)
  })

  test('is halfway down the strip under a pinned figure when stacked', () => {
    expect(stepTriggerLine(812, 500, true)).toBe(656)
  })

  test('falls back to the middle before the figure is measured', () => {
    expect(stepTriggerLine(812, null, true)).toBe(406)
  })
})
