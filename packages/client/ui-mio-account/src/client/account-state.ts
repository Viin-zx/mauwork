/** Reconnect-safe login state shared by the gate and the account launcher. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { MioAccountView } from '@deepseek-ai/dsh-mio-account/types'

/** Client projection of the Host login state. */
export interface MioAccountState {
  /** Undefined until the first snapshot arrives. */
  readonly view: MioAccountView | undefined
  /** True after the Host reports that the current session expired or was rejected. */
  readonly expired: boolean
}

/** Observable login state and its stream lifetime. */
export interface MioAccountStateSource {
  readonly state: HostObservable<MioAccountState>
  /** Close both Remote streams and drop subscribers. */
  dispose(): void
}

/**
 * Subscribe to the account snapshot and expiry notification streams.
 * @param ctx - client context carrying the mounted mioAccount Remote.
 * @returns the shared snapshot source.
 */
export function createMioAccountState(ctx: Context): MioAccountStateSource {
  let snapshot: MioAccountState = { view: undefined, expired: false }
  const listeners = new Set<() => void>()
  const publish = (next: MioAccountState): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const views = ctx.remote.$stream<MioAccountView>({
    name: 'mioAccount',
    open: signal => ctx.remote.mioAccount.watch(signal),
    ended: () => new Error('mioagent account stream ended'),
  })
  const expiry = ctx.remote.$stream<'session-expired'>({
    name: 'mioAccountExpiry',
    open: signal => ctx.remote.mioAccount.watchExpiry(signal),
    ended: () => new Error('mioagent account expiry stream ended'),
  })
  const viewLoop = (async () => {
    for await (const frame of views) {
      const view = frame.value
      publish({ view, expired: view.status === 'signed-in' ? false : snapshot.expired })
      frame.accept()
    }
  })()
  const expiryLoop = (async () => {
    // The expiry stream never replays earlier notifications, so a reconnect
    // after a missed expiry keeps the last trusted snapshot.
    for await (const _expiry of expiry) publish({ ...snapshot, expired: true })
  })()
  // A stream failure leaves the last snapshot visible; `$stream` owns reconnection.
  void viewLoop.catch(() => undefined)
  void expiryLoop.catch(() => undefined)
  return {
    state: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    dispose() {
      void views.dispose()
      void expiry.dispose()
      listeners.clear()
    },
  }
}
