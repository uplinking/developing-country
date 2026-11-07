import type { Store } from './pipeline'
export class MemoryStore implements Store {
  objects = new Map<string, { body: string; etag: string }>()
  serial = 0
  async get(key: string) {
    const object = this.objects.get(key)
    return object ? { etag: object.etag, arrayBuffer: async () => new TextEncoder().encode(object.body).buffer as ArrayBuffer } : null
  }
  async put(key: string, body: string, options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }) {
    const current = this.objects.get(key); const condition = options?.onlyIf
    if (condition?.etagMatches && current?.etag !== condition.etagMatches) return null
    if (condition?.etagDoesNotMatch === '*' && current) return null
    const object = { body, etag: String(++this.serial) }; this.objects.set(key, object); return object
  }
}
