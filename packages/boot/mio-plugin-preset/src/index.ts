/**
 * Apply mioagent catalog presets to installed plugins and install the catalog
 * defaults once per profile. A newly installed package always receives the
 * catalog preset; startup and later settings events only fill a target that
 * has no user channels. A fresh sign-in or a changed model credential refreshes
 * only the preset-managed channel. A catalog entry whose `autoRefresh` switch
 * the admin turned on is overwritten with the current preset on every sweep,
 * so a model upgrade reaches the client without a reinstall. Small profile-local
 * markers keep the force intent across a restart-required installation and keep
 * a default the person removed afterward removed.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { MioModelAccess, MioPluginCatalogItem } from '@deepseek-ai/dsh-mio-account'
import type {} from './types.ts'
export type * from './types.ts'
export * from './markers.ts'
import type {} from '@deepseek-ai/dsh-hmr'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type {} from '@deepseek-ai/dsh-settings'
import { PENDING_DIRECTORY, appliedPath, defaultsPath, pendingPath, profileOf, readMarkerSet, writeMarkerSet } from './markers.ts'
import { isEmptyTargetUser, PRESET_TARGET_PACKAGES, readPreset, refreshPresetUser, resolvePresetValues } from './preset.ts'

/** Stable plugin name. */
export const name = 'mio-plugin-preset'

/** Services required before the sweep can run. */
export const inject = ['mioAccount', 'settings', 'pluginManager']

/** Startup waits for the Loader and settings entries to settle before reading the catalog. */
const STARTUP_DELAY_MS = 1_500
/** Debounce for installation, settings, and composition events. */
const EVENT_DELAY_MS = 500
/** Last non-secret application failure, kept beside the pending marker for diagnosis. */
const DIAGNOSTIC_FILE = 'last-error.json'
/** Retries after an install while the plugin's settings entry is still activating. */
const PENDING_RETRY_LIMIT = 20
const PENDING_RETRY_MS = 1_000

/** Catalog packages the client installs by default; a removed one is not reinstalled. */
export const DEFAULT_INSTALL_PACKAGES: readonly string[] = [
  'dsh-skill-mcp-panel',
  '@wxg-prc-cpg/browser-skill-dsh-plugin',
]

/** One sweep's installation memory. */
interface SweepState {
  /** Packages installed when the previous sweep ran; undefined before the first. */
  known: Set<string> | undefined
  /** Packages whose next successful application must overwrite user channels. */
  pending: Set<string>
  /** Pending packages installed in this process, whose applied write reloads the renderer. */
  reloadPending: Set<string>
  /** Model access last written per target, so a repeated account event does not rewrite settings. */
  readonly access: Map<string, { readonly credentialVersion: number; readonly baseUrl: string }>
  /** Whether the previous sweep saw a signed-in account; a fresh sign-in re-reads every credential. */
  signedIn: boolean
  /** Default packages installed here or found already present; never installed again after removal. */
  defaults: Set<string>
  /** Whether the persisted defaults marker has been read. */
  defaultsLoaded: boolean
  /** Defaults that failed in this process; the next sign-in or process start retries them. */
  defaultTried: Set<string>
  /** Packages whose preset has been applied; a reinstall after uninstall re-triggers force. */
  applied: Set<string>
}

/** What one catalog entry did, for deciding whether a pending marker can go. */
type ApplyOutcome = 'applied' | 'skipped' | 'retry'

/** One application attempt and the target it wrote. */
interface ApplyResult {
  readonly outcome: ApplyOutcome
  readonly applied: boolean
  readonly target?: string
}

/**
 * Sweep catalog presets on startup and after installation or settings changes.
 * @param ctx - Host context with the account, settings, and plugin manager services.
 */
export function apply(ctx: Context): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let disposed = false
  let retryAttempts = 0
  let accountChanged = false
  /** The first sweep of the process reads the catalog as a startup refresh, overwriting entries the admin switched on. */
  let catalogTick = true
  const state: SweepState = {
    known: undefined, pending: new Set(), reloadPending: new Set(), access: new Map(), signedIn: false,
    defaults: new Set(), defaultsLoaded: false, defaultTried: new Set(), applied: new Set(),
  }

  const schedule = (delayMs = EVENT_DELAY_MS): void => {
    const start = (): void => {
      if (disposed || timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        void sweep()
      }, delayMs)
    }
    // A settings entry publishing during a reload emits its event inside that
    // HMR transaction; a timer created there inherits the context, and the
    // sweep's settings write would be refused as a nested transaction.
    const hmr = ctx.get('hmr')
    if (hmr === undefined) start()
    else hmr.runDetached(start)
  }

  const sweep = async (): Promise<void> => {
    if (running) {
      schedule()
      return
    }
    running = true
    const refresh = accountChanged
    const tick = catalogTick
    accountChanged = false
    try {
      // A sweep that ran before login has no catalog; the startup tick stays
      // armed so the first signed-in sweep still overwrites switched entries.
      if (await sweepCatalog(ctx, state, refresh, tick)) catalogTick = false
    } catch (error) {
      ctx.logger.warn('mio-plugin-preset: catalog sweep failed: %s', messageOf(error))
    } finally {
      running = false
    }
    if (disposed) return
    if (state.pending.size === 0) {
      retryAttempts = 0
      return
    }
    // The settings entry can publish a moment after the install event; retry
    // for a bounded window instead of waiting for an unrelated UI action.
    if (retryAttempts < PENDING_RETRY_LIMIT) {
      retryAttempts += 1
      schedule(PENDING_RETRY_MS)
    } else if (retryAttempts === PENDING_RETRY_LIMIT) {
      retryAttempts += 1
      ctx.logger.warn('mio-plugin-preset: pending installs remain after %s retries', PENDING_RETRY_LIMIT)
    }
  }

  ctx.effect(() => {
    const offChange = ctx.on('plugin-manager/changed', ({ reason }) => {
      if (reason === 'install' || reason === 'bundle' || reason === 'remove') schedule()
    })
    // A delayed entry publication is the only signal for an install that
    // needed a restart; applying cannot reach an inactive settings entry.
    const offSettings = ctx.on('settings/document-updated', () => { schedule() })
    // A sweep that ran before login has no catalog; retry once the account
    // publishes a stored or refreshed session.
    const offAccount = ctx.on('mio-account/changed', () => {
      accountChanged = true
      // A default that failed before this sign-in gets one new attempt.
      state.defaultTried.clear()
      schedule()
    })
    // The catalog itself carries the refresh switch, so the startup sweep
    // reads it and overwrites every entry the admin turned on: a preset tuned
    // while the client was closed arrives at the next launch.
    schedule(STARTUP_DELAY_MS)
    return () => {
      disposed = true
      offChange()
      offSettings()
      offAccount()
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
  }, 'mio-plugin-preset: catalog sweep')
}

/**
 * Apply presets, remember force intent, and overwrite switched entries on the startup tick.
 * @param ctx - the plugin context whose account, settings, and manager services answer.
 * @param state - the sweep's cross-run memory.
 * @param refresh - whether the account had changed since the previous sweep.
 * @param tick - whether this sweep carries the startup catalog refresh.
 * @returns whether the catalog was read; a signed-out sweep leaves the startup tick armed.
 */
async function sweepCatalog(ctx: Context, state: SweepState, refresh: boolean, tick: boolean): Promise<boolean> {
  const session = await ctx.mioAccount.getState()
  if (session.status !== 'signed-in') {
    state.signedIn = false
    return false
  }
  // A new sign-in can rotate the model credential without changing its version, so refresh it.
  if (!state.signedIn) {
    state.access.clear()
    state.signedIn = true
  }
  const bundles = await ctx.pluginManager.listBundles()
  const installed = new Set(bundles.filter(bundle => bundle.installed).map(bundle => bundle.name))
  let pendingChanged = false
  let appliedChanged = false

  if (state.known === undefined) {
    state.known = new Set(installed)
    state.pending = await readPending(ctx)
    state.applied = await readApplied(ctx)
    // A marker loaded from disk belongs to the previous process; its write
    // happens before any settings page can be open, so it needs no reload.
    state.reloadPending = new Set()
    for (const name of [...state.pending]) {
      if (!installed.has(name)) {
        state.pending.delete(name)
        pendingChanged = true
      }
    }
    // A package the previous process uninstalled left a stale applied marker;
    // clear it so a later reinstall re-triggers the force write.
    for (const name of [...state.applied]) {
      if (!installed.has(name)) {
        state.applied.delete(name)
        appliedChanged = true
      }
    }
  } else {
    for (const name of installed) {
      if (!state.known.has(name) && !state.pending.has(name) && !state.applied.has(name)) {
        state.pending.add(name)
        state.reloadPending.add(name)
        pendingChanged = true
      }
    }
    for (const name of [...state.pending]) {
      if (!installed.has(name)) {
        state.pending.delete(name)
        state.reloadPending.delete(name)
        pendingChanged = true
      }
    }
    for (const name of [...state.applied]) {
      if (!installed.has(name) && !state.pending.has(name)) {
        state.applied.delete(name)
        appliedChanged = true
      }
    }
    state.known = new Set(installed)
  }
  // Persist the force intent before applying so a restart-required install
  // still overwrites its target on the next process start.
  if (pendingChanged) await writePending(ctx, state.pending)

  if (!state.defaultsLoaded) {
    state.defaults = await readDefaults(ctx)
    state.defaultsLoaded = true
  }
  const installedDefaults = await installDefaults(ctx, state, installed)
  if (installedDefaults.packages.length > 0) {
    ctx.emit('mio-plugin-preset/defaults-installed', {
      packages: installedDefaults.packages,
      reload: installedDefaults.applied,
    })
  }

  const catalog = await ctx.mioAccount.getPlugins()
  const catalogPackages = new Set(catalog.map(item => item.packageName))
  for (const item of catalog) {
    if (!installed.has(item.packageName)) continue
    try {
      const result = await applyOne(ctx, item, state.pending.has(item.packageName), refresh, tick, state.access)
      if (result.outcome !== 'retry') {
        if (!state.applied.has(item.packageName)) {
          state.applied.add(item.packageName)
          appliedChanged = true
        }
      }
      if (state.pending.has(item.packageName) && result.outcome !== 'retry') {
        const reload = state.reloadPending.delete(item.packageName)
        state.pending.delete(item.packageName)
        pendingChanged = true
        if (reload && result.applied && result.target !== undefined) {
          // Clear the marker before notifying the renderer; a reload while it
          // remains would repeat the forced write and reload on every start.
          await writePending(ctx, state.pending)
          pendingChanged = false
          ctx.emit('mio-plugin-preset/applied', {
            packageName: item.packageName,
            target: result.target,
            reload: true,
          })
        }
      }
    } catch (error) {
      const message = messageOf(error)
      ctx.logger.warn('mio-plugin-preset: %s: %s', item.packageName, message)
      await writeDiagnostic(ctx, item.packageName, message)
    }
  }
  for (const name of [...state.pending]) {
    if (!catalogPackages.has(name)) {
      state.pending.delete(name)
      state.reloadPending.delete(name)
      pendingChanged = true
    }
  }
  if (pendingChanged) {
    await writePending(ctx, state.pending)
  }
  if (appliedChanged) {
    await writeApplied(ctx, state.applied)
  }
  return true
}

/** One defaults pass: packages installed here and whether a reload can load them. */
interface DefaultsResult {
  readonly packages: readonly string[]
  /** True when at least one installation applied without a restart. */
  readonly applied: boolean
}

/**
 * Install the catalog defaults this profile has never handled. A package found
 * already present is recorded as handled so a later removal stays removed.
 * @param ctx - Host context with the plugin manager service.
 * @param state - sweep state carrying the handled and failed sets.
 * @param installed - installed package names, extended with each new default.
 * @returns installed packages and whether a renderer reload applies them.
 */
async function installDefaults(
  ctx: Context, state: SweepState, installed: Set<string>,
): Promise<DefaultsResult> {
  let changed = false
  let applied = false
  const packages: string[] = []
  for (const name of DEFAULT_INSTALL_PACKAGES) {
    if (state.defaults.has(name) || state.defaultTried.has(name)) continue
    if (installed.has(name)) {
      state.defaults.add(name)
      changed = true
      continue
    }
    try {
      const result = await ctx.pluginManager.installBundle(name)
      if (result.application === 'failed' || result.application === 'cancelled') {
        throw new Error(`installation ${result.application}: ${result.error?.code ?? 'unknown'}`)
      }
      state.defaults.add(name)
      installed.add(name)
      packages.push(name)
      changed = true
      if (result.application === 'applied') applied = true
      ctx.logger.info('mio-plugin-preset: installed default plugin %s', name)
    } catch (error) {
      // No retry until the next sign-in or process start: the installation's
      // own change event must not drive a failing pnpm run in a loop.
      state.defaultTried.add(name)
      const message = messageOf(error)
      ctx.logger.warn('mio-plugin-preset: could not install default plugin %s: %s', name, message)
      await writeDiagnostic(ctx, name, message)
    }
  }
  if (changed) await writeDefaults(ctx, state.defaults)
  return { packages, applied }
}

/**
 * Apply one catalog entry; installation force ignores existing user channels,
 * while an account change refreshes only the managed channel's credentials.
 * @param ctx - Host context with account and settings services.
 * @param item - catalog entry carrying the preset.
 * @param force - installation overwrite of the whole target.
 * @param refresh - account-change credential refresh for an existing target.
 * @param tick - catalog re-read that carries an admin-tuned preset to the client.
 * @param accessHistory - model access last written per target.
 * @returns the attempt's outcome and whether it wrote settings.
 */
async function applyOne(
  ctx: Context, item: MioPluginCatalogItem, force: boolean, refresh: boolean, tick: boolean,
  accessHistory: Map<string, { readonly credentialVersion: number; readonly baseUrl: string }>,
): Promise<ApplyResult> {
  const preset = readPreset(item.config)
  if (preset === null) return { outcome: 'skipped', applied: false }
  // An event-driven sweep never overwrites channels the person edited; only a
  // catalog tick does, and only for an entry whose record the admin switched on.
  const overwrite = force || (tick && item.autoRefresh)
  if (PRESET_TARGET_PACKAGES[preset.target] !== item.packageName) {
    throw new Error(`preset target "${preset.target}" belongs to another package`)
  }
  const descriptor = ctx.settings.describe({ redactSecrets: true })
    .find(row => String(row.ns) === preset.target)
  if (descriptor === undefined) return { outcome: 'retry', applied: false }
  const empty = isEmptyTargetUser(descriptor.user)
  if (!overwrite && !refresh && !empty) return { outcome: 'skipped', applied: false }

  let access: Promise<MioModelAccess> | undefined
  const readAccess = (): Promise<MioModelAccess> => access ??= ctx.mioAccount.getModelAccess()
  const resolve = async (placeholder: 'MIO_MODEL_BASE_URL' | 'MIO_API_KEY'): Promise<string> => {
    const value = await readAccess()
    return placeholder === 'MIO_MODEL_BASE_URL' ? value.baseUrl : value.apiKey
  }
  const values = await resolvePresetValues(preset.values, resolve)

  if (!overwrite && !empty) {
    const current = await readAccess()
    const previous = accessHistory.get(preset.target)
    if (previous !== undefined && previous.credentialVersion === current.credentialVersion
      && previous.baseUrl === current.baseUrl) return { outcome: 'skipped', applied: false }
    accessHistory.set(preset.target, { credentialVersion: current.credentialVersion, baseUrl: current.baseUrl })
    const patch = refreshPresetUser(preset.values, values, descriptor.user)
    if (patch === undefined) return { outcome: 'skipped', applied: false }
    await ctx.settings.update(preset.target, patch, descriptor.revision)
    ctx.logger.info('mio-plugin-preset: refreshed credentials for %s', preset.target)
    return { outcome: 'applied', applied: true, target: preset.target }
  }

  if (overwrite) await ctx.settings.replace(preset.target, values, descriptor.revision)
  else await ctx.settings.update(preset.target, values, descriptor.revision)
  const current = await readAccess()
  accessHistory.set(preset.target, { credentialVersion: current.credentialVersion, baseUrl: current.baseUrl })
  ctx.logger.info('mio-plugin-preset: applied %s to %s%s', item.packageName, preset.target, overwrite ? ' (install)' : '')
  return { outcome: 'applied', applied: true, target: preset.target }
}

/** @returns package names whose installation must overwrite the target. */
async function readPending(ctx: Context): Promise<Set<string>> {
  const profile = profileOf(ctx)
  return profile === undefined ? new Set() : readMarkerSet(pendingPath(profile))
}

/** @returns default packages this profile already handled. */
async function readDefaults(ctx: Context): Promise<Set<string>> {
  const profile = profileOf(ctx)
  return profile === undefined ? new Set() : readMarkerSet(defaultsPath(profile))
}

/** Persist handled defaults; a later failure must not reinstall a removed default. */
async function writeDefaults(ctx: Context, defaults: ReadonlySet<string>): Promise<void> {
  const profile = profileOf(ctx)
  if (profile !== undefined) await writeMarkerSet(ctx, defaultsPath(profile), defaults)
}

/** Persist the force intent; failures never block installation. */
async function writePending(ctx: Context, pending: ReadonlySet<string>): Promise<void> {
  const profile = profileOf(ctx)
  if (profile !== undefined) await writeMarkerSet(ctx, pendingPath(profile), pending)
}

/** @returns package names whose preset has been applied. */
async function readApplied(ctx: Context): Promise<Set<string>> {
  const profile = profileOf(ctx)
  return profile === undefined ? new Set() : readMarkerSet(appliedPath(profile))
}

/** Persist the applied set so a reinstall after process restart still re-triggers force. */
async function writeApplied(ctx: Context, applied: ReadonlySet<string>): Promise<void> {
  const profile = profileOf(ctx)
  if (profile !== undefined) await writeMarkerSet(ctx, appliedPath(profile), applied)
}

/** Record a non-secret failure beside the pending marker for local diagnosis. */
async function writeDiagnostic(ctx: Context, packageName: string, message: string): Promise<void> {
  const profile = profileOf(ctx)
  if (profile === undefined) return
  try {
    const directory = join(profile.home, 'storages', PENDING_DIRECTORY)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, DIAGNOSTIC_FILE), JSON.stringify({
      packageName,
      message,
      at: new Date().toISOString(),
    }), 'utf8')
  } catch (error) {
    ctx.logger.warn('mio-plugin-preset: could not write diagnostics: %s', messageOf(error))
  }
}

/** @param error - caught value. @returns a log-safe message without preset values. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
