import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as presetPlugin from '../src/index.ts'
import { DEFAULT_INSTALL_PACKAGES } from '../src/index.ts'
import { catalogEntry, fixture, PACKAGE, roots, settle } from './fixture.ts'

beforeEach(() => { vi.useFakeTimers() })
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('catalog preset application', () => {
  it('writes a configured preset into an empty settings entry', async () => {
    const { ctx, settings, account } = fixture()
    const applied = vi.fn()
    ctx.on('mio-plugin-preset/applied', applied)
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)

    expect(account.getPlugins).toHaveBeenCalledTimes(1)
    expect(account.getModelAccess).toHaveBeenCalledTimes(1)
    expect(settings.update).toHaveBeenCalledExactlyOnceWith('imagegen', {
      channelSecrets: { mio: 'sk-test' },
      apiUrl: 'https://models.test/v1',
    }, 4)
    expect(applied).not.toHaveBeenCalled()
  })

  it('does not overwrite user-owned channels on startup', async () => {
    const { ctx, settings } = fixture({ user: { channels: [{ id: 'mine' }] } })
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)

    expect(settings.update).not.toHaveBeenCalled()
    expect(settings.replace).not.toHaveBeenCalled()
  })

  it('fills channels when only unrelated settings were changed', async () => {
    const { ctx, settings } = fixture({ user: { enabled: false } })
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)

    expect(settings.update).toHaveBeenCalledTimes(1)
  })

  it('waits for an installed package', async () => {
    const { ctx, settings } = fixture({ installed: false })
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)

    expect(settings.update).not.toHaveBeenCalled()
  })

  it('retries when installation changes the profile', async () => {
    const { ctx, settings, manager } = fixture({ installed: false })
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)
    expect(settings.update).not.toHaveBeenCalled()

    manager.listBundles.mockResolvedValue([{ name: PACKAGE, installed: true, enabled: true }] as never)
    ctx.emit('plugin-manager/changed', { reason: 'install' })
    await vi.advanceTimersByTimeAsync(600)
    expect(settings.replace).toHaveBeenCalledTimes(1)
  })

  it('overwrites user channels when a package is installed after startup', async () => {
    const { ctx, settings, manager } = fixture({ installed: false, user: { channels: [{ id: 'mine' }] } })
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)
    expect(settings.update).not.toHaveBeenCalled()
    expect(settings.replace).not.toHaveBeenCalled()

    manager.listBundles.mockResolvedValue([{ name: PACKAGE, installed: true, enabled: true }] as never)
    ctx.emit('plugin-manager/changed', { reason: 'install' })
    await vi.advanceTimersByTimeAsync(600)
    expect(settings.replace).toHaveBeenCalledExactlyOnceWith('imagegen', {
      channelSecrets: { mio: 'sk-test' },
      apiUrl: 'https://models.test/v1',
    }, 4)
    expect(settings.update).not.toHaveBeenCalled()
  })

  it('refreshes the managed channel credentials after the account changes', async () => {
    const values = {
      channels: [{ id: 'mio-default', apiUrl: '{{MIO_MODEL_BASE_URL}}' }],
      channelSecrets: { 'mio-default': '{{MIO_API_KEY}}' },
      defaultChannelId: 'mio-default',
    }
    const user = {
      channels: [
        { id: 'mio-default', apiUrl: 'https://old.example/v1' },
        { id: 'mine', apiUrl: 'https://mine.example/v1' },
      ],
      defaultChannelId: 'mio-default',
    }
    const { ctx, settings, account } = fixture({ user, values })
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)
    // Startup never rewrites a non-empty target.
    expect(settings.update).not.toHaveBeenCalled()

    ctx.emit('mio-account/changed')
    await vi.advanceTimersByTimeAsync(600)
    expect(settings.update).toHaveBeenCalledExactlyOnceWith('imagegen', {
      channels: [
        { id: 'mio-default', apiUrl: 'https://models.test/v1' },
        { id: 'mine', apiUrl: 'https://mine.example/v1' },
      ],
      channelSecrets: { 'mio-default': 'sk-test' },
    }, 4)

    // An unchanged credential version does not write again.
    ctx.emit('mio-account/changed')
    await vi.advanceTimersByTimeAsync(600)
    expect(settings.update).toHaveBeenCalledTimes(1)

    account.getModelAccess.mockResolvedValue({
      baseUrl: 'https://models.test/v1', apiKey: 'sk-rotated', credentialVersion: 2, expiresAt: '2030-01-01 00:00:00',
    })
    ctx.emit('mio-account/changed')
    await vi.advanceTimersByTimeAsync(600)
    expect(settings.update).toHaveBeenCalledTimes(2)
    expect(settings.update).toHaveBeenLastCalledWith('imagegen', {
      channelSecrets: { 'mio-default': 'sk-rotated' },
    }, 4)

    // A fresh sign-in re-reads the credential even if its version did not change.
    account.getState.mockResolvedValue({ status: 'signed-out', user: null })
    ctx.emit('mio-account/changed')
    await vi.advanceTimersByTimeAsync(600)
    account.getState.mockResolvedValue({ status: 'signed-in', user: null })
    account.getModelAccess.mockResolvedValue({
      baseUrl: 'https://models.test/v1', apiKey: 'sk-after-relogin', credentialVersion: 2, expiresAt: '2030-01-01 00:00:00',
    })
    ctx.emit('mio-account/changed')
    await vi.advanceTimersByTimeAsync(600)
    expect(settings.update).toHaveBeenCalledTimes(3)
    expect(settings.update).toHaveBeenLastCalledWith('imagegen', {
      channelSecrets: { 'mio-default': 'sk-after-relogin' },
    }, 4)
  })

  it('leaves channels the user replaced alone', async () => {
    const values = {
      channels: [{ id: 'mio-default', apiUrl: '{{MIO_MODEL_BASE_URL}}' }],
      channelSecrets: { 'mio-default': '{{MIO_API_KEY}}' },
      defaultChannelId: 'mio-default',
    }
    const { ctx, settings } = fixture({ user: { channels: [{ id: 'mine' }], defaultChannelId: 'mine' }, values })
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)
    ctx.emit('mio-account/changed')
    await vi.advanceTimersByTimeAsync(600)

    expect(settings.update).not.toHaveBeenCalled()
  })

  it('announces a forced install so the renderer can reload', async () => {
    const { ctx, settings, manager } = fixture({ installed: false })
    const applied = vi.fn()
    ctx.on('mio-plugin-preset/applied', applied)
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)

    manager.listBundles.mockResolvedValue([{ name: PACKAGE, installed: true, enabled: true }] as never)
    ctx.emit('plugin-manager/changed', { reason: 'install' })
    await vi.advanceTimersByTimeAsync(600)
    expect(settings.replace).toHaveBeenCalledTimes(1)
    expect(applied).toHaveBeenCalledExactlyOnceWith({
      packageName: PACKAGE, target: 'imagegen', reload: true,
    })
  })

  it('retries a pending install until the settings entry appears', async () => {
    const { ctx, settings, manager } = fixture({ installed: false })
    const descriptor = { ns: 'imagegen', revision: 4, user: { channels: [{ id: 'mine' }] }, value: {} }
    settings.describe.mockReturnValue([])
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)

    manager.listBundles.mockResolvedValue([{ name: PACKAGE, installed: true, enabled: true }] as never)
    ctx.emit('plugin-manager/changed', { reason: 'install' })
    await vi.advanceTimersByTimeAsync(600)
    expect(settings.replace).not.toHaveBeenCalled()

    settings.describe.mockReturnValue([descriptor])
    await vi.advanceTimersByTimeAsync(1_100)
    expect(settings.replace).toHaveBeenCalledTimes(1)
  })
})

describe('sweep scheduling', () => {
  it('starts every sweep outside an inherited HMR transaction', async () => {
    const { ctx, settings } = fixture()
    const runDetached = vi.fn((run: () => void) => { run() })
    ctx.provide('hmr', { runDetached } as never)
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)

    expect(runDetached).toHaveBeenCalled()
    // The sweep still applies the empty target it found.
    expect(settings.update).toHaveBeenCalledTimes(1)
  })
})

describe('default plugin installation', () => {
  it('installs the defaults once and announces the renderer reload', async () => {
    const { ctx, manager } = fixture({ defaultsInstalled: false })
    const installed = vi.fn()
    ctx.on('mio-plugin-preset/defaults-installed', installed)
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)

    expect(manager.installBundle.mock.calls.map(([name]) => name)).toEqual([...DEFAULT_INSTALL_PACKAGES])
    expect(installed).toHaveBeenCalledExactlyOnceWith({
      packages: [...DEFAULT_INSTALL_PACKAGES], reload: true,
    })
  })

  it('handles defaults found installed, and keeps a later removal removed across processes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mio-preset-'))
    try {
      const first = fixture({ home })
      await first.ctx.plugin(presetPlugin)
      await vi.advanceTimersByTimeAsync(1_600)
      expect(first.manager.installBundle).not.toHaveBeenCalled()

      const markerPath = join(home, 'storages', 'mio-plugin-preset', 'desktop.defaults.json')
      await vi.waitFor(async () => {
        const marker: unknown = JSON.parse(await readFile(markerPath, 'utf8'))
        expect(marker).toEqual(expect.arrayContaining([...DEFAULT_INSTALL_PACKAGES]))
        expect(marker).toHaveLength(DEFAULT_INSTALL_PACKAGES.length)
      })

      const second = fixture({ defaultsInstalled: false, home })
      await second.ctx.plugin(presetPlugin)
      await vi.advanceTimersByTimeAsync(1_600)
      expect(second.manager.installBundle).not.toHaveBeenCalled()
    } finally {
      // Windows can hold a just-closed marker handle for a moment.
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })

  it('re-applies the preset when a plugin is uninstalled and reinstalled', async () => {
    const { ctx, settings, manager } = fixture({ user: { channels: [{ id: 'mine' }] } })
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)
    // Startup: user has channels, so no overwrite.
    expect(settings.replace).not.toHaveBeenCalled()
    expect(settings.update).not.toHaveBeenCalled()

    // Simulate uninstall: plugin disappears from the bundle list.
    manager.listBundles.mockResolvedValue([] as never)
    ctx.emit('plugin-manager/changed', { reason: 'remove' })
    await vi.advanceTimersByTimeAsync(600)

    // Simulate reinstall: plugin reappears as newly installed.
    manager.listBundles.mockResolvedValue([{ name: PACKAGE, installed: true, enabled: true }] as never)
    ctx.emit('plugin-manager/changed', { reason: 'install' })
    await vi.advanceTimersByTimeAsync(600)

    // The reinstall must force-apply the preset, overwriting user channels.
    expect(settings.replace).toHaveBeenCalledExactlyOnceWith('imagegen', {
      channelSecrets: { mio: 'sk-test' },
      apiUrl: 'https://models.test/v1',
    }, 4)
  })

  it('re-applies the preset across process restarts after uninstall and reinstall', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mio-preset-'))
    const appliedMarker = join(home, 'storages', 'mio-plugin-preset', 'desktop.applied.json')
    /** @returns the applied marker's package names. */
    const applied = async (): Promise<string[]> => JSON.parse(await readFile(appliedMarker, 'utf8')) as string[]
    const installed = [{ name: PACKAGE, installed: true, enabled: true }]
    try {
      // First process: the plugin installs, applies, and is then uninstalled.
      const first = fixture({ home, installed: false })
      await first.ctx.plugin(presetPlugin)
      await settle()

      first.manager.listBundles.mockResolvedValue(installed)
      first.ctx.emit('plugin-manager/changed', { reason: 'install' })
      await settle()
      expect(first.settings.replace).toHaveBeenCalledTimes(1)
      expect(await applied()).toEqual([PACKAGE])

      first.manager.listBundles.mockResolvedValue([] as never)
      first.ctx.emit('plugin-manager/changed', { reason: 'remove' })
      await settle()
      expect(await applied()).toEqual([])

      // Second process: the reinstall is new again, because the applied marker was cleared.
      const second = fixture({ home, installed: false })
      await second.ctx.plugin(presetPlugin)
      await settle()

      second.manager.listBundles.mockResolvedValue(installed)
      second.ctx.emit('plugin-manager/changed', { reason: 'install' })
      await settle()
      expect(second.settings.replace).toHaveBeenCalledExactlyOnceWith('imagegen', {
        channelSecrets: { mio: 'sk-test' },
        apiUrl: 'https://models.test/v1',
      }, 4)
    } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })

  it('retries a failed default only after a new sign-in', async () => {
    const { ctx, manager } = fixture({ defaultsInstalled: false })
    manager.installBundle.mockRejectedValue(new Error('offline'))
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)
    expect(manager.installBundle).toHaveBeenCalledTimes(DEFAULT_INSTALL_PACKAGES.length)

    // The failed run's own change event must not drive a retry loop.
    ctx.emit('plugin-manager/changed', { reason: 'install' })
    await vi.advanceTimersByTimeAsync(600)
    expect(manager.installBundle).toHaveBeenCalledTimes(DEFAULT_INSTALL_PACKAGES.length)

    ctx.emit('mio-account/changed')
    await vi.advanceTimersByTimeAsync(600)
    expect(manager.installBundle).toHaveBeenCalledTimes(DEFAULT_INSTALL_PACKAGES.length * 2)
  })

  it('keeps refused defaults unhandled and announces nothing', async () => {
    const { ctx, manager } = fixture({ defaultsInstalled: false })
    manager.installBundle
      .mockResolvedValueOnce({
        changed: false, application: 'failed', stage: 'install', target: 'a',
        error: { code: 'operation-error' },
      })
      .mockResolvedValueOnce({ changed: false, application: 'cancelled', stage: 'install', target: 'b' })
    const installed = vi.fn()
    ctx.on('mio-plugin-preset/defaults-installed', installed)
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)

    expect(manager.installBundle).toHaveBeenCalledTimes(DEFAULT_INSTALL_PACKAGES.length)
    expect(installed).not.toHaveBeenCalled()
  })

  it('does not announce a reload for an installation that waits for a restart', async () => {
    const { ctx, manager } = fixture({ defaultsInstalled: false })
    manager.installBundle.mockImplementation(async (name: string) => ({
      changed: true, application: 'restart-required', stage: 'install', target: name, bundle: name,
    }))
    const installed = vi.fn()
    ctx.on('mio-plugin-preset/defaults-installed', installed)
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)

    expect(installed).toHaveBeenCalledExactlyOnceWith({
      packages: [...DEFAULT_INSTALL_PACKAGES], reload: false,
    })
  })

  it('records a preset failure in the profile storage for local diagnosis', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mio-preset-'))
    try {
      const { ctx, account } = fixture({ home })
      // A preset whose target package is not the entry it arrived on cannot be applied.
      account.getPlugins.mockResolvedValue([{ ...catalogEntry(), packageName: 'dsh-skill-mcp-panel' }] as never)
      await ctx.plugin(presetPlugin)
      await settle()

      const diagnostic = JSON.parse(
        await readFile(join(home, 'storages', 'mio-plugin-preset', 'last-error.json'), 'utf8'),
      ) as { at: string; message: string; packageName: string }
      expect(diagnostic.packageName).toBe('dsh-skill-mcp-panel')
      expect(diagnostic.message).toContain('belongs to another package')
      expect(Number.isNaN(Date.parse(diagnostic.at))).toBe(false)
    } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })
})
