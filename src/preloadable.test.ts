import { expect, test } from 'bun:test'
import { preloadable } from './preloadable'

const Dummy = () => null

test('preload loads once and shares the promise', async () => {
  let calls = 0
  const C = preloadable(async () => {
    calls++
    return { default: Dummy }
  })
  const a = C.preload()
  expect(C.preload()).toBe(a)
  expect(await a).toBe(Dummy)
  expect(calls).toBe(1)
})

test('a failed load is retried on the next preload', async () => {
  let calls = 0
  const C = preloadable(async () => {
    if (calls++ === 0) throw new Error('offline')
    return { default: Dummy }
  })
  await expect(C.preload()).rejects.toThrow('offline')
  expect(await C.preload()).toBe(Dummy)
  expect(calls).toBe(2)
})
