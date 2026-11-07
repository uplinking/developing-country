import './wordmark.css'

/** The product wordmark, set in the existing Overpass Bold font. */
export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`dc-wordmark ${className}`} role="img" aria-label="dc — Developing Country">dc</span>
}
