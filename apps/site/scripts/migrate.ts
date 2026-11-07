import { claimSchemaSql } from '../src/claimSchemaMigration'
import seed from '../seed/runtime.json'
import { datasetFieldPreflightSql } from '../src/datasetFieldMigration'

const mode = process.argv[2]
if (mode !== '--local' && mode !== '--remote') {
  throw new Error('Usage: bun scripts/migrate.ts --local|--remote')
}

const database = 'developing-country-cms'

async function wrangler(args: string[], capture = false): Promise<string> {
  const child = Bun.spawn(['bun', 'run', 'wrangler', ...args], {
    cwd: import.meta.dir.replace(/\/scripts$/, ''),
    stdin: 'inherit',
    stdout: capture ? 'pipe' : 'inherit',
    stderr: capture ? 'pipe' : 'inherit',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    capture ? new Response(child.stdout).text() : Promise.resolve(''),
    capture ? new Response(child.stderr).text() : Promise.resolve(''),
  ])
  if (exitCode !== 0) {
    if (stderr) process.stderr.write(stderr)
    throw new Error(`wrangler ${args.join(' ')} exited with code ${exitCode}`)
  }
  return stdout
}

type D1Result = Array<{ results?: Array<{ name?: unknown }> }>

const rawColumns = await wrangler([
  'd1', 'execute', database, mode, '--json',
  '--command=SELECT name FROM pragma_table_info(\'ec_articles\')',
], true)
const columnResults = JSON.parse(rawColumns) as D1Result
const existingColumns = new Set(
  columnResults.flatMap((result) => result.results ?? [])
    .map((row) => row.name)
    .filter((name): name is string => typeof name === 'string'),
)

const rawGapColumns = await wrangler([
  'd1', 'execute', database, mode, '--json',
  "--command=SELECT name FROM pragma_table_info('ec_data_gaps')",
], true)
const gapColumns = new Set((JSON.parse(rawGapColumns) as D1Result)
  .flatMap((result) => result.results ?? []).map((row) => row.name)
  .filter((name): name is string => typeof name === 'string'))
const sql = datasetFieldPreflightSql(existingColumns) + claimSchemaSql(seed.collections, existingColumns, gapColumns)
const temporaryFile = `${import.meta.dir}/.dataset-field-preflight-${process.pid}.sql`
await Bun.write(temporaryFile, sql)
try {
  await wrangler(['d1', 'execute', database, mode, '--yes', `--file=${temporaryFile}`])
  await wrangler(['d1', 'migrations', 'apply', database, mode])
} finally {
  await Bun.file(temporaryFile).delete()
}
