/**
 * Apply mioagent catalog presets to installed plugins. A newly installed
 * package always receives the catalog preset; startup and later settings
 * events only fill a target that has no user channels. A fresh sign-in or a
 * changed model credential refreshes only the preset-managed channel. A small
 * profile-local marker keeps the force intent across a restart-required
 * installation.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { MioModelAccess, MioPluginCatalogItem } from '@deepseek-ai/dsh-mio-account'
import type {} from './types.ts'
export type * from './types.ts'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type {} from '@deepseek-ai/dsh-settings'
import { isEmptyTargetUser, PRESET_TARGET_PACKAGES, readPreset, refreshPresetUser, resolvePresetValues } from './preset.ts'

/** Stable plugin name. */
export const name = 'mio-plugin-preset'

/** Services required before the sweep can run. */
export const inject = ['mioAccount', 'settings', 'pluginManager']

/** Startup waits for the Loader and settings entries to settle before reading the catalog. */
const STARTUP_DELAY_MS = 1_500
/** Debounce for installation, settings, and composition events. */
const EVENT_DELAY_MS = 500
/** Profile-local file naming packages whose installation must overwrite their preset target. */
const PENDING_DIRECTORY = 'mio-plugin-preset'
const PENDING_FILE = 'pending.json'
/** Last non-secret application failure, kept beside the pending marker for diagnosis. */
const DIAGNOSTIC_FILE = 'last-error.json'
/** Retries after an install while the plugin's settings entry is still activating. */
const PENDING_RETRY_LIMIT = 20
const PENDING_RETRY_MS = 1_000

/** The subset of the profile context this plugin needs. */
interface ProfileLike {
  readonly name: string
  readonly home: string
}

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
  const state: SweepState = {
    known: undefined, pending: new Set(), reloadPending: new Set(), access: new Map(), signedIn: false,
  }

  const schedule = (delayMs = EVENT_DELAY_MS): void => {
    if (disposed || timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      void sweep()
    }, delayMs)
  }

  const sweep = async (): Promise<void> => {
    if (running) {
      schedule()
      return
    }
    running = true
    const refresh = accountChanged
    accountChanged = false
    try {
      await sweepCatalog(ctx, state, refresh)
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
      if (reason === 'install' || reason === 'bundle') schedule()
    })
    // A delayed entry publication is the only signal for an install that
    // needed a restart; applying cannot reach an inactive settings entry.
    const offSettings = ctx.on('settings/document-updated', () => { schedule() })
    // A sweep that ran before login has no catalog; retry once the account
    // publishes a stored or refreshed session.
    const offAccount = ctx.on('mio-account/changed', () => {
      accountChanged = true
      schedule()
    })
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

/** Apply presets and remember installations that must overwrite their target. */
async function sweepCatalog(ctx: Context, state: SweepState, refresh: boolean): Promise<void> {
  const session = await ctx.mioAccount.getState()
  if (session.status !== 'signed-in') {
    state.signedIn = false
    return
  }
  // A new sign-in can rotate the model credential without changing its version, so refresh it.
  if (!state.signedIn) {
    state.access.clear()
    state.signedIn = true
  }
  const [catalog, bundles] = await Promise.all([
    ctx.mioAccount.getPlugins(),
    ctx.pluginManager.listBundles(),
  ])
  const installed = new Set(bundles.filter(bundle => bundle.installed).map(bundle => bundle.name))
  let pendingChanged = false

  if (state.known === undefined) {
    state.known = new Set(installed)
    state.pending = await readPending(ctx)
    // A marker loaded from disk belongs to the previous process; its write
    // happens before any settings page can be open, so it needs no reload.
    state.reloadPending = new Set()
    for (const name of [...state.pending]) {
      if (!installed.has(name)) {
        state.pending.delete(name)
        pendingChanged = true
      }
    }
  } else {
    for (const name of installed) {
      if (!state.known.has(name) && !state.pending.has(name)) {
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
    state.known = new Set(installed)
  }
  // Persist the force intent before applying so a restart-required install
  // still overwrites its target on the next process start.
  if (pendingChanged) await writePending(ctx, state.pending)

  const catalogPackages = new Set(catalog.map(item => item.packageName))
  for (const item of catalog) {
    if (!installed.has(item.packageName)) continue
    try {
      const result = await applyOne(ctx, item, state.pending.has(item.packageName), refresh, state.access)
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
  if (pendingChanged) await writePending(ctx, state.pending)
}

/**
 * Apply one catalog entry; installation force ignores existing user channels,
 * while an account change refreshes only the managed channel's credentials.
 * @param ctx - Host context with account and settings services.
 * @param item - catalog entry carrying the preset.
 * @param force - installation overwrite of the whole target.
 * @param refresh - account-change credential refresh for an existing target.
 * @param accessHistory - model access last written per target.
 * @returns the attempt's outcome and whether it wrote settings.
 */
async function applyOne(
  ctx: Context, item: MioPluginCatalogItem, force: boolean, refresh: boolean,
  accessHistory: Map<string, { readonly credentialVersion: number; readonly baseUrl: string }>,
): Promise<ApplyResult> {
  const preset = readPreset(item.config)
  if (preset === null) return { outcome: 'skipped', applied: false }
  if (PRESET_TARGET_PACKAGES[preset.target] !== item.packageName) {
    throw new Error(`preset target "${preset.target}" belongs to another package`)
  }
  const descriptor = ctx.settings.describe({ redactSecrets: true })
    .find(row => String(row.ns) === preset.target)
  if (descriptor === undefined) return { outcome: 'retry', applied: false }
  const empty = isEmptyTargetUser(descriptor.user)
  if (!force && !refresh && !empty) return { outcome: 'skipped', applied: false }

  let access: Promise<MioModelAccess> | undefined
  const readAccess = (): Promise<MioModelAccess> => access ??= ctx.mioAccount.getModelAccess()
  const resolve = async (placeholder: 'MIO_MODEL_BASE_URL' | 'MIO_API_KEY'): Promise<string> => {
    const value = await readAccess()
    return placeholder === 'MIO_MODEL_BASE_URL' ? value.baseUrl : value.apiKey
  }
  const values = await resolvePresetValues(preset.values, resolve)

  if (!force && !empty) {
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

  if (force) await ctx.settings.replace(preset.target, values, descriptor.revision)
  else await ctx.settings.update(preset.target, values, descriptor.revision)
  const current = await readAccess()
  accessHistory.set(preset.target, { credentialVersion: current.credentialVersion, baseUrl: current.baseUrl })
  ctx.logger.info('mio-plugin-preset: applied %s to %s%s', item.packageName, preset.target, force ? ' (install)' : '')
  return { outcome: 'applied', applied: true, target: preset.target }
}

/** Resolve the active profile without requiring its service type in this package. */
function profileOf(ctx: Context): ProfileLike | undefined {
  const profile = ctx.get('profileContext') as ProfileLike | undefined
  return profile !== undefined && typeof profile.home === 'string' && typeof profile.name === 'string'
    ? profile
    : undefined
}

/** @returns package names whose installation must overwrite the target. */
async function readPending(ctx: Context): Promise<Set<string>> {
  const profile = profileOf(ctx)
  if (profile === undefined) return new Set()
  try {
    const raw: unknown = JSON.parse(await readFile(pendingPath(profile), 'utf8'))
    return new Set(Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Persist the force intent; failures never block installation. */
async function writePending(ctx: Context, pending: ReadonlySet<string>): Promise<void> {
  const profile = profileOf(ctx)
  if (profile === undefined) return
  try {
    const path = pendingPath(profile)
    await mkdir(join(profile.home, 'storages', PENDING_DIRECTORY), { recursive: true })
    const temporary = `${path}.tmp`
    await writeFile(temporary, JSON.stringify([...pending]), 'utf8')
    await rename(temporary, path)
  } catch (error) {
    ctx.logger.warn('mio-plugin-preset: could not persist pending installs: %s', messageOf(error))
  }
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

/** @returns the profile-local pending marker path. */
function pendingPath(profile: ProfileLike): string {
  return join(profile.home, 'storages', PENDING_DIRECTORY, `${profile.name}.${PENDING_FILE}`)
}

/** @param error - caught value. @returns a log-safe message without preset values. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
