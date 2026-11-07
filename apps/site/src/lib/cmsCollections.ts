import { getEmDashCollection } from 'emdash'

/** Walk the CMS cursor so filters and relationships cover the complete published collection. */
export async function publishedEntries(collection: string) {
  const entries: Awaited<ReturnType<typeof getEmDashCollection>>['entries'] = []
  let cursor: string | undefined
  do {
    const page = await getEmDashCollection(collection, {
      status: 'published', orderBy: { published_at: 'desc' }, limit: 100, cursor,
    })
    if (page.error) throw new Error(`Unable to read ${collection}: ${String(page.error)}`)
    entries.push(...page.entries)
    cursor = page.hasMore ? page.nextCursor : undefined
  } while (cursor)
  return entries
}
