/** Idempotency-key persistence for one purchase intent. */
import { describe, expect, it, vi } from 'vitest'
import { clearPurchaseIntent, purchaseRequestId, type IntentStorage } from '../src/client/purchase-intent.ts'

const KEY = 'dsh.mio.purchase-intent'

function memoryStorage(initial: Record<string, string> = {}): IntentStorage & { readonly data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  }
}

describe('purchase intent', () => {
  it('reuses the request id for the same plan and starts a new intent for another plan', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    const storage = memoryStorage()

    const first = purchaseRequestId(1, storage)
    expect(first).toBe('mio-11111111111141118111111111111111')
    expect(purchaseRequestId(1, storage)).toBe(first)
    expect(purchaseRequestId(2, storage)).toBe('mio-22222222222242228222222222222222')
  })

  it('replaces a corrupt record and clears the intent', () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify({ requestId: 'bad id', planId: 1 }) })
    expect(purchaseRequestId(1, storage)).toMatch(/^mio-[0-9a-f]+$/u)
    clearPurchaseIntent(storage)
    expect(storage.data.has(KEY)).toBe(false)
  })

  it('keeps working when storage rejects every operation', () => {
    const blocked: IntentStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    expect(purchaseRequestId(1, blocked)).toMatch(/^mio-[0-9a-f]+$/u)
    expect(() => { clearPurchaseIntent(blocked) }).not.toThrow()
  })
})
