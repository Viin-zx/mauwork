/** The catalog's own refresh switch: the startup and install sweeps an admin-tuned entry drives. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as sweep from '../src/index.ts'
import { catalogEntry, fixture, roots, settle } from './fixture.ts'

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
  it('overwrites a switched entry on startup and leaves later hand edits alone', async () => {
    const { ctx, settings } = fixture({ user: { channels: [{ id: 'mine' }] }, autoRefresh: true })
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

    // A later settings event is not the startup sweep; it leaves the entry alone.
    ctx.emit('settings/document-updated', 'imagegen' as SettingsNamespace, 5)
    await settle()
    expect(settings.replace).toHaveBeenCalledTimes(1)
  })

  it('does not adopt a switch the admin turns on mid-session', async () => {
    const { ctx, settings, account } = fixture({ user: { channels: [{ id: 'mine' }] } })
    await ctx.plugin(sweep)
    await settle()
    expect(settings.replace).not.toHaveBeenCalled()

    account.getPlugins.mockResolvedValue([catalogEntry(undefined, true)] as never)
    ctx.emit('settings/document-updated', 'imagegen' as SettingsNamespace, 5)
    await settle()
    expect(settings.replace).not.toHaveBeenCalled()
  })

  it('never overwrites an entry whose switch is off', async () => {
    const { ctx, settings } = fixture({ user: { channels: [{ id: 'mine' }] } })
    await ctx.plugin(sweep)
    await settle()

    ctx.emit('settings/document-updated', 'imagegen' as SettingsNamespace, 5)
    await settle()
    expect(settings.replace).not.toHaveBeenCalled()
    expect(settings.update).not.toHaveBeenCalled()
  })

  it('fills an unconfigured entry once and leaves it alone on later events', async () => {
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
    ctx.emit('settings/document-updated', 'imagegen' as SettingsNamespace, 5)
    await settle()
    // Without the switch an event-driven sweep never rewrites a target the preset already filled.
    expect(settings.replace).not.toHaveBeenCalled()
    expect(settings.update).toHaveBeenCalledTimes(1)
  })

  it('stops overwriting at the next launch once the admin turns the switch off', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mio-preset-'))
    try {
      const first = fixture({ home, user: { channels: [{ id: 'mine' }] }, autoRefresh: true })
      await first.ctx.plugin(sweep)
      await settle()
      expect(first.settings.replace).toHaveBeenCalledTimes(1)

      const second = fixture({ home, user: { channels: [{ id: 'mine' }] } })
      await second.ctx.plugin(sweep)
      await settle()
      expect(second.settings.replace).not.toHaveBeenCalled()
    } finally {
      await clean(home)
    }
  })

  it('applies nothing on startup while the package is not installed', async () => {
    const { ctx, settings } = fixture({ installed: false, autoRefresh: true })
    await ctx.plugin(sweep)
    await settle()
    expect(settings.replace).not.toHaveBeenCalled()
    expect(settings.update).not.toHaveBeenCalled()
  })

  it('runs the startup overwrite after the first sign-in', async () => {
    const { ctx, settings, account } = fixture({ user: { channels: [{ id: 'mine' }] }, autoRefresh: true })
    account.getState.mockResolvedValue({ status: 'signed-out', user: null } as never)
    await ctx.plugin(sweep)
    await settle()
    expect(settings.replace).not.toHaveBeenCalled()

    account.getState.mockResolvedValue({ status: 'signed-in', user: null } as never)
    ctx.emit('mio-account/changed')
    await settle()
    expect(settings.replace).toHaveBeenCalledExactlyOnceWith('imagegen', {
      channelSecrets: { mio: 'sk-test' },
      apiUrl: 'https://models.test/v1',
    }, 4)
  })
})
