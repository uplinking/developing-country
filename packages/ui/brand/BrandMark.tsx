import type { MouseEvent } from 'react'
import { Wordmark } from './Wordmark'
import './brand-mark.css'

/**
 * The dc wordmark on its lilac tile, sized for the corner of an embedded
 * surface (MCP App frames). It links home; a host that must route links
 * itself (an MCP Apps iframe) passes onOpen and the click goes through it.
 */
export function BrandMark({
  href = 'https://developing-country.org',
  onOpen,
  className = '',
}: {
  href?: string
  onOpen?: (href: string) => void
  className?: string
}) {
  const onClick = onOpen
    ? (e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault()
        onOpen(href)
      }
    : undefined
  return (
    <a
      className={`dc-brand-mark ${className}`}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={onClick}
      title="developing-country.org"
      aria-label="developing-country.org"
    >
      <Wordmark />
    </a>
  )
}
