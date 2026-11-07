import { useId } from 'react'
import './logo.css'

export interface CountryLogoProps {
  country?: string
  markColor?: string
  countryColor?: string
  font?: 'brush' | 'script' | 'hand' | 'sans' | 'audiowide'
  silhouette?: 'flow' | 'angular' | 'rounded'
  texture?: 'solid' | 'dither'
  belt?: number
  textScale?: number
  textOffset?: number
  showCountry?: boolean
  width?: number | string
  className?: string
}

const fonts = {
  brush: 'DC Kaushan, cursive',
  script: 'DC Pacifico, cursive',
  hand: 'DC Caveat, cursive',
  sans: 'Overpass, sans-serif',
  audiowide: 'DC Audiowide, sans-serif',
}

/** Transparent vector mark with independent, editable country lettering. */
export function CountryLogo({
  country = 'Sri Lanka', markColor = '#5826a6', countryColor = '#fa743f',
  font = 'brush', silhouette = 'flow', texture = 'solid', belt = 0,
  textScale = 1, textOffset = 1, showCountry = true, width = 160, className,
}: CountryLogoProps) {
  const id = useId().replace(/:/g, '')
  const gap = Math.max(0, Math.min(100, belt))
  // Ease the inner tips across both centerlines during the final part of closure.
  const closure = Math.max(0, 1 - gap / 24)
  const tip = 300 + 14 * closure
  const edge = 160 - gap / 2 + 8 * closure
  const paths = {
    flow: `M20 30 H154 C226 30 276 67 ${tip} ${edge} H218 C197 94 178 88 146 88 H128 C84 88 53 63 20 30Z`,
    angular: `M20 30 H148 L${tip} ${edge} H218 L154 88 H78Z`,
    rounded: `M40 30 H154 C236 30 283 75 ${tip} ${edge} H218 C197 94 178 88 146 88 H78 Q40 88 40 50Z`,
  }
  const name = country.trim()
  const fontSize = Math.min(112, 1000 / Math.max(5, [...name].length)) * textScale
  return (
    <svg className={`dc-country-logo ${className ?? ''}`} width={width} viewBox="0 0 640 320"
      role="img" aria-label={`Developing Country${showCountry && name ? ` — ${name}` : ''}`}>
      <defs>
        <filter id={`${id}-text-shadow`} x="-20%" y="-30%" width="140%" height="170%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#000000" floodOpacity="0.22" />
        </filter>
        <pattern id={`${id}-dots`} width="16" height="16" patternUnits="userSpaceOnUse">
          <path fill={markColor} d="M0 0h1v1h-1zM2 0h1v1h-1zM3 0h1v1h-1zM7 0h1v1h-1zM8 0h1v1h-1zM9 0h1v1h-1zM10 0h1v1h-1zM11 0h1v1h-1zM13 0h1v1h-1zM14 0h1v1h-1zM15 0h1v1h-1zM0 1h1v1h-1zM1 1h1v1h-1zM2 1h1v1h-1zM3 1h1v1h-1zM4 1h1v1h-1zM5 1h1v1h-1zM7 1h1v1h-1zM8 1h1v1h-1zM9 1h1v1h-1zM10 1h1v1h-1zM11 1h1v1h-1zM14 1h1v1h-1zM15 1h1v1h-1zM1 2h1v1h-1zM2 2h1v1h-1zM3 2h1v1h-1zM4 2h1v1h-1zM5 2h1v1h-1zM8 2h1v1h-1zM9 2h1v1h-1zM10 2h1v1h-1zM11 2h1v1h-1zM13 2h1v1h-1zM14 2h1v1h-1zM15 2h1v1h-1zM0 3h1v1h-1zM1 3h1v1h-1zM3 3h1v1h-1zM4 3h1v1h-1zM6 3h1v1h-1zM9 3h1v1h-1zM11 3h1v1h-1zM12 3h1v1h-1zM13 3h1v1h-1zM14 3h1v1h-1zM15 3h1v1h-1zM0 4h1v1h-1zM1 4h1v1h-1zM3 4h1v1h-1zM4 4h1v1h-1zM6 4h1v1h-1zM7 4h1v1h-1zM8 4h1v1h-1zM9 4h1v1h-1zM10 4h1v1h-1zM11 4h1v1h-1zM13 4h1v1h-1zM14 4h1v1h-1zM1 5h1v1h-1zM2 5h1v1h-1zM3 5h1v1h-1zM5 5h1v1h-1zM6 5h1v1h-1zM8 5h1v1h-1zM9 5h1v1h-1zM10 5h1v1h-1zM11 5h1v1h-1zM12 5h1v1h-1zM13 5h1v1h-1zM14 5h1v1h-1zM15 5h1v1h-1zM3 6h1v1h-1zM4 6h1v1h-1zM5 6h1v1h-1zM7 6h1v1h-1zM8 6h1v1h-1zM9 6h1v1h-1zM11 6h1v1h-1zM13 6h1v1h-1zM14 6h1v1h-1zM0 7h1v1h-1zM2 7h1v1h-1zM3 7h1v1h-1zM4 7h1v1h-1zM6 7h1v1h-1zM9 7h1v1h-1zM11 7h1v1h-1zM12 7h1v1h-1zM13 7h1v1h-1zM14 7h1v1h-1zM15 7h1v1h-1zM0 8h1v1h-1zM1 8h1v1h-1zM2 8h1v1h-1zM3 8h1v1h-1zM4 8h1v1h-1zM8 8h1v1h-1zM9 8h1v1h-1zM10 8h1v1h-1zM13 8h1v1h-1zM15 8h1v1h-1zM0 9h1v1h-1zM1 9h1v1h-1zM2 9h1v1h-1zM3 9h1v1h-1zM4 9h1v1h-1zM5 9h1v1h-1zM6 9h1v1h-1zM7 9h1v1h-1zM8 9h1v1h-1zM9 9h1v1h-1zM10 9h1v1h-1zM12 9h1v1h-1zM13 9h1v1h-1zM14 9h1v1h-1zM4 10h1v1h-1zM5 10h1v1h-1zM6 10h1v1h-1zM7 10h1v1h-1zM8 10h1v1h-1zM10 10h1v1h-1zM11 10h1v1h-1zM13 10h1v1h-1zM15 10h1v1h-1zM1 11h1v1h-1zM2 11h1v1h-1zM4 11h1v1h-1zM5 11h1v1h-1zM6 11h1v1h-1zM7 11h1v1h-1zM8 11h1v1h-1zM9 11h1v1h-1zM11 11h1v1h-1zM13 11h1v1h-1zM14 11h1v1h-1zM0 12h1v1h-1zM1 12h1v1h-1zM3 12h1v1h-1zM4 12h1v1h-1zM8 12h1v1h-1zM9 12h1v1h-1zM10 12h1v1h-1zM12 12h1v1h-1zM13 12h1v1h-1zM14 12h1v1h-1zM15 12h1v1h-1zM1 13h1v1h-1zM3 13h1v1h-1zM4 13h1v1h-1zM5 13h1v1h-1zM6 13h1v1h-1zM8 13h1v1h-1zM9 13h1v1h-1zM10 13h1v1h-1zM12 13h1v1h-1zM13 13h1v1h-1zM14 13h1v1h-1zM15 13h1v1h-1zM0 14h1v1h-1zM1 14h1v1h-1zM2 14h1v1h-1zM5 14h1v1h-1zM6 14h1v1h-1zM7 14h1v1h-1zM8 14h1v1h-1zM9 14h1v1h-1zM11 14h1v1h-1zM12 14h1v1h-1zM14 14h1v1h-1zM15 14h1v1h-1zM2 15h1v1h-1zM4 15h1v1h-1zM5 15h1v1h-1zM6 15h1v1h-1zM7 15h1v1h-1zM8 15h1v1h-1zM9 15h1v1h-1zM13 15h1v1h-1zM14 15h1v1h-1zM15 15h1v1h-1z" />
        </pattern>
      </defs>
      <g transform="translate(20 0)" fill={texture === 'dither' ? `url(#${id}-dots)` : markColor}>
        <path d={paths[silhouette]} />
        <path d={paths[silhouette]} transform="translate(600 0) scale(-1 1)" />
        <path d={paths[silhouette]} transform="translate(0 320) scale(1 -1)" />
        <path d={paths[silhouette]} transform="translate(600 320) scale(-1 -1)" />
      </g>
      {showCountry && name ? <text x="320" y={190 + textOffset} textAnchor="middle"
        filter={`url(#${id}-text-shadow)`} fill={countryColor} fontFamily={fonts[font]} fontSize={fontSize}
        fontWeight={font === 'hand' || font === 'sans' ? 700 : 400}>{name}</text> : null}
    </svg>
  )
}
