/** The catalog's own refresh switch: which sweeps an admin-tuned entry drives. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as sweep from '../src/index.ts'
import { catalogEntry, fixture, roots, settle } from './fixture.ts'

/** The cadence the sweep re-reads the catalog at. */
const REFRESH_MS = 5 * 60_000

beforeEach(() => { vi.useFakeTimers() })
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** @param home - the profile home. @returns a removal that survives a held marker handle. */
async function clean(home: string): Promise<void> {
  // Windows can hold a just-closed marker handle for a moment.
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
}

describe('catalog refresh switch', () => {
  it('overwrites a switched entry on startup and on every later tick', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mio-preset-'))
    try {
      const { ctx, settings, account } = fixture({ home, user: { channels: [{ id: 'mine' }] }, autoRefresh: true })
      const applied = vi.fn()
      ctx.on('mio-plugin-preset/applied', applied)
      await ctx.plugin(sweep)
      await settle()

      // The entry's switch makes the startup sweep overwrite the hand-edited channels.
      expect(settings.replace).toHaveBeenCalledExactlyOnceWith('imagegen', {
        channelSecrets: { mio: 'sk-test' },
        apiUrl: 'https://models.test/v1',
      }, 4)
      expect(settings.update).not.toHaveBeenCalled()
      // A refresh never asks the renderer to reload.
      expect(applied).not.toHaveBeenCalled()

      // An event-driven sweep leaves the entry alone until the next tick.
      ctx.emit('settings/document-updated', 'imagegen' as SettingsNamespace, 5)
      await settle()
      expect(settings.replace).toHaveBeenCalledTimes(1)

      account.getPlugins.mockResolvedValue([catalogEntry({
        channelSecrets: { mio: '{{MIO_API_KEY}}' }, apiUrl: 'https://new.models.test/v1',
      }, true)] as never)
      await settle(REFRESH_MS, 2)
      expect(settings.replace).toHaveBeenLastCalledWith('imagegen', {
        channelSecrets: { mio: 'sk-test' },
        apiUrl: 'https://new.models.test/v1',
      }, 4)
    } finally {
      await clean(home)
    }
  })

  it('adopts a switch the admin turned on between sweeps', async () => {
    const { ctx, settings, account } = fixture({ user: { channels: [{ id: 'mine' }] } })
    await ctx.plugin(sweep)
    await settle()
    expect(settings.replace).not.toHaveBeenCalled()

    account.getPlugins.mockResolvedValue([catalogEntry(undefined, true)] as never)
    await settle(REFRESH_MS, 2)
    expect(settings.replace).toHaveBeenCalledWith('imagegen', {
      channelSecrets: { mio: 'sk-test' },
      apiUrl: 'https://models.test/v1',
    }, 4)
  })

  it('never overwrites an entry whose switch is off', async () => {
    const { ctx, settings } = fixture({ user: { channels: [{ id: 'mine' }] } })
    await ctx.plugin(sweep)
    await settle()
    settings.replace.mockClear()

    await settle(REFRESH_MS, 2)
    expect(settings.replace).not.toHaveBeenCalled()
    expect(settings.update).not.toHaveBeenCalled()
  })

  it('fills an unconfigured entry once and leaves it alone on later ticks', async () => {
    const { ctx, settings, account } = fixture()
    await ctx.plugin(sweep)
    await settle()
    expect(settings.update).toHaveBeenCalledExactlyOnceWith('imagegen', {
      channelSecrets: { mio: 'sk-test' },
      apiUrl: 'https://models.test/v1',
    }, 4)

    account.getPlugins.mockResolvedValue([catalogEntry({
      channelSecrets: { mio: '{{MIO_API_KEY}}' }, apiUrl: 'https://new.models.test/v1',
    })] as never)
    await settle(REFRESH_MS, 2)
    // Without the switch a tick never rewrites a target the preset already filled.
    expect(settings.replace).not.toHaveBeenCalled()
    expect(settings.update).toHaveBeenCalledTimes(1)
  })

  it('stops overwriting once the admin turns the switch off', async () => {
    const { ctx, settings, account } = fixture({ user: { channels: [{ id: 'mine' }] }, autoRefresh: true })
    await ctx.plugin(sweep)
    await settle()
    expect(settings.replace).toHaveBeenCalledTimes(1)

    account.getPlugins.mockResolvedValue([catalogEntry(undefined, false)] as never)
    settings.replace.mockClear()
    await settle(REFRESH_MS, 2)
    expect(settings.replace).not.toHaveBeenCalled()
  })

  it('leaves a preset for the next sweep when its package is not installed', async () => {
    const { ctx, settings } = fixture({ installed: false, autoRefresh: true })
    await ctx.plugin(sweep)
    await settle(REFRESH_MS, 2)
    expect(settings.replace).not.toHaveBeenCalled()
    expect(settings.update).not.toHaveBeenCalled()
  })
})
