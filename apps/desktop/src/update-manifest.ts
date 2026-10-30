/** Version detection for an installation that carries no updater feed (an unsigned macOS bundle). */

/** One source that only answers whether a newer release exists. */
export interface ManualUpdateSource {
  /**
   * Read the published release and compare it with the installed build.
   * @returns the newer release's display version, or undefined when current or unknown.
   */
  latest(): Promise<string | undefined>
}

/** Everything the manifest-backed source needs. */
export interface ManualUpdateOptions {
  /** Origin serving the website's `updates/latest.json`. */
  readonly origin: string
  /** Installed build version, such as `0.2.1-rc.4.0.0.15`. */
  readonly currentVersion: () => string
  /** Product version the build extends, such as `0.2.1-rc.4`. */
  readonly productVersion: string
  /** Fetch implementation; tests replace it. */
  readonly fetch?: typeof fetch
}

/** A release version: the numeric counter a `zr-` tag names, such as `0.0.15`. */
const RELEASE_PATTERN = /^\d+\.\d+\.\d+$/u

/**
 * Compare two dotted numeric releases.
 * @param left - one release, such as `0.0.9`.
 * @param right - the other release.
 * @returns negative, zero, or positive in `sort` convention.
 */
export function compareReleases(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * The release counter of one build version.
 * @param version - installed build version.
 * @param productVersion - product version the build extends.
 * @returns the trailing release, or undefined when the version does not extend the product version.
 */
export function releaseOf(version: string, productVersion: string): string | undefined {
  if (!version.startsWith(`${productVersion}.`)) return undefined
  const release = version.slice(productVersion.length + 1)
  return RELEASE_PATTERN.test(release) ? release : undefined
}

/**
 * Read the release a `zr-` tag names.
 * @param tag - published tag, such as `zr-0.0.15`.
 * @returns the release, or undefined for a tag this client does not read.
 */
export function releaseOfTag(tag: string): string | undefined {
  if (!tag.startsWith('zr-')) return undefined
  const release = tag.slice('zr-'.length)
  return RELEASE_PATTERN.test(release) ? release : undefined
}

/**
 * Build a detection source over the website manifest.
 * @param options - origin, installed version, and manifest facts.
 * @returns the source the Desktop update coordinator polls.
 */
export function manualUpdateSource(options: ManualUpdateOptions): ManualUpdateSource {
  const read = options.fetch ?? fetch
  return {
    async latest(): Promise<string | undefined> {
      const response = await read(new URL('updates/latest.json', `${options.origin.replace(/\/+$/u, '')}/`), {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`desktop update: latest.json answered ${String(response.status)}`)
      const body: unknown = await response.json()
      const tag = typeof body === 'object' && body !== null && 'tag' in body ? (body as { tag: unknown }).tag : undefined
      const release = typeof tag === 'string' ? releaseOfTag(tag) : undefined
      if (release === undefined) return undefined
      const current = releaseOf(options.currentVersion(), options.productVersion)
      if (current === undefined) return undefined
      return compareReleases(release, current) > 0 ? release : undefined
    },
  }
}

/**
 * Read the detection facts a packaged manifest carries.
 * @param manifest - parsed application manifest.
 * @param currentVersion - installed build version.
 * @returns the source, or undefined when the build cannot detect releases this way.
 */
export function manualUpdateSourceFromManifest(
  manifest: unknown, currentVersion: () => string,
): ManualUpdateSource | undefined {
  if (typeof manifest !== 'object' || manifest === null) return undefined
  const { dshDownloadOrigin, dshProductVersion } = manifest as Record<string, unknown>
  if (typeof dshDownloadOrigin !== 'string' || typeof dshProductVersion !== 'string') return undefined
  if (!dshDownloadOrigin.startsWith('https://')) return undefined
  return manualUpdateSource({ origin: dshDownloadOrigin, productVersion: dshProductVersion, currentVersion })
}
