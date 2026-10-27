/**
 * Profile-local markers the catalog preset reads and writes: the force intent,
 * the handled defaults, and the applied installs.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

/** Directory under the profile's storage that holds the preset markers. */
export const PENDING_DIRECTORY = 'mio-plugin-preset'
/** File naming packages whose installation must overwrite their preset target. */
const PENDING_FILE = 'pending.json'
/** File naming default packages already handled for this profile. */
const DEFAULTS_FILE = 'defaults.json'
/** File naming packages whose preset has been applied; a reinstall re-applies. */
const APPLIED_FILE = 'applied.json'

/** The subset of the profile context the markers are keyed by. */
export interface MarkerProfile {
  readonly name: string
  readonly home: string
}

/**
 * Path of the marker naming packages whose install must overwrite its preset target.
 * @param profile - the active profile.
 * @returns the profile-local pending marker path.
 */
export function pendingPath(profile: MarkerProfile): string {
  return join(profile.home, 'storages', PENDING_DIRECTORY, `${profile.name}.${PENDING_FILE}`)
}

/**
 * Path of the marker naming packages whose preset has already been applied.
 * @param profile - the active profile.
 * @returns the profile-local applied marker path.
 */
export function appliedPath(profile: MarkerProfile): string {
  return join(profile.home, 'storages', PENDING_DIRECTORY, `${profile.name}.${APPLIED_FILE}`)
}

/**
 * Path of the marker naming default packages this profile already handled.
 * @param profile - the active profile.
 * @returns the profile-local handled-defaults marker path.
 */
export function defaultsPath(profile: MarkerProfile): string {
  return join(profile.home, 'storages', PENDING_DIRECTORY, `${profile.name}.${DEFAULTS_FILE}`)
}

/**
 * Read a string-set marker file; an absent or unreadable file is the empty set.
 * @param path - marker path under the profile's storage directory.
 * @returns the persisted names.
 */
export async function readMarkerSet(path: string): Promise<Set<string>> {
  try {
    const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
    return new Set(Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : [])
  } catch {
    return new Set()
  }
}

/**
 * Persist a string-set marker atomically; the sweep continues when the write fails.
 * @param ctx - context whose logger records a failed write.
 * @param path - marker path under the profile's storage directory.
 * @param values - names to persist.
 */
export async function writeMarkerSet(ctx: Context, path: string, values: ReadonlySet<string>): Promise<void> {
  const profile = profileOf(ctx)
  if (profile === undefined) return
  try {
    await mkdir(join(profile.home, 'storages', PENDING_DIRECTORY), { recursive: true })
    const temporary = `${path}.tmp`
    await writeFile(temporary, JSON.stringify([...values]), 'utf8')
    await rename(temporary, path)
  } catch (error) {
    ctx.logger.warn('mio-plugin-preset: could not persist %s: %s', path, String(error))
  }
}

/**
 * Resolve the active profile without requiring its service type in this package.
 * @param ctx - context that may provide `profileContext`.
 * @returns the profile's name and home, or undefined when no profile is bound.
 */
export function profileOf(ctx: Context): MarkerProfile | undefined {
  const profile = ctx.get('profileContext') as MarkerProfile | undefined
  return profile !== undefined && typeof profile.home === 'string' && typeof profile.name === 'string'
    ? profile
    : undefined
}
