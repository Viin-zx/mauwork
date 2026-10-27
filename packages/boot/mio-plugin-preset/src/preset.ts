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

/**
 * Whether a JSON value is an object rather than an array or a scalar.
 * @param value - candidate JSON value.
 * @returns whether it is a non-array object.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @param value - candidate JSON value. @returns whether it is an array. */
function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
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
  if (policy !== 'empty-only') throw new Error(`unsupported preset policy "${JSON.stringify(policy)}"`)
  const values = config.values
  if (!isPlainObject(values)) throw new Error('preset values must be a JSON object')
  return { target: target as keyof typeof PRESET_TARGET_PACKAGES, policy: 'empty-only', values }
}

/**
 * Whether the target settings have no user-owned connection values.
 * @param user - the settings service's user layer for that entry.
 * @returns whether the preset may fill the entry.
 */
export function isEmptyTargetUser(user: unknown): boolean {
  if (!isPlainObject(user)) return true
  if (isArray(user.channels) && user.channels.length > 0) return false
  if (isPlainObject(user.channelSecrets) && Object.keys(user.channelSecrets).length > 0) return false
  if (typeof user.defaultChannelId === 'string' && user.defaultChannelId !== '') return false
  return true
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

/** Fields a credential refresh may rewrite inside an existing user layer. */
export interface PresetRefreshPatch {
  readonly apiUrl?: string
  readonly channels?: unknown[]
  readonly channelSecrets?: Record<string, string>
}

/**
 * Rewrite only the preset-managed connection values of an existing user layer.
 * A channel the user deleted is never recreated, and unrelated channels and
 * settings stay untouched.
 * @param values - preset values with placeholders intact.
 * @param resolved - the same values with account placeholders resolved.
 * @param user - the target entry's user layer as the settings descriptor reports it.
 * @returns fields to merge, or undefined when nothing managed changed.
 */
export function refreshPresetUser(
  values: Record<string, unknown>, resolved: Record<string, unknown>, user: unknown,
): PresetRefreshPatch | undefined {
  if (!isPlainObject(user)) return undefined
  const patch: { apiUrl?: string; channels?: unknown[]; channelSecrets?: Record<string, string> } = {}

  if (values.apiUrl === '{{MIO_MODEL_BASE_URL}}' && typeof resolved.apiUrl === 'string'
    && user.apiUrl !== resolved.apiUrl) {
    patch.apiUrl = resolved.apiUrl
  }

  const presetChannels = isArray(values.channels) ? values.channels : []
  const resolvedChannels = isArray(resolved.channels) ? resolved.channels : []
  const userChannels = isArray(user.channels) ? user.channels : undefined
  if (userChannels !== undefined && presetChannels.length > 0) {
    const next = userChannels.map((item) => {
      if (!isPlainObject(item) || typeof item.id !== 'string') return item
      const index = presetChannels.findIndex(candidate => isPlainObject(candidate) && candidate.id === item.id)
      if (index < 0) return item
      const template = presetChannels[index]
      const current = resolvedChannels[index]
      if (!isPlainObject(template) || !isPlainObject(current)) return item
      if (template.apiUrl !== '{{MIO_MODEL_BASE_URL}}' || typeof current.apiUrl !== 'string') return item
      if (item.apiUrl === current.apiUrl) return item
      return { ...item, apiUrl: current.apiUrl }
    })
    if (next.some((item, index) => item !== userChannels[index])) patch.channels = next
  }

  const presetSecrets = isPlainObject(values.channelSecrets) ? values.channelSecrets : {}
  const resolvedSecrets = isPlainObject(resolved.channelSecrets) ? resolved.channelSecrets : {}
  if (userChannels !== undefined && Object.keys(presetSecrets).length > 0) {
    const secrets: Record<string, string> = {}
    if (isPlainObject(user.channelSecrets)) {
      for (const [key, value] of Object.entries(user.channelSecrets)) {
        if (typeof value === 'string') secrets[key] = value
      }
    }
    const nextSecrets = { ...secrets }
    for (const [id, placeholder] of Object.entries(presetSecrets)) {
      if (placeholder !== '{{MIO_API_KEY}}') continue
      if (!userChannels.some(candidate => isPlainObject(candidate) && candidate.id === id)) continue
      const value = resolvedSecrets[id]
      if (typeof value !== 'string') continue
      nextSecrets[id] = value
    }
    if (Object.entries(nextSecrets).some(([key, value]) => secrets[key] !== value)) {
      patch.channelSecrets = nextSecrets
    }
  }

  return Object.keys(patch).length === 0 ? undefined : patch
}
