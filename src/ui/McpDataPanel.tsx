// MCP App data surface: dataset browser → dataset card → table + chart.
//
// Every navigation is a real tool call through the host (app.callServerTool),
// so what the viewer clicks is exactly what the model could have called, with
// the same provenance. The Worker decides what to suggest (`next`, presets,
// related); this component only renders and dispatches. What the viewer opens
// is mirrored into the model's context so the conversation can pick it up.

import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { App as McpApp } from '@modelcontextprotocol/ext-apps'
import type { JsonObject, JsonValue } from '../shared/json'
import { isJsonNumber, isJsonObject, isJsonString } from '../shared/json'
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

const LiveChart = lazy(() => import('../views/LiveChart'))

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

  const ask = useCallback((text: string) => {
    void app?.sendMessage({ role: 'user', content: [{ type: 'text', text }] })
  }, [app])

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
            onAsk={ask}
            onOpenLink={onOpenLink}
          />
        ) : (
          <TableResult
            state={current}
            onSave={(args) => void call('query_data', args, 'Saving live view')}
            onAsk={ask}
            onOpenLink={onOpenLink}
          />
        )}
        {/* A result ends on its two actions; its next hints stay in the structured result for the model. */}
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

function DatasetCard({ raw, onRun, onOpen, onAsk, onOpenLink }: {
  raw: JsonObject
  onRun: (args: JsonObject, title: string) => void
  onOpen: (id: string, title: string) => void
  onAsk: (text: string) => void
  onOpenLink: (url: string) => void
}) {
  const id = str(raw.dataset_id) ?? str(raw.id) ?? ''
  const title = str(raw.title) ?? id
  const fields = list(raw.fields)
  const presets = list(raw.presets)
  const related = list(raw.related)
  const provenance = isJsonObject(raw.provenance) ? raw.provenance : {}
  const freshness = isJsonObject(provenance.freshness) ? str(provenance.freshness.status) : isJsonObject(raw.freshness) ? str(raw.freshness.status) : undefined
  const time = isJsonObject(raw.time) ? (raw.time.min === raw.time.max ? String(raw.time.min) : `${String(raw.time.min)}–${String(raw.time.max)}`) : undefined
  const publisher = isJsonObject(raw.publisher) ? str(raw.publisher.name) : str(raw.source)
  const isSpatial = !raw.dataset_id || !Array.isArray(raw.presets)
  const vintage = str(provenance.vintage) ?? str(raw.vintage)
  const licence = str(provenance.licence_status) ?? str(raw.licence_status)

  return (
    <article className="mcp-card">
      <h2>{title}</h2>
      {str(raw.question) ? <p className="mcp-card-q">{str(raw.question)}</p> : null}
      <p className="mcp-meta">
        {[publisher, time, str(raw.grain), isJsonNumber(raw.row_count) ? `${raw.row_count} rows` : undefined].filter(Boolean).join(' · ')}
      </p>
      <p className="mcp-meta">
        {[vintage !== time ? vintage : undefined, licence ? `licence ${licence.replace(/_/g, ' ')}` : undefined, freshness ? `freshness ${freshness}` : undefined].filter(Boolean).join(' · ')}
      </p>
      <div className="mcp-card-actions">
        <button type="button" className="btn" onClick={() => onAsk(
          `Research "${title}" (dataset_id ${id}) on developing-country.org${str(raw.question) ? `: ${str(raw.question)}` : ''}. ` +
          'Use get_layer_catalog with this dataset_id, run its presets with query_data, and compare against its related datasets. Cite source and vintage.',
        )}>
          Ask about this
        </button>
        {str(raw.web_url) ? (
          <button type="button" className="mcp-data-link" onClick={() => onOpenLink(str(raw.web_url)!)}>Dataset page ↗</button>
        ) : null}
      </div>

      {presets.length ? (
        <>
          <p className="mcp-label">Ready-made views</p>
          <ul className="mcp-presets">
            {presets.map((p) => {
              const callArgs = isJsonObject(p.call) && isJsonObject(p.call.arguments) ? p.call.arguments : null
              return (
                <li key={str(p.id)}>
                  <button type="button" disabled={!callArgs} onClick={() => callArgs && onRun(callArgs, str(p.title) ?? 'Preset')}>
                    <span className="mcp-roundel" aria-hidden>{(str(p.family) ?? '?').slice(0, 1).toUpperCase()}</span>
                    <span>
                      <strong>{str(p.title)}</strong>
                      <span className="mcp-meta">{str(p.family)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}

      {fields.length ? (
        <>
          <p className="mcp-label">Fields</p>
          <table className="mcp-fields">
            <tbody>
              {fields.map((f) => {
                const values = Array.isArray(f.values) ? f.values.filter(isJsonString) : []
                return (
                  <tr key={str(f.id)}>
                    <th scope="row"><code>{str(f.id)}</code></th>
                    <td>
                      {str(f.label)}
                      {str(f.unit) ? <span className="mcp-meta"> · {str(f.unit)}</span> : null}
                      {values.length ? (
                        <span className="mcp-values">{values.slice(0, 8).join(' · ')}{values.length > 8 ? ` · +${values.length - 8}` : ''}</span>
                      ) : isJsonNumber(f.distinct) ? (
                        <span className="mcp-values">{f.distinct} values, e.g. {Array.isArray(f.examples) ? f.examples.filter(isJsonString).slice(0, 3).join(' · ') : ''}</span>
                      ) : null}
                    </td>
                    <td className="mcp-role">{str(f.role)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      ) : null}

      {related.length ? (
        <>
          <p className="mcp-label">Related datasets</p>
          <ul className="mcp-list mcp-related">
            {related.map((r) => {
              const rid = str(r.dataset_id) ?? ''
              return (
                <li key={rid}>
                  <button type="button" onClick={() => onOpen(rid, str(r.title) ?? rid)}>
                    <strong>{str(r.title) ?? rid}</strong>
                    <span className="mcp-meta">{str(r.why)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}

      {isSpatial ? <p className="mcp-meta">Spatial layer — ask in the chat to put it on the map.</p> : null}
      {Array.isArray(raw.caveats) && raw.caveats.length ? (
        <>
          <p className="mcp-label">Caveats</p>
          {raw.caveats.filter(isJsonString).map((c) => <p key={c} className="mcp-caveat">{c}</p>)}
        </>
      ) : null}
    </article>
  )
}

// ---- Table result --------------------------------------------------------------

function TableResult({ state, onSave, onAsk, onOpenLink }: {
  state: PanelState
  onSave: (args: JsonObject) => void
  onAsk: (text: string) => void
  onOpenLink: (url: string) => void
}) {
  const { raw, args } = state
  const rows = tableRows(raw)
  const fields = tableFields(raw)
  const chart = useMemo(() => chartForTable(raw), [raw])
  const [mode, setMode] = useState<'chart' | 'table'>(chart ? 'chart' : 'table')
  useEffect(() => setMode(chart ? 'chart' : 'table'), [chart])
  const viewUrl = str(raw.view_url)
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

      {/* Provenance travels with the live view and the structured result, not this footer. */}
      <div className="mcp-card-actions mcp-result-actions">
        {viewUrl ? (
          <button type="button" className="btn" onClick={() => onOpenLink(viewUrl)}>Open live view ↗</button>
        ) : chart?.presentation ? (
          <button type="button" className="btn" onClick={() => onSave({ ...args, presentation: chart.presentation! })}>Save live view</button>
        ) : null}
        <button type="button" className="mcp-data-link" onClick={() => onAsk(
          `Interpret this developing-country.org result: ${String(raw.dataset_id)} with ${JSON.stringify(args.where ?? [])} filters (${rows.length} rows). ` +
          'What does it show, what are the caveats, and which related dataset should we check next?',
        )}>
          Interpret
        </button>
      </div>
    </div>
  )
}

// ---- Next steps ----------------------------------------------------------------

function NextList({ steps, hide, onRun }: { steps: NextStep[]; hide: boolean; onRun: (step: NextStep) => void }) {
  // Save suggestions render as the Save button; the card shows presets instead.
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
