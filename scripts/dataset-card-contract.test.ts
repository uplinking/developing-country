import { describe, expect, test } from 'bun:test'
import { PUBLIC_DATA_THEMES, PUBLISHER_TYPES } from '@developing-country/datasets'

const read = (path: string) => Bun.file(path).text()

describe('public dataset cards', () => {
  test('show source-backed metadata without editorial card furniture', async () => {
    const card = await read('apps/site/src/components/DatasetCard.astro')

    expect(card).toContain('Last refreshed on')
    expect(card).toContain('Published by')
    expect(card).toContain('data-publisher-type')
    expect(card).toContain('data-licence-status')
    expect(card).toContain('role="tooltip"')
    expect(card).not.toContain('<dt>Licence')
    expect(card).not.toContain('Read the note')
    expect(card).not.toContain('Data note')
    expect(card).not.toContain('padStart')
  })

  test('lets card content determine row height and exposes the three licence states', async () => {
    const css = await read('apps/site/src/styles/global.css')

    expect(css).not.toMatch(/\.dataset-card > a \{[^}]*aspect-ratio:/s)
    expect(css).not.toContain('min-height: 460px')
    expect(css).toContain('.dataset-card { display: grid;')
    expect(css).not.toMatch(/\.dataset-card > a \{[^}]*height:/s)
    expect(css).toContain("[data-licence-status='permissible']")
    expect(css).toContain("[data-licence-status='questionable']")
    expect(css).toContain("[data-licence-status='restricted']")
  })

  test('anchors every card title to the same row instead of centering by content height', async () => {
    const css = await read('apps/site/src/styles/global.css')

    expect(css).toContain('.dataset-card__body { align-self: start;')
    expect(css).not.toContain('.dataset-card__body { align-self: center;')
  })

  test('gives publisher provenance a consistent label row and metadata row', async () => {
    const css = await read('apps/site/src/styles/global.css')

    expect(css).toContain('grid-template-columns: 1fr; gap: 10px;')
    expect(css).toContain('.dataset-card__provenance dd.dataset-card__provenance-compact { display: grid;')
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) 30px;')
    expect(css).toContain('.dataset-card__publisher { display: grid;')
    expect(css).toContain('grid-template-columns: max-content minmax(0, 1fr);')
    expect(css).not.toContain('.dataset-card__publisher { display: flex;')
  })

  test('provides visible marketplace facets and uses grid gaps for complete rules', async () => {
    const [page, css] = await Promise.all([
      read('apps/site/src/pages/data/index.astro'),
      read('apps/site/src/styles/global.css'),
    ])

    expect(page).toContain('class="data-index__catalogue"')
    expect(page).toContain('class="dataset-filters"')
    expect(page).toContain('data-filter="theme"')
    expect(page).toContain('data-filter="publisher_type"')
    expect(page).toContain('data-filter="publisher"')
    expect(page).toContain('aria-current=')
    expect(page).not.toContain('<select')
    expect(page).not.toContain('Apply filters')
    // The page renders the default tab; the browser script retitles it when the Missing data tab is chosen.
    expect(page).toContain('<h1 id="available-data-title">Available data</h1>')
    expect(page).toContain("byId('available-data-title').textContent = tab === 'missing' ? 'Missing data' : 'Available data'")
    expect(page).not.toContain('data-index__hero')
    expect(page).not.toContain('knownDataGaps')
    expect(page).not.toContain('missing-data')
    expect(css).toContain('.dataset-card-grid')
    expect(css).toContain('grid-template-columns: minmax(240px, 280px) minmax(0, 1fr)')
    expect(css).toContain('position: sticky')
    expect(css).toContain('gap: 1px')
    expect(css).toContain('border: 1px solid var(--report-ink)')
    expect(css).not.toContain('.dataset-card + .dataset-card')
  })

  test('color-codes every category and broad Publisher Type without removing their labels', async () => {
    const css = await read('apps/site/src/styles/global.css')
    const themeBadgeRule = css.match(/\.dataset-card__themes span \{([^}]*)\}/s)?.[1] ?? ''
    const publisherBadgeRule = css.match(/\.dataset-card__publisher > span,\s*\.dataset-note__publisher > span \{([^}]*)\}/s)?.[1] ?? ''

    for (const theme of PUBLIC_DATA_THEMES) {
      expect(css).toContain(`[data-theme='${theme.id}']`)
    }
    for (const type of PUBLISHER_TYPES) {
      expect(css).toContain(`[data-publisher-type='${type.id}']`)
    }
    expect(css).toContain('font-size: 10px')
    expect(css).toContain('.dataset-card__themes { display: flex; min-height: 64px;')
    expect(themeBadgeRule).not.toContain('border:')
    expect(publisherBadgeRule).not.toContain('border:')
  })
})
