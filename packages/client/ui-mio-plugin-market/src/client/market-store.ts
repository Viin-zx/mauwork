/** Catalog state for the mioagent plugin market tab. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { MioPluginListing } from '@deepseek-ai/dsh-mio-account/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-api-remotes/client'

/** Catalog state shared by the tab's rows. */
export interface MioMarketState {
  /** `idle` until the tab first renders. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly items: readonly MioPluginListing[]
  /** Package names the profile currently declares as installed bundles. */
  readonly installed: readonly string[]
  readonly error: string
}

/** What the market tab receives through injection. */
export interface MioMarketFace {
  readonly hooks: {
    /** Catalog state, bound as `useMarket`. */
    readonly market: SnapshotStore<MioMarketState>
  }
  /** Read the catalog once the tab first renders. */
  readonly ensure: () => void
  /** Read the catalog again after a failure or a profile change. */
  readonly reload: () => void
}

const INITIAL: MioMarketState = { status: 'idle', items: [], installed: [], error: '' }

/** Resolve installed package names from the plugin manager's bundle projection. */
function installedNames(bundles: readonly { readonly name: string; readonly installed: boolean }[]): string[] {
  return bundles.filter(bundle => bundle.installed).map(bundle => bundle.name)
}

/** Owns catalog reads for one Client. */
export class MioMarketController {
  /** Shared catalog state published to the tab. */
  readonly store: SnapshotStore<MioMarketState> = createSnapshotStore(INITIAL)
  private disposed = false
  private generation = 0

  /** @param ctx - the plugin context whose account and plugin-manager Remotes answer. */
  constructor(private readonly ctx: ClientContext) {}

  /** Stop publishing late settlements. */
  dispose(): void {
    this.disposed = true
  }

  /**
   * Build the tab's injected face.
   * @returns the catalog state source and its read actions.
   */
  face(): MioMarketFace {
    return {
      hooks: { market: this.store },
      ensure: () => { if (this.state().status === 'idle') void this.load() },
      reload: () => { void this.load() },
    }
  }

  /** Re-read the catalog after a reconnect when the tab had already loaded it. */
  reset(): void {
    const active = this.state().status !== 'idle'
    this.generation++
    this.store.set(INITIAL)
    if (active) void this.load()
  }

  /** Refresh installed package names after an install, enable, or removal. */
  refreshInstalled(): void {
    void this.loadInstalled()
  }

  private state(): MioMarketState {
    return this.store.getSnapshot()
  }

  private patch(next: Partial<MioMarketState>): void {
    this.store.set({ ...this.state(), ...next })
  }

  private async load(): Promise<void> {
    const generation = ++this.generation
    this.patch({ status: 'loading', error: '' })
    const [plugins, bundles] = await Promise.all([
      this.ctx.remote.mioAccount.listPlugins(),
      this.ctx.remote.pluginManager.listBundles(),
    ])
    if (this.disposed || generation !== this.generation) return
    if (!plugins.ok) {
      this.patch({ status: 'error', error: plugins.error.message })
      return
    }
    if (!bundles.ok) {
      this.patch({ status: 'error', error: bundles.error.message })
      return
    }
    this.patch({
      status: 'ready',
      items: plugins.value,
      installed: installedNames(bundles.value),
      error: '',
    })
  }

  private async loadInstalled(): Promise<void> {
    const generation = this.generation
    const bundles = await this.ctx.remote.pluginManager.listBundles()
    if (this.disposed || generation !== this.generation || !bundles.ok) return
    this.patch({ installed: installedNames(bundles.value) })
  }
}
