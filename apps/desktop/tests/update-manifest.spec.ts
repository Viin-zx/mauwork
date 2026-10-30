import { describe, expect, it, vi } from 'vitest'
import {
  compareReleases, manualUpdateSource, manualUpdateSourceFromManifest, releaseOf, releaseOfTag,
} from '../src/update-manifest.ts'

/** @param body - JSON the manifest request answers with. */
function fetchOf(body: unknown, status = 200) {
  return vi.fn(async () => ({ ok: status === 200, status, json: async () => body })) as unknown as typeof fetch
}

describe('manual update detection', () => {
  it('compares release counters numerically', () => {
    expect(compareReleases('0.0.10', '0.0.9')).toBeGreaterThan(0)
    expect(compareReleases('0.0.15', '0.0.15')).toBe(0)
    expect(compareReleases('0.0.9', '0.0.15')).toBeLessThan(0)
  })

  it('reads releases from build versions and zr- tags', () => {
    expect(releaseOf('0.2.1-rc.4.0.0.15', '0.2.1-rc.4')).toBe('0.0.15')
    expect(releaseOf('0.2.1-rc.4', '0.2.1-rc.4')).toBeUndefined()
    expect(releaseOf('0.9.0.0.0.1', '0.2.1-rc.4')).toBeUndefined()
    expect(releaseOfTag('zr-0.0.15')).toBe('0.0.15')
    expect(releaseOfTag('v0.0.15')).toBeUndefined()
  })

  it('reports only a release newer than the installed build', async () => {
    const read = fetchOf({ tag: 'zr-0.0.15' })
    const source = manualUpdateSource({
      origin: 'https://mirror.test/', productVersion: '0.2.1-rc.4',
      currentVersion: () => '0.2.1-rc.4.0.0.14', fetch: read,
    })
    expect(await source.latest()).toBe('0.0.15')
    expect(read).toHaveBeenCalledExactlyOnceWith(new URL('https://mirror.test/updates/latest.json'), { cache: 'no-store' })

    const current = manualUpdateSource({
      origin: 'https://mirror.test', productVersion: '0.2.1-rc.4',
      currentVersion: () => '0.2.1-rc.4.0.0.15', fetch: fetchOf({ tag: 'zr-0.0.15' }),
    })
    expect(await current.latest()).toBeUndefined()
  })

  it('answers nothing for a tag or build it cannot compare', async () => {
    const unknownTag = manualUpdateSource({
      origin: 'https://mirror.test', productVersion: '0.2.1-rc.4',
      currentVersion: () => '0.2.1-rc.4.0.0.15', fetch: fetchOf({ tag: 'nightly' }),
    })
    expect(await unknownTag.latest()).toBeUndefined()
    const unknownBuild = manualUpdateSource({
      origin: 'https://mirror.test', productVersion: '0.2.1-rc.4',
      currentVersion: () => '9.9.9', fetch: fetchOf({ tag: 'zr-0.0.15' }),
    })
    expect(await unknownBuild.latest()).toBeUndefined()
  })

  it('rejects a failed manifest request so the caller stays silent', async () => {
    const source = manualUpdateSource({
      origin: 'https://mirror.test', productVersion: '0.2.1-rc.4',
      currentVersion: () => '0.2.1-rc.4.0.0.14', fetch: fetchOf({}, 503),
    })
    await expect(source.latest()).rejects.toThrow(/latest\.json answered 503/u)
  })

  it('builds a source only from a complete https manifest', () => {
    const facts = { dshDownloadOrigin: 'https://mirror.test', dshProductVersion: '0.2.1-rc.4' }
    expect(manualUpdateSourceFromManifest(facts, () => '0.2.1-rc.4.0.0.1')).toBeDefined()
    expect(manualUpdateSourceFromManifest({ dshProductVersion: '0.2.1-rc.4' }, () => '')).toBeUndefined()
    expect(manualUpdateSourceFromManifest({ ...facts, dshDownloadOrigin: 'http://mirror.test' }, () => '')).toBeUndefined()
    expect(manualUpdateSourceFromManifest(null, () => '')).toBeUndefined()
  })
})
