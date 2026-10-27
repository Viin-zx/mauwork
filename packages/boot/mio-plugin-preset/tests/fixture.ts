/** Shared Host fixture: the account, settings, and plugin manager services one sweep reads. */

import { setTimeout as realTimeout } from 'node:timers'
import { vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DEFAULT_INSTALL_PACKAGES } from '../src/index.ts'

/** The catalog package the fixtures carry a preset for. */
export const PACKAGE = '@q253595422/dsh-imagegen-video'

/** Contexts the running spec disposes together. */
export const roots: Context[] = []

/**
 * Move the fake clock while letting real marker I/O settle. A sweep awaits the filesystem,
 * and a continuation queued by the operating system never runs inside a faked timer advance.
 * @param ms - fake time handed out per step.
 * @param steps - flush steps to run.
 */
export async function settle(ms = 200, steps = 20): Promise<void> {
  for (let index = 0; index < steps; index += 1) {
    await new Promise(resolve => realTimeout(resolve, 0))
    await vi.advanceTimersByTimeAsync(ms)
  }
}

/**
 * The catalog entry one fixture's sweep reads.
 * @param values - preset values the entry carries, or the default account-placeholder pair.
 * @param autoRefresh - whether the administration switched this plugin's configuration refresh on.
 * @returns the catalog entry.
 */
export function catalogEntry(
  values?: Record<string, unknown>,
  autoRefresh = false,
): Record<string, unknown> {
  return {
    pluginId: '1',
    pluginName: 'AI 生图',
    packageName: PACKAGE,
    category: 'image',
    description: '',
    autoRefresh,
    config: {
      target: 'imagegen',
      values: values ?? { channelSecrets: { mio: '{{MIO_API_KEY}}' }, apiUrl: '{{MIO_MODEL_BASE_URL}}' },
    },
  }
}

/**
 * Build a Host context for one sweep.
 * @param options - the settings user layer, whether the package is installed, the preset values,
 *   whether the admin switched the entry's refresh on, whether the default plugins are present,
 *   and the profile home the markers live under.
 * @returns the context and the services it reads.
 */
export function fixture(options: {
  user?: Record<string, unknown>
  installed?: boolean
  values?: Record<string, unknown>
  autoRefresh?: boolean
  defaultsInstalled?: boolean
  home?: string
} = {}) {
  const ctx = new Context()
  roots.push(ctx)
  let user = options.user ?? {}
  const settings = {
    describe: vi.fn(() => [{
      ns: 'imagegen',
      revision: 4,
      user,
      value: {},
    }]),
    update: vi.fn(async (_ns: string, patch: Record<string, unknown>) => {
      user = { ...user, ...structuredClone(patch) }
    }),
    replace: vi.fn(async (_ns: string, section: Record<string, unknown>) => {
      user = structuredClone(section)
    }),
  }
  const account = {
    getState: vi.fn(async () => ({ status: 'signed-in', user: null })),
    getPlugins: vi.fn(async () => [catalogEntry(options.values, options.autoRefresh)]),
    getModelAccess: vi.fn(async () => ({
      baseUrl: 'https://models.test/v1', apiKey: 'sk-test', credentialVersion: 1, expiresAt: '2030-01-01 00:00:00',
    })),
  }
  const defaults = (options.defaultsInstalled ?? true)
    ? DEFAULT_INSTALL_PACKAGES.map(name => ({ name, installed: true, enabled: true }))
    : []
  const manager = {
    listBundles: vi.fn(async () => [{ name: PACKAGE, installed: options.installed ?? true, enabled: true }, ...defaults]),
    installBundle: vi.fn(async (name: string): Promise<{
      changed: boolean
      application: 'applied' | 'restart-required' | 'failed' | 'cancelled'
      stage: 'install'
      target: string
      bundle?: string
      error?: { code: string }
    }> => ({ changed: true, application: 'applied', stage: 'install', target: name, bundle: name })),
  }
  ctx.provide('mioAccount', account as never)
  ctx.provide('settings', settings as never)
  ctx.provide('pluginManager', manager as never)
  if (options.home !== undefined) {
    ctx.provide('profileContext', { name: 'desktop', home: options.home } as never)
  }
  return { ctx, settings, account, manager }
}
