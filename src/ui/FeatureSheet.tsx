import { useState } from 'react'
import type { FeatureInfo, FeatureRow } from '../types'

interface FeatureSheetProps {
  info: FeatureInfo | null
  onClose: () => void
}

function Rows({ items }: { items: FeatureRow[] }) {
  return (
    <dl className="feature-rows">
      {items.map((r, i) => (
        <div key={`${r.label}-${i}`} className="feature-row">
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Section heading with the provenance tucked behind a small "i" popover, so a
 * long source string never widens the sheet. */
function SectionHead({ title, source }: { title: string; source?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="feature-section-head">
      <h3>{title}</h3>
      {source && (
        <div className="info-corner">
          <button
            className={`info-btn${open ? ' open' : ''}`}
            aria-label="Data source"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            onBlur={() => setOpen(false)}
          >
            i
          </button>
          {open && (
            <div className="info-pop" role="dialog">
              <div className="info-src">{source}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function FeatureSheet({ info, onClose }: FeatureSheetProps) {
  if (!info) return null
  return (
    <div className="feature-sheet">
      {/* The head IS the nameboard band: kind + title reversed out of ink,
          route tab on the leading edge (CSS). */}
      <div className="feature-head">
        <div>
          <span className="feature-kind">{info.groupLabel}</span>
          <h2 className="feature-title">{info.title}</h2>
        </div>
        <button className="feature-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {info.image && (
        <img className="feature-image" src={info.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
      )}

      {info.blurb && <p className="feature-blurb">{info.blurb}</p>}

      {info.timeline && info.timeline.length > 0 && (
        <ol className="timeline">
          {info.timeline.map((step, i) => (
            <li key={step.label} className={`tl-step tl-${step.state}`}>
              <span className="tl-dot" aria-hidden="true">{i + 1}</span>
              <span className="tl-label">{step.label}</span>
              {step.date && <span className="tl-date">{step.date}</span>}
            </li>
          ))}
        </ol>
      )}

      {info.rows.length > 0 && <Rows items={info.rows} />}

      {info.sections && info.sections.length > 0 && (
        <div className="feature-sections">
          {info.sections.map((s) => (
            <section key={s.title} className="feature-section">
              <SectionHead title={s.title} source={s.source} />
              {s.rows.length > 0 ? (
                <Rows items={s.rows} />
              ) : (
                <p className="feature-section-empty">{s.empty ?? 'None nearby.'}</p>
              )}
            </section>
          ))}
        </div>
      )}

      {info.links && info.links.length > 0 && (
        <div className="feature-links">
          {info.links.map((l) => (
            <a
              key={l.url}
              className="feature-link btn"
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {l.label}
            </a>
          ))}
        </div>
      )}

      {info.link && (
        <div className="feature-links">
          <a className="feature-link btn" href={info.link.url} target="_blank" rel="noopener noreferrer">
            {info.link.label}
          </a>
        </div>
      )}

      {info.attribution && (
        <a
          className="feature-attribution"
          href={info.attribution.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {info.attribution.label}
        </a>
      )}

      <div className="feature-coords">
        {info.lngLat.lat.toFixed(5)}, {info.lngLat.lng.toFixed(5)}
      </div>
    </div>
  )
}
