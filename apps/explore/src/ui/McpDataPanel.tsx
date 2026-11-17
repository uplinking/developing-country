// MCP App data surface: dataset browser → dataset card → table + chart.
//
// Every navigation is a real tool call through the host (app.callServerTool),
// so what the viewer clicks is exactly what the model could have called, with
// the same provenance. The Worker decides what to suggest (`next`, presets,
// related); this component only renders and dispatches. What the viewer opens
// is mirrored into the model's context so the conversation can pick it up.

import { Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { App as McpApp } from '@modelcontextprotocol/ext-apps'
import type { JsonObject, JsonValue } from '@developing-country/domain/json'
import { isJsonNumber, isJsonObject, isJsonString } from '@developing-country/domain/json'
import {
  chartForTable,
  dataPanelKind,
  errorText,
  modelContextForPanel,
  nextSteps,
  rawFromResult,
  tableFields,
  tableRows,
  type DataPanelKind,
  type NextStep,
} from '../mcpData'
import './McpDataPanel.css'

import { LiveChart } from '../views/lazyViews'

const IN_APP_TOOLS = new Set(['get_layer_catalog', 'query_data'])

interface PanelState {
  kind: DataPanelKind
  raw: JsonObject
  args: JsonObject
}

interface Props {
  app: McpApp | null
  initial: { raw: JsonObject; args: JsonObject }
  onOpenLink: (url: string) => void
  onFullscreen?: () => void
}

function str(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) ? value : undefined
}

function list(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.filter(isJsonObject) : []
}

function formatCell(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return '—'
  if (isJsonNumber(value)) return Number.isInteger(value) ? value.toLocaleString('en-GB') : value.toLocaleString('en-GB', { maximumFractionDigits: 3 })
  return String(value)
}

export default function McpDataPanel({ app, initial, onOpenLink, onFullscreen }: Props) {
  const [stack, setStack] = useState<PanelState[]>(() => {
    const kind = dataPanelKind(initial.raw)
    return kind ? [{ kind, raw: initial.raw, args: initial.args }] : []
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [themes, setThemes] = useState<JsonObject[]>(() => list(initial.raw.themes))

  // A new tool result from the conversation replaces the panel history.
  useEffect(() => {
    const kind = dataPanelKind(initial.raw)
    if (!kind) return
    setStack([{ kind, raw: initial.raw, args: initial.args }])
    setError(null)
    if (Array.isArray(initial.raw.themes)) setThemes(list(initial.raw.themes))
  }, [initial])

  const current = stack.at(-1) ?? null

  const call = useCallback(async (tool: string, args: JsonObject, label: string) => {
    if (!app) return
    setBusy(label)
    setError(null)
    try {
      const result = await app.callServerTool({ name: tool, arguments: args })
      const raw = rawFromResult(result)
      if (result.isError || !raw) {
        setError(errorText(raw))
        return
      }
      // The full catalog shape is never shown raw; fetch the slim index instead.
      if (tool === 'get_layer_catalog' && Array.isArray(raw.layers)) {
        await call('get_layer_catalog', {}, label)
        return
      }
      const kind = dataPanelKind(raw)
      if (!kind) {
        setError('That result belongs on the map. Ask in the chat to show it there.')
        return
      }
      if (Array.isArray(raw.themes)) setThemes(list(raw.themes))
      setStack((s) => [...s, { kind, raw, args }])
      void app.updateModelContext({ content: [{ type: 'text', text: modelContextForPanel(kind, raw) }] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The host declined the call.')
    } finally {
      setBusy(null)
    }
  }, [app])

  const runStep = useCallback((step: NextStep) => {
    if (IN_APP_TOOLS.has(step.tool)) void call(step.tool, step.arguments, step.why)
    else void app?.sendMessage({ role: 'user', content: [{ type: 'text', text: `${step.why}: call ${step.tool} with ${JSON.stringify(step.arguments)}` }] })
  }, [app, call])

  if (!current) return null

  return (
    <section className="mcp-data" aria-busy={busy !== null}>
      <header className="mcp-data-bar">
        {stack.length > 1 ? (
          <button type="button" className="mcp-data-back" onClick={() => { setError(null); setStack((s) => s.slice(0, -1)) }}>
            ← Back
          </button>
        ) : null}
        <span className="mcp-data-crumb">{crumb(current)}</span>
        {current.kind !== 'index' ? (
          <button type="button" className="mcp-data-link" onClick={() => void call('get_layer_catalog', {}, 'All datasets')}>
            All datasets
          </button>
        ) : null}
        {onFullscreen ? (
          <button type="button" className="mcp-data-link" onClick={onFullscreen} aria-label="Toggle fullscreen">⤢</button>
        ) : null}
      </header>

      {busy ? <p className="mcp-data-status" role="status">Loading · {busy}</p> : null}
      {error ? <p className="mcp-data-error" role="alert">{error}</p> : null}

      <div className="mcp-data-body">
        {current.kind === 'index' || current.kind === 'search' ? (
          <Browser
            state={current}
            themes={themes}
            onSearch={(args, label) => void call('get_layer_catalog', args, label)}
            onOpen={(id, title) => void call('get_layer_catalog', { dataset_id: id }, title)}
          />
        ) : current.kind === 'dataset' ? (
          <DatasetCard
            raw={current.raw}
            onRun={(args, title) => void call('query_data', args, title)}
            onOpen={(id, title) => void call('get_layer_catalog', { dataset_id: id }, title)}
            onOpenLink={onOpenLink}
          />
        ) : (
          <TableResult state={current} />
        )}
        {/* A result ends on its chart or table; its next hints stay in the structured result for the model. */}
        <NextList steps={nextSteps(current.raw)} hide={current.kind === 'dataset' || current.kind === 'table'} onRun={runStep} />
      </div>
    </section>
  )
}

function crumb(state: PanelState): string {
  if (state.kind === 'index') return 'Datasets'
  if (state.kind === 'search') {
    const q = isJsonObject(state.raw.query) ? Object.values(state.raw.query).filter(isJsonString).join(' · ') : ''
    return `Search · ${q}`
  }
  if (state.kind === 'dataset') return str(state.raw.title) ?? 'Dataset'
  return str(state.raw.dataset_id) ?? 'Result'
}

// ---- Browser -----------------------------------------------------------------

function Browser({ state, themes, onSearch, onOpen }: {
  state: PanelState
  themes: JsonObject[]
  onSearch: (args: JsonObject, label: string) => void
  onOpen: (id: string, title: string) => void
}) {
  const query = isJsonObject(state.raw.query) ? state.raw.query : {}
  const [q, setQ] = useState(str(query.q) ?? '')
  const activeTheme = str(query.theme)
  const rows = state.kind === 'index' ? list(state.raw.indicator_tables) : list(state.raw.datasets)
  const entities = list(state.raw.spatial_entities)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = q.trim()
    const args: JsonObject = {}
    if (trimmed) {
      args.q = trimmed
      if (activeTheme) args.theme = activeTheme
    }
    onSearch(args, trimmed ? `Search ${trimmed}` : 'All datasets')
  }

  return (
    <div className="mcp-browser">
      <form className="mcp-search" onSubmit={submit} role="search">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search remittances, debt, Jaffna…"
          aria-label="Search datasets"
        />
        <button type="submit" className="btn">Search</button>
      </form>
      {themes.length ? (
        <div className="mcp-themes" role="group" aria-label="Themes">
          {themes.map((t) => {
            const id = str(t.id) ?? ''
            const on = activeTheme === id
            return (
              <button
                key={id}
                type="button"
                className={`mcp-chip${on ? ' on' : ''}`}
                aria-pressed={on}
                title={str(t.label)}
                onClick={() => {
                  const trimmed = q.trim()
                  const args: JsonObject = on ? {} : { theme: id }
                  if (trimmed) args.q = trimmed
                  onSearch(args, str(t.label) ?? id)
                }}
              >
                {id}{isJsonNumber(t.datasets) ? <span>{t.datasets}</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}
      <p className="mcp-label">
        {state.kind === 'index'
          ? `${rows.length} indicator tables · ${entities.length} spatial layers`
          : `${isJsonNumber(state.raw.total) ? state.raw.total : rows.length} matching tables`}
      </p>
      <ul className="mcp-list">
        {rows.map((row) => {
          const id = str(row.dataset_id) ?? ''
          const title = str(row.title) ?? id
          const by = Array.isArray(row.by) ? row.by.filter(isJsonString).filter((l) => l !== 'country') : []
          return (
            <li key={id}>
              <button type="button" onClick={() => onOpen(id, title)}>
                <strong>{title}</strong>
                {str(row.question) ? <span className="mcp-q">{str(row.question)}</span> : null}
                <span className="mcp-meta">
                  {[str(row.publisher), str(row.time), by.length ? `by ${by.join('/')}` : undefined, isJsonNumber(row.rows) ? `${row.rows} rows` : undefined]
                    .filter(Boolean).join(' · ')}
                </span>
                {Array.isArray(row.matching_values) && row.matching_values.length ? (
                  <span className="mcp-meta mcp-match">matches {row.matching_values.filter(isJsonString).slice(0, 2).join(', ')}</span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
      {state.kind === 'search' && entities.length ? (
        <>
          <p className="mcp-label">Spatial layers</p>
          <ul className="mcp-list">
            {entities.map((e) => {
              const id = str(e.entity) ?? ''
              return (
                <li key={id}>
                  <button type="button" onClick={() => onOpen(id, str(e.title) ?? id)}>
                    <strong>{str(e.title) ?? id}</strong>
                    <span className="mcp-meta">{[str(e.geometry), str(e.completeness)].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
    </div>
  )
}

// ---- Dataset card --------------------------------------------------------------

function licenceWords(status: string): string {
  if (status === 'open') return 'Open licence'
  if (status === 'permission_unclear') return 'Reuse terms not stated by the publisher'
  return status.replace(/_/g, ' ')
}

/** A small line drawing of the chart a preset makes. */
function FamilyGlyph({ family }: { family: string | undefined }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const drawing = (() => {
    switch (family) {
      case 'trend': return <polyline {...common} points="3,19 9,12 14,15 21,6" />
      case 'ranking': return <g {...common}><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="15" y2="12" /><line x1="4" y1="18" x2="10" y2="18" /></g>
      case 'distribution': return <polyline {...common} points="3,20 3,14 8,14 8,8 13,8 13,12 18,12 18,17 21,17 21,20" />
      case 'composition': return <g {...common}><rect x="5" y="4" width="14" height="16" /><line x1="5" y1="10" x2="19" y2="10" /><line x1="5" y1="15" x2="19" y2="15" /></g>
      case 'relationship': return <g fill="currentColor"><circle cx="6" cy="17" r="1.8" /><circle cx="10" cy="12" r="1.8" /><circle cx="15" cy="13" r="1.8" /><circle cx="18" cy="7" r="1.8" /></g>
      default: return <g {...common}><line x1="6" y1="20" x2="6" y2="11" /><line x1="12" y1="20" x2="12" y2="5" /><line x1="18" y1="20" x2="18" y2="14" /></g>
    }
  })()
  return <svg className="mcp-glyph" viewBox="0 0 24 24" width="22" height="22" aria-hidden>{drawing}</svg>
}

function shortDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function DatasetCard({ raw, onRun, onOpen, onOpenLink }: {
  raw: JsonObject
  onRun: (args: JsonObject, title: string) => void
  onOpen: (id: string, title: string) => void
  onOpenLink: (url: string) => void
}) {
  const id = str(raw.dataset_id) ?? str(raw.id) ?? ''
  const title = str(raw.title) ?? id
  const fields = list(raw.fields)
  const presets = list(raw.presets)
  // Map layers relate by entity id only; show the ones a reader can name.
  const related = list(raw.related).filter((r) => str(r.title) && str(r.dataset_id))
  const provenance = isJsonObject(raw.provenance) ? raw.provenance : {}
  const source = list(provenance.sources)[0] ?? list(raw.sources)[0]
  const time = isJsonObject(raw.time) ? (raw.time.min === raw.time.max ? String(raw.time.min) : `${String(raw.time.min)}–${String(raw.time.max)}`) : undefined
  const publisher = isJsonObject(raw.publisher) ? str(raw.publisher.name) : (source ? str(source.publisher) : undefined) ?? str(raw.source)
  const isSpatial = !raw.dataset_id || !Array.isArray(raw.presets)
  const vintage = str(provenance.vintage) ?? str(raw.vintage)
  const licence = str(provenance.licence_status) ?? str(raw.licence_status)
  const refreshed = shortDate(str(provenance.refreshed_at) ?? str(raw.refreshed_at))
  const caveats = Array.isArray(raw.caveats) ? raw.caveats.filter(isJsonString) : []
  const webUrl = str(raw.web_url)
  const sourceUrl = source ? str(source.url) : str(raw.source_url)
  const facts = [time, isJsonNumber(raw.row_count) ? `${raw.row_count.toLocaleString('en-GB')} rows` : undefined].filter(Boolean)
  // A layer's description is written for the model; its first sentence is the plain one.
  const subtitle = str(raw.question) ?? (isSpatial ? str(raw.description)?.split(/(?<=\.)\s/)[0] : undefined)
  const about: Array<[string, string]> = []
  const sourceName = source ? str(source.name) : undefined
  if (str(raw.grain)) about.push(['Each row', str(raw.grain)!])
  if (vintage && vintage !== time) about.push(['Edition', vintage])
  if (refreshed) about.push(['Updated', refreshed])
  if (licence) about.push(['Licence', licenceWords(licence)])

  return (
    <article className="mcp-card">
      <header className="mcp-card-head">
        <h2>{title}</h2>
        {subtitle ? <p className="mcp-card-q">{subtitle}</p> : null}
        {publisher ? <p className="mcp-card-publisher">{publisher}</p> : null}
        <p className="mcp-card-facts">
          {facts.map((fact) => <span key={fact}>{fact}</span>)}
          {webUrl ? <button type="button" className="mcp-inline-link" onClick={() => onOpenLink(webUrl)}>Dataset page ↗</button> : null}
        </p>
      </header>

      {presets.length ? (
        <section className="mcp-card-section">
          <p className="mcp-label">Start with a chart</p>
          <ul className="mcp-presets">
            {presets.map((p) => {
              const callArgs = isJsonObject(p.call) && isJsonObject(p.call.arguments) ? p.call.arguments : null
              return (
                <li key={str(p.id)}>
                  <button type="button" disabled={!callArgs} onClick={() => callArgs && onRun(callArgs, str(p.title) ?? 'Preset')}>
                    <FamilyGlyph family={str(p.family)} />
                    <span className="mcp-preset-text">
                      <strong>{str(p.title)}</strong>
                      {str(p.description) ? <span>{str(p.description)}</span> : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {isSpatial ? <p className="mcp-card-note">This is a map layer. Ask in the chat to put it on the map.</p> : null}

      {related.length ? (
        <section className="mcp-card-section">
          <p className="mcp-label">Related</p>
          <ul className="mcp-related">
            {related.slice(0, 6).map((r) => {
              const rid = str(r.dataset_id) ?? ''
              return (
                <li key={rid}>
                  <button type="button" onClick={() => onOpen(rid, str(r.title) ?? rid)}>{str(r.title) ?? rid}</button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {about.length || caveats.length || sourceName || fields.length ? (
        <details className="mcp-about">
          <summary>About this data{caveats.length ? <span className="mcp-meta"> · {caveats.length} {caveats.length === 1 ? 'caveat' : 'caveats'}</span> : null}</summary>
          {sourceName ? (
            <p className="mcp-about-source">
              {sourceUrl ? <button type="button" className="mcp-inline-link" onClick={() => onOpenLink(sourceUrl)}>{sourceName} ↗</button> : sourceName}
            </p>
          ) : null}
          {about.length ? (
            <dl className="mcp-about-facts">
              {about.map(([term, value]) => (
                <div key={term}><dt>{term}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          ) : null}
          {caveats.length ? (
            <ul className="mcp-caveats">
              {caveats.map((c) => <li key={c}>{c}</li>)}
            </ul>
          ) : null}
          {fields.length ? (
            <>
              <p className="mcp-label">Fields</p>
              <ul className="mcp-fields">
                {fields.map((f) => {
                  const values = Array.isArray(f.values) ? f.values.filter(isJsonString) : []
                  return (
                    <li key={str(f.id)} title={str(f.id)}>
                      <strong>{str(f.label) ?? str(f.id)}</strong>
                      {str(f.unit) ? <span className="mcp-meta"> · {str(f.unit)}</span> : null}
                      {values.length ? (
                        <span className="mcp-values">{values.slice(0, 6).join(', ')}{values.length > 6 ? ` and ${values.length - 6} more` : ''}</span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </>
          ) : null}
        </details>
      ) : null}
    </article>
  )
}

// ---- Table result --------------------------------------------------------------

function TableResult({ state }: { state: PanelState }) {
  const { raw } = state
  const rows = tableRows(raw)
  const fields = tableFields(raw)
  const chart = useMemo(() => chartForTable(raw), [raw])
  const [mode, setMode] = useState<'chart' | 'table'>(chart ? 'chart' : 'table')
  useEffect(() => setMode(chart ? 'chart' : 'table'), [chart])
  const total = isJsonNumber(raw.total_count) ? raw.total_count : rows.length

  return (
    <div className="mcp-table-result">
      <div className="mcp-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'chart'} disabled={!chart} onClick={() => setMode('chart')}>Chart</button>
        <button type="button" role="tab" aria-selected={mode === 'table'} onClick={() => setMode('table')}>Table</button>
        <span className="mcp-meta">{rows.length}{total > rows.length ? ` of ${total}` : ''} rows</span>
      </div>

      {mode === 'chart' && chart ? (
        <div className="mcp-chart-frame">
          <Suspense fallback={<p className="mcp-data-status">Preparing chart…</p>}>
            <LiveChart view={chart.spec} rows={rows} />
          </Suspense>
        </div>
      ) : (
        <div className="mcp-grid-wrap">
          <table className="mcp-grid">
            <thead>
              <tr>{fields.map((f) => <th key={f.id} scope="col" title={f.id}>{f.label}{f.unit ? <span className="mcp-meta"> {f.unit}</span> : null}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {fields.map((f) => (
                    <td key={f.id} className={isJsonNumber(row[f.id]) ? 'num' : undefined}>{formatCell(row[f.id])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---- Next steps ----------------------------------------------------------------

function NextList({ steps, hide, onRun }: { steps: NextStep[]; hide: boolean; onRun: (step: NextStep) => void }) {
  // Saving a view is the user's call through the model, never a one-click step.
  const visible = hide ? [] : steps.filter((s) => !isJsonObject(s.arguments.presentation))
  if (!visible.length) return null
  return (
    <nav className="mcp-next" aria-label="Suggested next steps">
      <p className="mcp-label">Next</p>
      {visible.map((step, i) => (
        <button key={i} type="button" className="mcp-next-step" onClick={() => onRun(step)}>
          <span aria-hidden>»</span> {step.why}
        </button>
      ))}
    </nav>
  )
}
