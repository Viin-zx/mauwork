import { describe, expect, it, vi } from 'vitest'
import { MioMarketController } from '../src/client/market-store.ts'

const PACKAGE = '@q253595422/dsh-imagegen-video'

function fixture(plugins: unknown, bundles: unknown) {
  const ctx = {
    remote: {
      mioAccount: { listPlugins: vi.fn(async () => plugins) },
      pluginManager: { listBundles: vi.fn(async () => bundles) },
    },
  }
  return { ctx, controller: new MioMarketController(ctx as never) }
}

describe('mio plugin market store', () => {
  it('publishes the catalog with installed package names', async () => {
    const listing = {
      pluginId: '1', pluginName: 'AI 生图', packageName: PACKAGE, category: 'image',
      description: 'Generate', hasPreset: true,
    }
    const { controller } = fixture(
      { ok: true, value: [listing] },
      { ok: true, value: [{ name: PACKAGE, installed: true }, { name: 'other', installed: false }] },
    )
    controller.face().ensure()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().status).toBe('ready') })
    expect(controller.store.getSnapshot()).toMatchObject({ items: [listing], installed: [PACKAGE], error: '' })
  })

  it('keeps a readable failure and retries on demand', async () => {
    const { ctx, controller } = fixture({ ok: false, error: { message: 'offline' } }, { ok: true, value: [] })
    controller.face().ensure()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().status).toBe('error') })
    expect(controller.store.getSnapshot().error).toBe('offline')

    ctx.remote.mioAccount.listPlugins.mockResolvedValue({ ok: true, value: [] })
    controller.face().reload()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().status).toBe('ready') })
  })

  it('refreshes only installed package names after a profile change', async () => {
    const { ctx, controller } = fixture(
      { ok: true, value: [] },
      { ok: true, value: [{ name: PACKAGE, installed: true }] },
    )
    controller.face().ensure()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().status).toBe('ready') })
    expect(controller.store.getSnapshot().installed).toEqual([PACKAGE])

    ctx.remote.pluginManager.listBundles.mockResolvedValue({ ok: true, value: [] })
    controller.refreshInstalled()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().installed).toEqual([]) })
    expect(ctx.remote.mioAccount.listPlugins).toHaveBeenCalledTimes(1)
  })
})
