/**
 * Apply mioagent catalog presets to installed plugins whose settings entry
 * carries no user overrides. A preset write is best-effort and never blocks
 * installation; the next install, settings publication, or startup retries it.
 */

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

/**
 * Sweep catalog presets on startup and after installation or settings changes.
 * @param ctx - Host context with the account, settings, and plugin manager services.
 */
export function apply(ctx: Context): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false

  const schedule = (delayMs = EVENT_DELAY_MS): void => {
    if (timer !== undefined) return
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
      await sweepCatalog(ctx)
    } catch (error) {
      ctx.logger.warn('mio-plugin-preset: catalog sweep failed: %s', messageOf(error))
    } finally {
      running = false
    }
  }

  ctx.effect(() => {
    const offChange = ctx.on('plugin-manager/changed', ({ reason }) => {
      if (reason === 'install' || reason === 'bundle') schedule()
    })
    // A delayed entry publication is the only signal for an install that
    // needed a restart; applying cannot reach an inactive settings entry.
    const offSettings = ctx.on('settings/document-updated', () => { schedule() })
    schedule(STARTUP_DELAY_MS)
    return () => {
      offChange()
      offSettings()
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
  }, 'mio-plugin-preset: catalog sweep')
}

/** Apply every configured preset whose package is installed. */
async function sweepCatalog(ctx: Context): Promise<void> {
  const state = await ctx.mioAccount.getState()
  if (state.status !== 'signed-in') return
  const [catalog, bundles] = await Promise.all([
    ctx.mioAccount.getPlugins(),
    ctx.pluginManager.listBundles(),
  ])
  const installed = new Set(bundles.filter(bundle => bundle.installed).map(bundle => bundle.name))
  for (const item of catalog) {
    if (!installed.has(item.packageName)) continue
    try {
      await applyOne(ctx, item)
    } catch (error) {
      ctx.logger.warn('mio-plugin-preset: %s: %s', item.packageName, messageOf(error))
    }
  }
}

/** Apply one catalog entry when its target entry has no user-owned values. */
async function applyOne(ctx: Context, item: MioPluginCatalogItem): Promise<void> {
  const preset = readPreset(item.config)
  if (preset === null) return
  if (PRESET_TARGET_PACKAGES[preset.target] !== item.packageName) {
    throw new Error(`preset target "${preset.target}" belongs to another package`)
  }
  const descriptor = ctx.settings.describe({ redactSecrets: true })
    .find(row => String(row.ns) === preset.target)
  if (descriptor === undefined) return
  if (!isEmptyTargetUser(preset.target, descriptor.user)) return

  let access: Promise<MioModelAccess> | undefined
  const resolve = async (placeholder: 'MIO_MODEL_BASE_URL' | 'MIO_API_KEY'): Promise<string> => {
    access ??= ctx.mioAccount.getModelAccess()
    const value = await access
    return placeholder === 'MIO_MODEL_BASE_URL' ? value.baseUrl : value.apiKey
  }
  const values = await resolvePresetValues(preset.values, resolve)
  await ctx.settings.update(preset.target, values, descriptor.revision)
  ctx.logger.info('mio-plugin-preset: applied %s to %s', item.packageName, preset.target)
}

/** @param error - caught value. @returns a log-safe message without preset values. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
