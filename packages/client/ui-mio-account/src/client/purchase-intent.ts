/** Request-id persistence for one purchase intent. */

/** Storage key holding the selected plan and its idempotency key. */
const STORAGE_KEY = 'dsh.mio.purchase-intent'

/** Stored purchase intent. */
interface PurchaseIntent {
  readonly requestId: string
  readonly planId: number
}

/** Storage subset these helpers use; tests pass an in-memory object. */
export type IntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function browserStorage(): IntentStorage | undefined {
  try { return globalThis.localStorage } catch { return undefined }
}

function parseIntent(raw: string | null | undefined): PurchaseIntent | undefined {
  if (raw === null || raw === undefined) return undefined
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || !('requestId' in parsed) || !('planId' in parsed)) {
    return undefined
  }
  const { requestId, planId } = parsed
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(requestId) || typeof planId !== 'number') {
    return undefined
  }
  return { requestId, planId }
}

function readIntent(storage: IntentStorage | undefined): PurchaseIntent | undefined {
  try {
    return parseIntent(storage?.getItem(STORAGE_KEY))
  } catch (_error) {
    // Unreadable storage starts a fresh intent instead of failing the purchase.
    return undefined
  }
}

function writeIntent(storage: IntentStorage | undefined, intent: PurchaseIntent): void {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(intent)) } catch (_error) { /* storage unavailable */ }
}

function removeIntent(storage: IntentStorage | undefined): void {
  try { storage?.removeItem(STORAGE_KEY) } catch (_error) { /* storage unavailable */ }
}

/**
 * Return the persisted request id for this plan, creating one when the intent changed.
 * @param planId - selected plan.
 * @param storage - storage override for tests.
 * @returns an idempotency key valid for one purchase intent.
 */
export function purchaseRequestId(planId: number, storage: IntentStorage | undefined = browserStorage()): string {
  const existing = readIntent(storage)
  if (existing !== undefined && existing.planId === planId) return existing.requestId
  const requestId = `mio-${globalThis.crypto.randomUUID().replaceAll('-', '')}`
  writeIntent(storage, { requestId, planId })
  return requestId
}

/**
 * Forget the current purchase intent after payment, cancellation, or expiry.
 * @param storage - storage override for tests.
 */
export function clearPurchaseIntent(storage: IntentStorage | undefined = browserStorage()): void {
  removeIntent(storage)
}
