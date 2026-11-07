import { createHash } from 'node:crypto'

interface Field { slug: string; label: string; type: string; required?: boolean; validation?: unknown; options?: unknown }
interface Collection { slug: string; label: string; labelSingular?: string; supports?: string[]; fields: Field[] }
const articleFields = new Set(['analysis_kind', 'claim_status', 'claim_source_title', 'claim_source_url', 'claim_reported_at', 'missing_data'])
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
const identifier = (value: string) => {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe schema identifier: ${value}`)
  return value
}
const stableId = (value: string) => `01${createHash('sha256').update(value).digest('hex').slice(0, 24).toUpperCase()}`

/** Upgrade existing EmDash installations from the same schema used for fresh seeds. No editorial writes. */
export function claimSchemaSql(collections: Collection[], articleColumns: ReadonlySet<string>, gapColumns: ReadonlySet<string>): string {
  const sql: string[] = []
  for (const collection of collections.filter((c) => c.slug === 'articles' || c.slug === 'data_gaps')) {
    const slug = identifier(collection.slug)
    const fields = collection.fields.filter((f) => slug === 'data_gaps' || articleFields.has(f.slug))
    if (slug === 'data_gaps') {
      sql.push(`INSERT INTO _emdash_collections (id, slug, label, label_singular, supports) SELECT ${quote(stableId(slug))}, 'data_gaps', ${quote(collection.label)}, ${quote(collection.labelSingular || collection.label)}, ${quote(JSON.stringify(collection.supports))} WHERE NOT EXISTS (SELECT 1 FROM _emdash_collections WHERE slug = 'data_gaps')`)
      sql.push(`CREATE TABLE IF NOT EXISTS ec_data_gaps (
        id TEXT PRIMARY KEY, slug TEXT, status TEXT DEFAULT 'draft', author_id TEXT, primary_byline_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        published_at TEXT, scheduled_at TEXT, deleted_at TEXT, version INTEGER DEFAULT 1,
        live_revision_id TEXT REFERENCES revisions(id), draft_revision_id TEXT REFERENCES revisions(id),
        locale TEXT NOT NULL DEFAULT 'en', translation_group TEXT,
        ${fields.map((f) => `${identifier(f.slug)} TEXT`).join(', ')}, UNIQUE(slug, locale)
      )`)
      for (const column of ['slug', 'live_revision_id', 'draft_revision_id', 'translation_group']) {
        sql.push(`CREATE INDEX IF NOT EXISTS idx_ec_data_gaps_${column} ON ec_data_gaps (${column})`)
      }
      sql.push('CREATE INDEX IF NOT EXISTS idx_ec_data_gaps_published ON ec_data_gaps (deleted_at, status, published_at DESC, id DESC)')
    }
    for (const [index, field] of fields.entries()) {
      const column = identifier(field.slug)
      const existing = slug === 'articles' ? articleColumns : gapColumns
      if ((slug === 'articles' || gapColumns.size > 0) && !existing.has(column)) sql.push(`ALTER TABLE ec_${slug} ADD COLUMN ${column} TEXT`)
      const columnType = ['json', 'multiSelect'].includes(field.type) ? 'JSON' : 'TEXT'
      sql.push(`INSERT INTO _emdash_fields (id, collection_id, slug, label, type, column_type, required, "unique", validation, options, sort_order, searchable, translatable, indexed)
        SELECT ${quote(stableId(`${slug}.${column}`))}, id, ${quote(column)}, ${quote(field.label)}, ${quote(field.type)}, ${quote(columnType)}, ${field.required ? 1 : 0}, 0,
        ${field.validation ? quote(JSON.stringify(field.validation)) : 'NULL'}, ${field.options ? quote(JSON.stringify(field.options)) : 'NULL'}, ${slug === 'articles' ? 20 + index : index}, 0, 1, 0
        FROM _emdash_collections WHERE slug = ${quote(slug)} AND NOT EXISTS (SELECT 1 FROM _emdash_fields WHERE collection_id = _emdash_collections.id AND slug = ${quote(column)})`)
    }
  }
  return `${sql.join(';\n\n')};\n`
}
