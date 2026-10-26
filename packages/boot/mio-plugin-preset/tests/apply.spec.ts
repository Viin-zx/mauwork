import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as presetPlugin from '../src/index.ts'

const PACKAGE = '@q253595422/dsh-imagegen-video'

const roots: Context[] = []

beforeEach(() => { vi.useFakeTimers() })
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

function fixture(options: {
  user?: Record<string, unknown>
  installed?: boolean
  values?: Record<string, unknown>
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
    getPlugins: vi.fn(async () => [{
      pluginId: '1',
      pluginName: 'AI 生图',
      packageName: PACKAGE,
      category: 'image',
      description: '',
      config: {
        target: 'imagegen',
        values: options.values ?? { channelSecrets: { mio: '{{MIO_API_KEY}}' }, apiUrl: '{{MIO_MODEL_BASE_URL}}' },
      },
    }]),
    getModelAccess: vi.fn(async () => ({
      baseUrl: 'https://models.test/v1', apiKey: 'sk-test', credentialVersion: 1, expiresAt: '2030-01-01 00:00:00',
    })),
  }
  const manager = {
    listBundles: vi.fn(async () => [{ name: PACKAGE, installed: options.installed ?? true, enabled: true }]),
  }
  ctx.provide('mioAccount', account as never)
  ctx.provide('settings', settings as never)
  ctx.provide('pluginManager', manager as never)
  return { ctx, settings, account, manager }
}

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
