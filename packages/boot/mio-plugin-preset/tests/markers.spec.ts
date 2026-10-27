/** Reading and writing the profile-local markers the catalog preset keeps. */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  appliedPath, defaultsPath, pendingPath, profileOf, readMarkerSet, writeMarkerSet,
} from '../src/markers.ts'
import { fixture, roots } from './fixture.ts'

afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

/** @returns a temporary profile home that is removed when the test finishes. */
async function temporaryHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mio-preset-'))
  onTestFinished(() => rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }))
  return home
}

describe('marker paths', () => {
  it('keys every marker file by the profile name under its storage directory', () => {
    const paths = [pendingPath, appliedPath, defaultsPath]
      .map(path => path({ name: 'desktop', home: '/home' }))
    expect(paths).toEqual([
      join('/home', 'storages', 'mio-plugin-preset', 'desktop.pending.json'),
      join('/home', 'storages', 'mio-plugin-preset', 'desktop.applied.json'),
      join('/home', 'storages', 'mio-plugin-preset', 'desktop.defaults.json'),
    ])
  })
})

describe('profileOf', () => {
  it('reads the bound profile', () => {
    expect(profileOf(fixture({ home: '/home' }).ctx)).toEqual({ name: 'desktop', home: '/home' })
  })

  it.each([
    ['absent', undefined],
    ['half a profile', { name: 'desktop' }],
    ['value that is not an object', 7],
  ])('rejects a %s', (_label, value) => {
    const { ctx } = fixture()
    if (value !== undefined) ctx.provide('profileContext', value as never)
    expect(profileOf(ctx)).toBeUndefined()
  })
})

describe('readMarkerSet', () => {
  it('reads the persisted names, dropping an absent, unreadable, or malformed marker', async () => {
    const home = await temporaryHome()
    const path = pendingPath({ name: 'desktop', home })
    await mkdir(join(home, 'storages', 'mio-plugin-preset'), { recursive: true })
    expect([...await readMarkerSet(path)]).toEqual([])

    await writeFile(path, JSON.stringify(['@acme/dsh-one', 7, null, '@acme/dsh-two']), 'utf8')
    expect([...await readMarkerSet(path)]).toEqual(['@acme/dsh-one', '@acme/dsh-two'])

    await writeFile(path, '{', 'utf8')
    expect([...await readMarkerSet(path)]).toEqual([])

    await writeFile(path, JSON.stringify({ packageName: '@acme/dsh-one' }), 'utf8')
    expect([...await readMarkerSet(path)]).toEqual([])
  })
})

describe('writeMarkerSet', () => {
  it('persists the names for a bound profile and keeps sweeping when the write fails', async () => {
    const home = await temporaryHome()
    const { ctx } = fixture({ home })
    const warn = vi.spyOn(ctx.logger, 'warn')
    const path = defaultsPath({ name: 'desktop', home })

    await writeMarkerSet(ctx, path, new Set(['@acme/dsh-one', '@acme/dsh-two']))
    expect(JSON.parse(await readFile(path, 'utf8')) as string[]).toEqual(['@acme/dsh-one', '@acme/dsh-two'])
    expect(warn).not.toHaveBeenCalled()

    // A marker path whose parent is a file cannot be created, and the sweep must survive it.
    await writeMarkerSet(ctx, join(path, 'nested.json'), new Set(['@acme/dsh-one']))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('could not persist')
  })

  it('writes nothing when no profile is bound', async () => {
    const { ctx } = fixture()
    const warn = vi.spyOn(ctx.logger, 'warn')
    await writeMarkerSet(ctx, pendingPath({ name: 'desktop', home: '/home' }), new Set(['@acme/dsh-one']))
    expect(warn).not.toHaveBeenCalled()
  })
})
