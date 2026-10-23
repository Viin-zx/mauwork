import { describe, expect, it, vi } from 'vitest'
import { MioMarketController } from '../src/client/market-store.ts'

const PACKAGE = '@q253595422/dsh-imagegen-video'
const LISTING = {
  pluginId: '1', pluginName: 'AI 生图', packageName: PACKAGE, category: 'image',
  description: 'Generate', hasPreset: true,
}

function fixture(plugins: unknown, bundles: unknown, latest = '2.0.0') {
  const ctx = {
    remote: {
      mioAccount: { listPlugins: vi.fn(async () => plugins) },
      pluginManager: {
        listBundles: vi.fn(async () => bundles),
        inspect: vi.fn(async (_name: string, options?: { allowInstalled?: boolean }) => ({
          ok: true,
          value: options?.allowInstalled === true
            ? { status: 'accepted', kind: 'registry', name: PACKAGE, version: latest, bundle: true, registry: null }
            : { status: 'refused', problem: 'already-installed', reason: `${PACKAGE} is already installed` },
        })),
        removeBundle: vi.fn(async () => ({ ok: true, value: { changed: true, application: 'applied' } })),
      },
    },
  }
  return { ctx, controller: new MioMarketController(ctx as never) }
}

describe('mio plugin market store', () => {
  it('publishes the catalog with installed versions and the registry version', async () => {
    const { controller } = fixture(
      { ok: true, value: [LISTING] },
      { ok: true, value: [{ name: PACKAGE, installed: true, version: '1.0.0' }, { name: 'other', installed: false }] },
    )
    controller.face().ensure()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().status).toBe('ready') })
    await vi.waitFor(() => { expect(controller.store.getSnapshot().latestVersions[PACKAGE]).toBe('2.0.0') })
    expect(controller.store.getSnapshot()).toMatchObject({
      items: [LISTING], installed: [PACKAGE], installedVersions: { [PACKAGE]: '1.0.0' }, error: '',
    })
  })

  it('removes an installed package before opening the latest install', async () => {
    const { ctx, controller } = fixture(
      { ok: true, value: [LISTING] },
      { ok: true, value: [{ name: PACKAGE, installed: true, version: '1.0.0' }] },
    )
    controller.face().ensure()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().latestVersions[PACKAGE]).toBe('2.0.0') })
    const install = vi.fn()
    controller.face().update(LISTING, install)
    await vi.waitFor(() => { expect(install).toHaveBeenCalledTimes(1) })
    expect(ctx.remote.pluginManager.removeBundle).toHaveBeenCalledExactlyOnceWith(PACKAGE)
    expect(install).toHaveBeenCalledExactlyOnceWith({ spec: `${PACKAGE}@2.0.0`, title: 'AI 生图', version: '2.0.0' })
  })

  it('does not install after a refused or restart-bound removal', async () => {
    const { ctx, controller } = fixture(
      { ok: true, value: [LISTING] },
      { ok: true, value: [{ name: PACKAGE, installed: true, version: '1.0.0' }] },
    )
    controller.face().ensure()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().latestVersions[PACKAGE]).toBe('2.0.0') })
    const install = vi.fn()
    ctx.remote.pluginManager.removeBundle.mockResolvedValueOnce({
      ok: true, value: { changed: false, application: 'failed', error: { code: 'not-removable', diagnostic: 'cannot remove' } },
    } as never)
    controller.face().update(LISTING, install)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().updateError).toBe('cannot remove') })
    expect(install).not.toHaveBeenCalled()

    ctx.remote.pluginManager.removeBundle.mockResolvedValueOnce({
      ok: true, value: { changed: true, application: 'restart-required', restartReason: 'no-hmr' },
    } as never)
    controller.face().update(LISTING, install)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().updateError).toBe('restart-required') })
    expect(install).not.toHaveBeenCalled()
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
