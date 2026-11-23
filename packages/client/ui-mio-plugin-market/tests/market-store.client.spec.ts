import { describe, expect, it, vi } from 'vitest'
import { hasUpdates, MioMarketController, orderMarketItems, updatableItems } from '../src/client/market-store.ts'

const PACKAGE = '@q253595422/dsh-imagegen-video'
const SECOND = '@scope/video'
const THIRD = '@scope/audio'
const LISTING = {
  pluginId: '1', pluginName: 'AI 生图', packageName: PACKAGE, category: 'image',
  description: 'Generate', hasPreset: true,
}
const SECOND_LISTING = { ...LISTING, pluginId: '2', pluginName: 'Video', packageName: SECOND }
const THIRD_LISTING = { ...LISTING, pluginId: '3', pluginName: 'Audio', packageName: THIRD }

function fixture(plugins: unknown, bundles: unknown, latest: string | Record<string, string> = '2.0.0') {
  const versionOf = (name: string): string | undefined => typeof latest === 'string' ? latest : latest[name]
  const ctx = {
    remote: {
      mioAccount: { listPlugins: vi.fn(async () => plugins) },
      pluginManager: {
        listBundles: vi.fn(async () => bundles),
        inspect: vi.fn(async (name: string, options?: { allowInstalled?: boolean }) => ({
          ok: true,
          value: options?.allowInstalled === true
            ? { status: 'accepted', kind: 'registry', name, version: versionOf(name), bundle: true, registry: null }
            : { status: 'refused', problem: 'already-installed', reason: `${name} is already installed` },
        })),
        removeBundle: vi.fn(async () => ({ ok: true, value: { changed: true, application: 'applied' } })),
        updateBundle: vi.fn(async (name: string, version: string) => ({
          ok: true,
          value: {
            from: '1.0.0', to: version, step: 'install',
            result: { changed: true, application: 'applied', stage: 'install', target: name },
          },
        })),
      },
    },
  }
  return { ctx, controller: new MioMarketController(ctx as never) }
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void } {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((settle, fail) => { resolve = settle; reject = fail })
  return { promise, resolve, reject }
}

async function loaded(
  plugins: readonly unknown[], installed: readonly { name: string; installed: boolean; version?: string }[],
  latest: string | Record<string, string>,
) {
  const built = fixture({ ok: true, value: plugins }, { ok: true, value: installed }, latest)
  built.controller.face().ensure()
  const versions = typeof latest === 'string' ? Object.fromEntries(plugins.map(item => [(item as { packageName: string }).packageName, latest])) : latest
  await vi.waitFor(() => {
    expect(built.controller.store.getSnapshot().latestVersions).toEqual(versions)
  })
  return built
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

describe('market pin toggle', () => {
  it('pins to the end of the pin order and unpins in place', () => {
    const { controller } = fixture({ ok: true, value: [] }, { ok: true, value: [] })
    const face = controller.face()
    expect(controller.pinned.getSnapshot()).toEqual([])

    face.togglePin(PACKAGE)
    face.togglePin('@scope/video')
    expect(controller.pinned.getSnapshot()).toEqual([PACKAGE, '@scope/video'])

    face.togglePin(PACKAGE)
    expect(controller.pinned.getSnapshot()).toEqual(['@scope/video'])
  })
})

describe('market display order', () => {
  const second = { ...LISTING, pluginId: '2', pluginName: 'Video', packageName: '@scope/video' }
  const third = { ...LISTING, pluginId: '3', pluginName: 'Audio', packageName: '@scope/audio' }

  it('leads with pinned entries in pin order, then keeps catalog order', () => {
    expect(orderMarketItems([LISTING, second, third], []).map(item => item.packageName))
      .toEqual([PACKAGE, '@scope/video', '@scope/audio'])
    expect(orderMarketItems([LISTING, second, third], ['@scope/audio', PACKAGE]).map(item => item.packageName))
      .toEqual(['@scope/audio', PACKAGE, '@scope/video'])
  })

  it('ignores pinned names that left the catalog', () => {
    expect(orderMarketItems([LISTING, second], ['@scope/gone', '@scope/video']).map(item => item.packageName))
      .toEqual(['@scope/video', PACKAGE])
  })
})

describe('market update marker', () => {
  const base = {
    status: 'ready' as const, items: [LISTING], installed: [PACKAGE], updating: null, updateError: '', error: '',
    installedVersions: {}, latestVersions: {}, updatingAll: null, updateAllError: null, updateAllRestart: 0,
  }

  it('marks only a newer registry version than the installed one', () => {
    expect(hasUpdates({
      ...base, installedVersions: { [PACKAGE]: '1.0.0' }, latestVersions: { [PACKAGE]: '2.0.0' },
    })).toBe(true)
    expect(hasUpdates({
      ...base, installedVersions: { [PACKAGE]: '2.0.0' }, latestVersions: { [PACKAGE]: '2.0.0' },
    })).toBe(false)
    expect(hasUpdates({
      ...base, installedVersions: { [PACKAGE]: '3.0.0' }, latestVersions: { [PACKAGE]: '2.0.0' },
    })).toBe(false)
  })

  it('marks nothing before a registry read or for a package that is not installed', () => {
    expect(hasUpdates({ ...base, installedVersions: { [PACKAGE]: '1.0.0' }, latestVersions: {} })).toBe(false)
    expect(hasUpdates({
      ...base, installed: [], installedVersions: { [PACKAGE]: '1.0.0' }, latestVersions: { [PACKAGE]: '2.0.0' },
    })).toBe(false)
  })
})

/** A Host update answer that installs the target version. */
function updateAnswer(name: string, to: string, application: 'applied' | 'restart-required' = 'applied') {
  return {
    ok: true as const,
    value: {
      from: '1.0.0', to, step: 'install' as const,
      result: { changed: true, application, stage: 'install' as const, target: name },
    },
  }
}

describe('update all targets', () => {
  it('lists only installed entries with a newer registry version, in catalog order', () => {
    const state = {
      status: 'ready' as const, items: [LISTING, SECOND_LISTING], installed: [SECOND, PACKAGE], updating: null,
      updateError: '', error: '', updatingAll: null, updateAllError: null, updateAllRestart: 0,
      installedVersions: { [PACKAGE]: '1.0.0', [SECOND]: '3.0.0' },
      latestVersions: { [PACKAGE]: '2.0.0', [SECOND]: '3.0.0' },
    }
    expect(updatableItems(state)).toEqual([{ item: LISTING, installed: '1.0.0', latest: '2.0.0' }])
  })
})

describe('update all run', () => {
  it('replaces every newer plugin once, in order, and counts restart-bound changes', async () => {
    const { ctx, controller } = await loaded(
      [LISTING, SECOND_LISTING],
      [{ name: PACKAGE, installed: true, version: '1.0.0' }, { name: SECOND, installed: true, version: '1.0.0' }],
      { [PACKAGE]: '2.0.0', [SECOND]: '3.0.0' },
    )
    ctx.remote.pluginManager.listBundles.mockResolvedValue({
      ok: true,
      value: [
        { name: PACKAGE, installed: true, version: '2.0.0' },
        { name: SECOND, installed: true, version: '3.0.0' },
      ],
    })
    const first = deferred()
    const second = deferred()
    let active = 0
    let peak = 0
    ctx.remote.pluginManager.updateBundle.mockImplementation(async (name: string, version: string) => {
      active++
      peak = Math.max(peak, active)
      await (name === PACKAGE ? first.promise : second.promise)
      active--
      return updateAnswer(name, version, name === SECOND ? 'restart-required' : 'applied')
    })

    controller.face().updateAll()
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().updatingAll).toEqual({
        done: 0, total: 2, packageName: PACKAGE, pluginName: 'AI 生图',
      })
    })
    first.resolve()
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().updatingAll).toEqual({
        done: 1, total: 2, packageName: SECOND, pluginName: 'Video',
      })
    })
    second.resolve()
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().installedVersions).toEqual({ [PACKAGE]: '2.0.0', [SECOND]: '3.0.0' })
    })
    expect(controller.store.getSnapshot()).toMatchObject({
      updatingAll: null, updateAllError: null, updateAllRestart: 1,
    })
    expect(ctx.remote.pluginManager.updateBundle.mock.calls).toEqual([
      [PACKAGE, '2.0.0', undefined], [SECOND, '3.0.0', undefined],
    ])
    expect(peak).toBe(1)
  })

  it('stops at the first answer the Host could not give and names that plugin', async () => {
    const { ctx, controller } = await loaded(
      [LISTING, SECOND_LISTING, THIRD_LISTING],
      [
        { name: PACKAGE, installed: true, version: '1.0.0' },
        { name: SECOND, installed: true, version: '1.0.0' },
        { name: THIRD, installed: true, version: '1.0.0' },
      ],
      { [PACKAGE]: '2.0.0', [SECOND]: '2.0.0', [THIRD]: '2.0.0' },
    )
    ctx.remote.pluginManager.updateBundle
      .mockResolvedValueOnce(updateAnswer(PACKAGE, '2.0.0'))
      .mockResolvedValueOnce({ ok: false, error: { message: 'offline' } } as never)

    controller.face().updateAll()
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().updateAllError).toEqual({
        packageName: SECOND, pluginName: 'Video', kind: 'failed', reason: 'offline',
      })
    })
    expect(controller.store.getSnapshot().updatingAll).toBeNull()
    expect(controller.store.getSnapshot().updateAllRestart).toBe(0)
    expect(ctx.remote.pluginManager.updateBundle).toHaveBeenCalledTimes(2)
    expect(ctx.remote.pluginManager.updateBundle).toHaveBeenLastCalledWith(SECOND, '2.0.0', undefined)
  })

  const refusals = [
    {
      name: 'a removal that waits for the next start',
      answer: {
        from: '1.0.0', to: '2.0.0', step: 'remove',
        result: { changed: false, application: 'restart-required', stage: 'remove', target: PACKAGE },
      },
      expected: { kind: 'restart-required', reason: '' },
    },
    {
      name: 'an installation that needs install-script approval',
      answer: {
        from: '1.0.0', to: '2.0.0', step: 'install',
        result: {
          changed: false, application: 'failed', stage: 'install', target: PACKAGE, pendingBuilds: ['esbuild'],
          error: { code: 'build-approval', diagnostic: 'approve esbuild' },
        },
      },
      expected: { kind: 'build-approval', reason: 'approve esbuild' },
    },
    {
      name: 'a failed installation',
      answer: {
        from: '1.0.0', to: '2.0.0', step: 'install',
        result: {
          changed: false, application: 'failed', stage: 'install', target: PACKAGE,
          error: { code: 'operation-error', diagnostic: 'plugin failed to start' },
        },
      },
      expected: { kind: 'failed', reason: 'plugin failed to start' },
    },
    {
      name: 'a cancelled installation',
      answer: {
        from: '1.0.0', to: '2.0.0', step: 'install',
        result: { changed: false, application: 'cancelled', stage: 'install', target: PACKAGE },
      },
      expected: { kind: 'failed', reason: '' },
    },
  ]

  for (const { name, answer, expected } of refusals) {
    it(`reports ${name} and stops the run`, async () => {
      const { ctx, controller } = await loaded(
        [LISTING], [{ name: PACKAGE, installed: true, version: '1.0.0' }], '2.0.0',
      )
      ctx.remote.pluginManager.updateBundle.mockResolvedValueOnce({ ok: true, value: answer })

      controller.face().updateAll()
      await vi.waitFor(() => {
        expect(controller.store.getSnapshot().updateAllError).toEqual({
          packageName: PACKAGE, pluginName: 'AI 生图', ...expected,
        })
      })
      expect(controller.store.getSnapshot().updatingAll).toBeNull()
    })
  }

  it('reports an update that threw instead of answering', async () => {
    const { ctx, controller } = await loaded(
      [LISTING], [{ name: PACKAGE, installed: true, version: '1.0.0' }], '2.0.0',
    )
    ctx.remote.pluginManager.updateBundle.mockRejectedValueOnce(new Error('boom'))

    controller.face().updateAll()
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().updateAllError).toEqual({
        packageName: PACKAGE, pluginName: 'AI 生图', kind: 'failed', reason: 'boom',
      })
    })

    const second = await loaded([LISTING], [{ name: PACKAGE, installed: true, version: '1.0.0' }], '2.0.0')
    second.ctx.remote.pluginManager.updateBundle.mockRejectedValueOnce('boom')
    second.controller.face().updateAll()
    await vi.waitFor(() => {
      expect(second.controller.store.getSnapshot().updateAllError?.reason).toBe('boom')
    })
  })

  it('does nothing when every plugin is current or another update is in flight', async () => {
    const current = await loaded([LISTING], [{ name: PACKAGE, installed: true, version: '2.0.0' }], '2.0.0')
    current.controller.face().updateAll()
    expect(current.ctx.remote.pluginManager.updateBundle).not.toHaveBeenCalled()

    const { ctx, controller } = await loaded(
      [LISTING], [{ name: PACKAGE, installed: true, version: '1.0.0' }], '2.0.0',
    )
    const group = deferred()
    ctx.remote.pluginManager.updateBundle.mockImplementationOnce(async () => {
      await group.promise
      return updateAnswer(PACKAGE, '2.0.0')
    })
    controller.face().updateAll()
    await vi.waitFor(() => { expect(ctx.remote.pluginManager.updateBundle).toHaveBeenCalledTimes(1) })
    controller.face().updateAll()
    expect(ctx.remote.pluginManager.updateBundle).toHaveBeenCalledTimes(1)
    group.resolve()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().updatingAll).toBeNull() })

    const removal = deferred()
    ctx.remote.pluginManager.removeBundle.mockImplementationOnce(async () => {
      await removal.promise
      return { ok: true, value: { changed: true, application: 'applied' } }
    })
    const install = vi.fn()
    controller.face().update(LISTING, install)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().updating).toBe(PACKAGE) })
    controller.face().updateAll()
    expect(ctx.remote.pluginManager.updateBundle).toHaveBeenCalledTimes(1)
    removal.resolve()
    await vi.waitFor(() => { expect(install).toHaveBeenCalledTimes(1) })
  })

  it('drops a run disposed before or during it', async () => {
    const stopped = await loaded([LISTING], [{ name: PACKAGE, installed: true, version: '1.0.0' }], '2.0.0')
    stopped.controller.dispose()
    stopped.controller.face().updateAll()
    expect(stopped.ctx.remote.pluginManager.updateBundle).not.toHaveBeenCalled()

    const { ctx, controller } = await loaded(
      [LISTING], [{ name: PACKAGE, installed: true, version: '1.0.0' }], '2.0.0',
    )
    const pending = deferred()
    ctx.remote.pluginManager.updateBundle.mockImplementationOnce(async () => {
      await pending.promise
      return updateAnswer(PACKAGE, '2.0.0')
    })
    controller.face().updateAll()
    await vi.waitFor(() => { expect(ctx.remote.pluginManager.updateBundle).toHaveBeenCalledTimes(1) })
    controller.dispose()
    pending.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(controller.store.getSnapshot()).toMatchObject({ updatingAll: { done: 0 }, updateAllRestart: 0 })
  })
})
