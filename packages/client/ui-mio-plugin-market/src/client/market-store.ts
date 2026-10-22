/** Catalog state for the mioagent plugin market tab. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { MioPluginListing } from '@deepseek-ai/dsh-mio-account/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PluginTabInstall } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { gt, valid } from 'semver'
import type {} from '@deepseek-ai/dsh-api-remotes/client'

/** Catalog state shared by the tab's rows. */
export interface MioMarketState {
  /** `idle` until the tab first renders. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly items: readonly MioPluginListing[]
  /** Package names the profile currently declares as installed bundles. */
  readonly installed: readonly string[]
  /** Installed version per package name when the bundle reports one. */
  readonly installedVersions: Readonly<Record<string, string>>
  /** Registry version discovered for each installed package. */
  readonly latestVersions: Readonly<Record<string, string>>
  /** Package whose update removal is in flight. */
  readonly updating: string | null
  /** The last update refusal; `restart-required` is a marker the view localizes. */
  readonly updateError: string
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
  /** Remove an installed package and open the page's install dialog for its latest version. */
  readonly update: (item: MioPluginListing, install: (target: PluginTabInstall) => void) => void
}

const INITIAL: MioMarketState = {
  status: 'idle', items: [], installed: [], installedVersions: {}, latestVersions: {},
  updating: null, updateError: '', error: '',
}

/** Whether the registry version is a valid upgrade over the installed one. */
export function updateAvailable(installed: string | undefined, latest: string | undefined): boolean {
  if (installed === undefined || latest === undefined) return false
  return valid(installed) !== null && valid(latest) !== null && gt(latest, installed)
}

/** Resolve installed package names and versions from the plugin manager's bundle projection. */
function installedOf(bundles: readonly {
  readonly name: string
  readonly installed: boolean
  readonly version?: string
}[]): { names: string[]; versions: Record<string, string> } {
  const names: string[] = []
  const versions: Record<string, string> = {}
  for (const bundle of bundles) {
    if (!bundle.installed) continue
    names.push(bundle.name)
    if (bundle.version !== undefined) versions[bundle.name] = bundle.version
  }
  return { names, versions }
}

/** Owns catalog reads for one Client. */
export class MioMarketController {
  /** Shared catalog state published to the tab. */
  readonly store: SnapshotStore<MioMarketState> = createSnapshotStore(INITIAL)
  private disposed = false
  private generation = 0
  private checkGeneration = 0

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
      update: (item, install) => { void this.update(item, install) },
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
    this.patch({ status: 'loading', error: '', updateError: '' })
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
    const installed = installedOf(bundles.value)
    this.patch({
      status: 'ready',
      items: plugins.value,
      installed: installed.names,
      installedVersions: installed.versions,
      error: '',
    })
    void this.checkUpdates(generation)
  }

  private async loadInstalled(): Promise<void> {
    const generation = this.generation
    const bundles = await this.ctx.remote.pluginManager.listBundles()
    if (this.disposed || generation !== this.generation || !bundles.ok) return
    const installed = installedOf(bundles.value)
    this.patch({ installed: installed.names, installedVersions: installed.versions })
    void this.checkUpdates(generation)
  }

  /** Ask the registry for each installed package's current version. */
  private async checkUpdates(generation: number): Promise<void> {
    const state = this.state()
    if (state.status !== 'ready') return
    const targets = state.items.filter(item => state.installed.includes(item.packageName))
    if (targets.length === 0) {
      this.patch({ latestVersions: {} })
      return
    }
    const check = ++this.checkGeneration
    const results = await Promise.all(targets.map(async (item) => {
      try {
        return { name: item.packageName, result: await this.ctx.remote.pluginManager.inspect(item.packageName) }
      } catch {
        return { name: item.packageName, result: undefined }
      }
    }))
    if (this.disposed || generation !== this.generation || check !== this.checkGeneration) return
    const latest: Record<string, string> = {}
    for (const { name, result } of results) {
      if (result?.ok === true && result.value.status === 'accepted' && result.value.version !== undefined) {
        latest[name] = result.value.version
      }
    }
    this.patch({ latestVersions: latest })
  }

  /** Uninstall one installed package, then hand the latest version to the page's install dialog. */
  private async update(item: MioPluginListing, install: (target: PluginTabInstall) => void): Promise<void> {
    const latest = this.state().latestVersions[item.packageName]
    if (latest === undefined || this.state().updating !== null) return
    this.patch({ updating: item.packageName, updateError: '' })
    try {
      const removed = await this.ctx.remote.pluginManager.removeBundle(item.packageName)
      if (this.disposed) return
      if (!removed.ok) {
        this.patch({ updateError: removed.error.message })
        return
      }
      if (removed.value.application === 'failed' || removed.value.error !== undefined) {
        this.patch({ updateError: removed.value.error?.diagnostic ?? 'update-failed' })
        return
      }
      if (removed.value.application === 'restart-required') {
        this.patch({ updateError: 'restart-required' })
        return
      }
      install({ spec: item.packageName, title: item.pluginName, version: latest })
      this.refreshInstalled()
    } catch (error) {
      if (!this.disposed) {
        this.patch({ updateError: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      if (!this.disposed) this.patch({ updating: null })
    }
  }
}
