/** Parsing and placeholder resolution for one catalog preset envelope. */

/** Package that owns each settings entry a preset may target. */
export const PRESET_TARGET_PACKAGES = {
  imagegen: '@q253595422/dsh-imagegen-video',
} as const

/** One validated preset from a catalog entry's `config`. */
export interface PresetEnvelope {
  readonly target: keyof typeof PRESET_TARGET_PACKAGES
  readonly policy: 'empty-only'
  readonly values: Record<string, unknown>
}

/** Placeholder names the Host can resolve for a preset. */
export type PresetPlaceholder = 'MIO_MODEL_BASE_URL' | 'MIO_API_KEY'

const PLACEHOLDER = /^\{\{([A-Z0-9_]+)\}\}$/u

/** @param value - candidate JSON value. @returns whether it is a non-array object. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the product preset envelope from a catalog entry's config.
 * @param config - backend config object, or null when unconfigured.
 * @returns the validated preset, or null when the object is not a product preset.
 * @throws Error when the object opts into the envelope with an unsupported field.
 */
export function readPreset(config: Record<string, unknown> | null): PresetEnvelope | null {
  if (config === null) return null
  const schemaVersion = config.schemaVersion
  if (schemaVersion !== undefined && schemaVersion !== 1) throw new Error('unsupported preset schemaVersion')
  const target = config.target
  if (target === undefined && config.values === undefined) return null
  if (typeof target !== 'string' || !Object.hasOwn(PRESET_TARGET_PACKAGES, target)) {
    throw new Error(`unsupported preset target "${String(target)}"`)
  }
  const policy = config.policy ?? 'empty-only'
  if (policy !== 'empty-only') throw new Error(`unsupported preset policy "${String(policy)}"`)
  const values = config.values
  if (!isPlainObject(values)) throw new Error('preset values must be a JSON object')
  return { target: target as keyof typeof PRESET_TARGET_PACKAGES, policy: 'empty-only', values }
}

/**
 * Whether the target settings have no user-owned connection values.
 * @param target - validated preset target.
 * @param user - the settings service's user layer for that entry.
 * @returns whether the preset may fill the entry.
 */
export function isEmptyTargetUser(target: PresetEnvelope['target'], user: unknown): boolean {
  if (!isPlainObject(user)) return true
  if (target === 'imagegen') {
    if (Array.isArray(user.channels) && user.channels.length > 0) return false
    if (isPlainObject(user.channelSecrets) && Object.keys(user.channelSecrets).length > 0) return false
    if (typeof user.defaultChannelId === 'string' && user.defaultChannelId !== '') return false
    return true
  }
  return Object.keys(user).length === 0
}

/**
 * Replace exact `{{NAME}}` strings throughout a JSON value.
 * @param values - preset values with placeholders.
 * @param resolve - async resolver for one placeholder name.
 * @returns a detached value with every placeholder replaced.
 * @throws Error when a placeholder is unsupported or embedded in larger text.
 */
export async function resolvePresetValues(
  values: Record<string, unknown>,
  resolve: (placeholder: PresetPlaceholder) => string | Promise<string>,
): Promise<Record<string, unknown>> {
  const walk = async (value: unknown): Promise<unknown> => {
    if (typeof value === 'string') {
      const match = PLACEHOLDER.exec(value)
      if (match !== null) {
        const name = match[1]
        if (name === undefined) throw new Error('preset placeholder has no name')
        if (name !== 'MIO_MODEL_BASE_URL' && name !== 'MIO_API_KEY') {
          throw new Error(`unsupported preset placeholder "${name}"`)
        }
        return await resolve(name)
      }
      if (value.includes('{{')) throw new Error('preset placeholders must occupy the whole string')
      return value
    }
    if (Array.isArray(value)) return Promise.all(value.map(walk))
    if (isPlainObject(value)) {
      const entries = await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await walk(child)] as const))
      return Object.fromEntries(entries)
    }
    return value
  }
  return await walk(values) as Record<string, unknown>
}
