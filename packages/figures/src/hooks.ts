import { useEffect, useState, type RefObject } from 'react'
import { FALLBACK_TOKENS, readTokens, type FigureTokens } from './tokens'

function sameTokens(a: FigureTokens, b: FigureTokens): boolean {
  return (Object.keys(a) as Array<keyof FigureTokens>).every((key) => a[key] === b[key])
}

/**
 * Live theme tokens for the element: re-read when `<html data-theme>` changes
 * or the OS colour scheme flips (tokens.css falls back to it when unset).
 */
export function useFigureTokens(ref: RefObject<Element | null>): FigureTokens {
  const [tokens, setTokens] = useState<FigureTokens>(FALLBACK_TOKENS)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => {
      const next = readTokens(element)
      setTokens((previous) => (sameTokens(previous, next) ? previous : next))
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener?.('change', update)
    return () => {
      observer.disconnect()
      media?.removeEventListener?.('change', update)
    }
  }, [ref])
  return tokens
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!media) return
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  return reduced
}

/**
 * True once the element comes within `rootMargin` of the viewport (and stays
 * true). Islands hydrate on page load, so heavy engines (MapLibre, ECharts)
 * wait for this before they are fetched.
 */
export function useNearViewport(ref: RefObject<Element | null>, rootMargin = '600px'): boolean {
  const [near, setNear] = useState(false)
  useEffect(() => {
    if (near) return
    const element = ref.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNear(true)
        observer.disconnect()
      }
    }, { rootMargin })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, rootMargin, near])
  return near
}
