import { describe, expect, test } from 'bun:test'
import { lintArticle } from './lint-article.mjs'

const article = (content, fields = {}) => ({ fields: { title: 'Buses stop near offices', dek: 'Short dek.', ...fields }, content })
const rules = (issues, level = 'error') => issues.filter((i) => i.level === level).map((i) => i.rule)

describe('lintArticle', () => {
  test('clean plain prose passes', () => {
    const issues = lintArticle(article(['The lines reach one in five residents.', { h2: 'Offices are far closer to a stop than homes' }]), { figures: {} })
    expect(rules(issues)).toEqual([])
  })

  test('flags machine-made tells', () => {
    const issues = lintArticle(article([
      'This pivotal corridor serves as a testament to planning.',
      'It is not just a bus, but a lifeline.',
      'The map shows the gaps, highlighting the need for change.',
      'The walk is long — very long.',
      '**Residents, not riders.** We counted homes.',
    ]), { figures: {} })
    const found = rules(issues)
    for (const rule of ['inflated significance', 'copula dodge', 'negative parallelism', 'trailing -ing commentary', 'em dash', 'bold lead-in']) {
      expect(found).toContain(rule)
    }
  })

  test('headings and chart titles use sentence case without colons or emoji', () => {
    const issues = lintArticle(
      article([{ h2: 'Where The Lines Reach Most' }, { h2: 'Gaps: a closer look' }, { h2: 'Find your stop 🚌' }]),
      { figures: { a: { presentation: { title: 'Residents Within A Ten Minute Walk' } } } },
    )
    const found = rules(issues)
    expect(found.filter((r) => r === 'title case').length).toBe(2)
    expect(found).toContain('colon heading')
    expect(found).toContain('emoji in heading')
  })

  test('warns on long and number-heavy sentences', () => {
    const long = Array.from({ length: 35 }, () => 'word').join(' ') + '.'
    const issues = lintArticle(article([long, 'Of 3,650 offices, 2,203 are near 110 stops on 7 lines.']), { figures: {} })
    const warned = rules(issues, 'warn')
    expect(warned).toContain('long sentence')
    expect(warned).toContain('number-heavy sentence')
  })

  test('flags colour narration and figures beyond the slide-deck shape', () => {
    const issues = lintArticle(article([
      { _type: 'dcScrolly', steps: [{ view: 'a', text: 'Teal is where you can walk in ten minutes.' }] },
      { _type: 'dcFigure', view: 'b' },
      { _type: 'dcStat', view: 'c' },
      { _type: 'dcStat', view: 'c' },
      { _type: 'dcStat', view: 'c' },
    ]), { figures: {} })
    expect(rules(issues)).toContain('colour narration')
    const budget = issues.filter((i) => i.rule === 'figure budget').map((i) => i.text)
    expect(budget).toEqual(['dcStat', 'dcFigure'])
    expect(rules(lintArticle(article(['Each neighbourhood is shaded by how crowded it is.']), { figures: {} }))).toContain('colour narration')
    expect(rules(lintArticle(article(['The inner north is the most crowded part of the city.']), { figures: {} }))).toEqual([])
  })
})
