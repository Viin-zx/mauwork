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

function fixture(options: { user?: Record<string, unknown>; installed?: boolean } = {}) {
  const ctx = new Context()
  roots.push(ctx)
  const settings = {
    describe: vi.fn(() => [{
      ns: 'imagegen',
      revision: 4,
      user: options.user ?? {},
      value: {},
    }]),
    update: vi.fn(async () => undefined),
  }
  const account = {
    getState: vi.fn(async () => ({ status: 'signed-in', user: null, expiresAt: null })),
    getPlugins: vi.fn(async () => [{
      pluginId: '1',
      pluginName: 'AI 生图',
      packageName: PACKAGE,
      category: 'image',
      description: '',
      config: {
        target: 'imagegen',
        values: { channelSecrets: { mio: '{{MIO_API_KEY}}' }, apiUrl: '{{MIO_MODEL_BASE_URL}}' },
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
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)

    expect(account.getPlugins).toHaveBeenCalledTimes(1)
    expect(account.getModelAccess).toHaveBeenCalledTimes(1)
    expect(settings.update).toHaveBeenCalledExactlyOnceWith('imagegen', {
      channelSecrets: { mio: 'sk-test' },
      apiUrl: 'https://models.test/v1',
    }, 4)
  })

  it('does not overwrite user-owned channels', async () => {
    const { ctx, settings } = fixture({ user: { channels: [{ id: 'mine' }] } })
    await ctx.plugin(presetPlugin)
    await vi.advanceTimersByTimeAsync(1_600)

    expect(settings.update).not.toHaveBeenCalled()
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
    expect(settings.update).toHaveBeenCalledTimes(1)
  })
})
