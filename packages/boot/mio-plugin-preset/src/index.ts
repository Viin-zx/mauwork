/**
 * Apply mioagent catalog presets to installed plugins. A newly installed
 * package always receives the catalog preset; startup and later settings
 * events only fill a target that has no user channels. A small profile-local
 * marker keeps the force intent across a restart-required installation.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { MioModelAccess, MioPluginCatalogItem } from '@deepseek-ai/dsh-mio-account'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type {} from '@deepseek-ai/dsh-settings'
import { isEmptyTargetUser, PRESET_TARGET_PACKAGES, readPreset, resolvePresetValues } from './preset.ts'

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
}

/** What one catalog entry did, for deciding whether a pending marker can go. */
type ApplyOutcome = 'applied' | 'skipped' | 'retry'

/**
 * Sweep catalog presets on startup and after installation or settings changes.
 * @param ctx - Host context with the account, settings, and plugin manager services.
 */
export function apply(ctx: Context): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let disposed = false
  let retryAttempts = 0
  const state: SweepState = { known: undefined, pending: new Set() }

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
    try {
      await sweepCatalog(ctx, state)
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
    const offAccount = ctx.on('mio-account/changed', () => { schedule() })
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
async function sweepCatalog(ctx: Context, state: SweepState): Promise<void> {
  const session = await ctx.mioAccount.getState()
  if (session.status !== 'signed-in') return
  const [catalog, bundles] = await Promise.all([
    ctx.mioAccount.getPlugins(),
    ctx.pluginManager.listBundles(),
  ])
  const installed = new Set(bundles.filter(bundle => bundle.installed).map(bundle => bundle.name))
  let pendingChanged = false

  if (state.known === undefined) {
    state.known = new Set(installed)
    state.pending = await readPending(ctx)
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
        pendingChanged = true
      }
    }
    for (const name of [...state.pending]) {
      if (!installed.has(name)) {
        state.pending.delete(name)
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
      const outcome = await applyOne(ctx, item, state.pending.has(item.packageName))
      if (state.pending.has(item.packageName) && outcome !== 'retry') {
        state.pending.delete(item.packageName)
        pendingChanged = true
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
      pendingChanged = true
    }
  }
  if (pendingChanged) await writePending(ctx, state.pending)
}

/** Apply one catalog entry; installation force ignores existing user channels. */
async function applyOne(ctx: Context, item: MioPluginCatalogItem, force: boolean): Promise<ApplyOutcome> {
  const preset = readPreset(item.config)
  if (preset === null) return 'skipped'
  if (PRESET_TARGET_PACKAGES[preset.target] !== item.packageName) {
    throw new Error(`preset target "${preset.target}" belongs to another package`)
  }
  const descriptor = ctx.settings.describe({ redactSecrets: true })
    .find(row => String(row.ns) === preset.target)
  if (descriptor === undefined) return 'retry'
  if (!force && !isEmptyTargetUser(preset.target, descriptor.user)) return 'skipped'

  let access: Promise<MioModelAccess> | undefined
  const resolve = async (placeholder: 'MIO_MODEL_BASE_URL' | 'MIO_API_KEY'): Promise<string> => {
    access ??= ctx.mioAccount.getModelAccess()
    const value = await access
    return placeholder === 'MIO_MODEL_BASE_URL' ? value.baseUrl : value.apiKey
  }
  const values = await resolvePresetValues(preset.values, resolve)
  if (force) await ctx.settings.replace(preset.target, values, descriptor.revision)
  else await ctx.settings.update(preset.target, values, descriptor.revision)
  ctx.logger.info('mio-plugin-preset: applied %s to %s%s', item.packageName, preset.target, force ? ' (install)' : '')
  return 'applied'
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
