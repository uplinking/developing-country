import { createElement, use, type ComponentType } from 'react'

/**
 * A code-split component that can be warmed before it renders.
 *
 * React.lazy calls its loader on first render and suspends even when the chunk
 * is already in the module cache, and React holds a Suspense fallback for up
 * to ~300 ms once shown. Once `preload()` has resolved, this renders
 * synchronously; before that it suspends on the same in-flight promise.
 * A failed load is forgotten so the next render or preload retries.
 */
export function preloadable<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  let Loaded: ComponentType<P> | undefined
  let pending: Promise<ComponentType<P>> | undefined

  const preload = () => {
    if (pending) return pending
    const attempt = load().then((m) => (Loaded = m.default))
    // Forget a failed attempt so the next call retries; callers still see the rejection.
    attempt.catch(() => {
      if (pending === attempt) pending = undefined
    })
    return (pending = attempt)
  }

  function Preloadable(props: P) {
    const C = Loaded ?? use(preload())
    return createElement(C, props)
  }

  return Object.assign(Preloadable, { preload })
}
