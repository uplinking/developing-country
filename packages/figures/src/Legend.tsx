import type { LegendEntry } from './mapStyle'

function Swatch({ color, geometry }: { color: string; geometry: 'fill' | 'line' | 'circle' }) {
  return <span className={`dcf-swatch dcf-swatch--${geometry}`} style={{ ['--swatch' as string]: color }} aria-hidden="true" />
}

export interface LegendGroup {
  id: string
  title: string
  entries: LegendEntry[]
}

/**
 * Map legend plate: one entry per styled, visible layer (built by
 * `buildLegend`), then smaller groups for underlay views, top to bottom.
 */
export function Legend({ entries, secondary = [] }: { entries: LegendEntry[]; secondary?: LegendGroup[] }) {
  return (
    <div className="dcf-legend" aria-label="Legend">
      <LegendEntries entries={entries} />
      {secondary.map((group) => (
        <div key={group.id} className="dcf-legend__secondary" aria-label={`Beneath: ${group.title}`}>
          <p className="dcf-legend__beneath">Beneath · {group.title}</p>
          <LegendEntries entries={group.entries} />
        </div>
      ))}
    </div>
  )
}

function LegendEntries({ entries }: { entries: LegendEntry[] }) {
  return (
    <>
      {entries.map((entry) => (
        <section key={`${entry.layerId}:${entry.kind}`} className="dcf-legend__entry">
          {entry.kind === 'swatch' ? (
            <p className="dcf-legend__row"><Swatch color={entry.color} geometry={entry.geometry} />{entry.title}</p>
          ) : null}
          {entry.kind === 'classes' ? (
            <>
              <h4>{entry.title}</h4>
              <ul>
                {entry.items.map((item) => (
                  <li key={item.label}><Swatch color={item.color} geometry={entry.geometry} />{item.label}</li>
                ))}
              </ul>
            </>
          ) : null}
          {entry.kind === 'ramp' ? (
            <>
              <h4>{entry.title}</h4>
              <span className="dcf-legend__ramp" aria-hidden="true">
                {entry.colors.map((color, index) => <span key={`${color}:${index}`} style={{ background: color }} />)}
              </span>
              <span className="dcf-legend__scale">
                <span>{entry.minLabel}</span>
                {entry.midLabel ? <span>{entry.midLabel}</span> : null}
                <span>{entry.maxLabel}</span>
              </span>
            </>
          ) : null}
          {entry.kind === 'size' ? (
            <>
              <h4>{entry.title}</h4>
              <p className="dcf-legend__sizes">
                <span className="dcf-legend__dot" style={{ width: entry.minRadius * 2, height: entry.minRadius * 2, background: entry.color }} aria-hidden="true" />
                <span>{entry.minLabel}</span>
                <span className="dcf-legend__dot" style={{ width: entry.maxRadius * 2, height: entry.maxRadius * 2, background: entry.color }} aria-hidden="true" />
                <span>{entry.maxLabel}</span>
              </p>
            </>
          ) : null}
        </section>
      ))}
    </>
  )
}
