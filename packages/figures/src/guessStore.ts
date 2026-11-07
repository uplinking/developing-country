import { useCallback, useSyncExternalStore } from 'react'

/**
 * A reader's guesses live only in their browser: localStorage when available,
 * an in-memory map otherwise (private windows, blocked storage, SSR). Every
 * island on the page shares the module, and a window event keeps separately
 * bundled islands in sync.
 */

const PREFIX = 'dc-guess:'
const EVENT = 'dc-guess'
const memory = new Map<string, number>()

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readGuess(id: string): number | null {
  if (memory.has(id)) return memory.get(id) ?? null
  try {
    const raw = storage()?.getItem(PREFIX + id)
    if (raw === null || raw === undefined) return null
    const parsed = JSON.parse(raw) as { value?: unknown }
    const value = typeof parsed.value === 'number' && Number.isFinite(parsed.value) ? parsed.value : null
    if (value !== null) memory.set(id, value)
    return value
  } catch {
    return null
  }
}

export function writeGuess(id: string, value: number): void {
  memory.set(id, value)
  try {
    storage()?.setItem(PREFIX + id, JSON.stringify({ value, lockedAt: new Date().toISOString() }))
  } catch {
    // Storage full or blocked: the in-memory guess still works for this visit.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: { id, value } }))
}

export function subscribeGuess(id: string, listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ id?: string; value?: number }>).detail
    if (detail?.id !== id) return
    if (typeof detail.value === 'number') memory.set(id, detail.value)
    listener()
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PREFIX + id) return
    memory.delete(id)
    listener()
  }
  window.addEventListener(EVENT, onEvent)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, onEvent)
    window.removeEventListener('storage', onStorage)
  }
}

/** The reader's locked guess for `id` (null until locked), and a setter. */
export function useGuess(id: string | undefined): [number | null, (value: number) => void] {
  const key = id ?? ''
  const subscribe = useCallback((listener: () => void) => (key ? subscribeGuess(key, listener) : () => {}), [key])
  const value = useSyncExternalStore(subscribe, () => (key ? readGuess(key) : null), () => null)
  const set = useCallback((next: number) => { if (key) writeGuess(key, next) }, [key])
  return [value, set]
}
