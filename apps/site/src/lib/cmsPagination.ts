/** Read every CMS page before deciding which content is missing. */
export async function allCmsItems<T>(
  readPage: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string | null }>,
): Promise<T[]> {
  const items: T[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await readPage(cursor)
    if (!Array.isArray(page.items)) throw new Error('CMS list response is missing items')
    items.push(...page.items)
    cursor = page.nextCursor || undefined
    if (cursor && seen.has(cursor)) throw new Error('CMS list repeated a pagination cursor')
    if (cursor) seen.add(cursor)
  } while (cursor)
  return items
}
