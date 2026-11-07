type DatasetArticleField = {
  column: string
  definition: string
  id: string
  label: string
  type: string
  required: 0 | 1
  validation: string | null
  sortOrder: number
  indexed: 0 | 1
}

const fields: readonly DatasetArticleField[] = [
  {
    column: 'format',
    definition: 'TEXT',
    id: '01M0ZRQH7F6NN8DN7NTR3GV2GS',
    label: 'Format',
    type: 'select',
    required: 1,
    validation: '{"options":["analysis","dataset_note"]}',
    sortOrder: 11,
    indexed: 0,
  },
  {
    column: 'dataset_id',
    definition: 'TEXT',
    id: '01M0ZRQH7J1HZRD9WEETDATRQJ',
    label: 'Dataset ID (data notes only)',
    type: 'string',
    required: 0,
    validation: null,
    sortOrder: 12,
    indexed: 1,
  },
  {
    column: 'dataset_preview_url',
    definition: 'TEXT',
    id: '01M0ZVJPDEYCYKJ3G02MPFQEDK',
    label: 'Dataset preview URL',
    type: 'url',
    required: 0,
    validation: null,
    sortOrder: 13,
    indexed: 0,
  },
]

function sqlText(value: string | null): string {
  return value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`
}

export function datasetFieldPreflightSql(existingColumns: ReadonlySet<string>): string {
  const statements: string[] = []

  for (const field of fields) {
    if (!existingColumns.has(field.column)) {
      statements.push(`ALTER TABLE ec_articles ADD COLUMN ${field.column} ${field.definition}`)
    }

    statements.push(`
INSERT INTO _emdash_fields (
  id, collection_id, slug, label, type, column_type, required, "unique",
  default_value, validation, widget, options, sort_order, searchable,
  translatable, indexed
)
SELECT
  ${sqlText(field.id)}, id, ${sqlText(field.column)}, ${sqlText(field.label)},
  ${sqlText(field.type)}, ${sqlText(field.definition)}, ${field.required}, 0,
  NULL, ${sqlText(field.validation)}, NULL, NULL, ${field.sortOrder}, 0, 1,
  ${field.indexed}
FROM _emdash_collections
WHERE slug = 'articles'
  AND NOT EXISTS (
    SELECT 1 FROM _emdash_fields
    WHERE collection_id = _emdash_collections.id
      AND slug = ${sqlText(field.column)}
  )`.trim())
  }

  if (!existingColumns.has('dataset_id')) {
    statements.push(`
CREATE INDEX IF NOT EXISTS "idx_cf_01m0zrqh7j1hzrd9weetdatrqj"
ON "ec_articles" (("dataset_id" IS NOT NULL), "dataset_id", id)
WHERE deleted_at IS NULL`.trim())
    statements.push(`
CREATE INDEX IF NOT EXISTS "idx_cf_01m0zrqh7j1hzrd9weetdatrqj_loc"
ON "ec_articles" (locale, ("dataset_id" IS NOT NULL), "dataset_id", id)
WHERE deleted_at IS NULL`.trim())
  }

  return `${statements.join(';\n\n')};\n`
}
