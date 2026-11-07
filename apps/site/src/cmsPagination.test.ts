import { expect, test } from 'bun:test'
import { allCmsItems } from './lib/cmsPagination'

test('CMS sync sees notes beyond the first hundred instead of treating them as missing', async () => {
  const notes = Array.from({ length: 127 }, (_, i) => ({ slug: `dataset-${i}`, status: 'published' }))
  const cursors: (string | undefined)[] = []
  const existing = await allCmsItems(async (cursor) => {
    cursors.push(cursor)
    return cursor ? { items: notes.slice(100) } : { items: notes.slice(0, 100), nextCursor: 'page-two' }
  })
  const slugs = new Set(existing.map(item => item.slug))
  expect(notes.filter(note => !slugs.has(note.slug))).toEqual([])
  expect(cursors).toEqual([undefined, 'page-two'])
})

test('CMS sync stops on a repeated cursor rather than looping or accepting a partial inventory', async () => {
  await expect(allCmsItems(async () => ({ items: [], nextCursor: 'same-page' }))).rejects.toThrow('repeated a pagination cursor')
})
