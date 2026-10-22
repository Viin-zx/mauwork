import { describe, expect, it } from 'vitest'
import { isEmptyTargetUser, PRESET_TARGET_PACKAGES, readPreset, resolvePresetValues } from '../src/preset.ts'

describe('catalog preset envelope', () => {
  it('ignores an unconfigured entry and a plain object that is not a preset', () => {
    expect(readPreset(null)).toBeNull()
    expect(readPreset({ endpoint: 'https://example.com' })).toBeNull()
  })

  it('reads the supported envelope', () => {
    expect(readPreset({
      schemaVersion: 1,
      target: 'imagegen',
      policy: 'empty-only',
      values: { channels: [] },
    })).toEqual({
      target: 'imagegen',
      policy: 'empty-only',
      values: { channels: [] },
    })
  })

  it('defaults the policy and rejects unsupported fields', () => {
    expect(readPreset({ target: 'imagegen', values: {} })).toEqual({
      target: 'imagegen', policy: 'empty-only', values: {},
    })
    expect(() => readPreset({ schemaVersion: 2, target: 'imagegen', values: {} })).toThrow('schemaVersion')
    expect(() => readPreset({ target: 'other', values: {} })).toThrow('target')
    expect(() => readPreset({ target: 'imagegen', policy: 'overwrite', values: {} })).toThrow('policy')
    expect(() => readPreset({ target: 'imagegen', values: [] })).toThrow('values')
  })

  it('maps the imagegen target to its package', () => {
    expect(PRESET_TARGET_PACKAGES.imagegen).toBe('@q253595422/dsh-imagegen-video')
  })

  it('treats only user-owned channels as configured', () => {
    expect(isEmptyTargetUser('imagegen', undefined)).toBe(true)
    expect(isEmptyTargetUser('imagegen', {})).toBe(true)
    expect(isEmptyTargetUser('imagegen', { enabled: false, channels: [] })).toBe(true)
    expect(isEmptyTargetUser('imagegen', { channels: [{ id: 'mine' }] })).toBe(false)
    expect(isEmptyTargetUser('imagegen', { channelSecrets: { mine: '{{MIO_API_KEY}}' } })).toBe(false)
    expect(isEmptyTargetUser('imagegen', { defaultChannelId: 'mine' })).toBe(false)
  })
})

describe('preset placeholder resolution', () => {
  it('replaces exact placeholders throughout nested objects and arrays', async () => {
    expect(await resolvePresetValues({
      channels: [{ apiUrl: '{{MIO_MODEL_BASE_URL}}', secrets: { key: '{{MIO_API_KEY}}' } }],
      plain: 'value',
      count: 2,
    }, async placeholder => placeholder === 'MIO_MODEL_BASE_URL' ? 'https://models.test/v1' : 'sk-test'))
      .toEqual({
        channels: [{ apiUrl: 'https://models.test/v1', secrets: { key: 'sk-test' } }],
        plain: 'value',
        count: 2,
      })
  })

  it('rejects unknown and embedded placeholders', async () => {
    await expect(resolvePresetValues({ value: '{{UNKNOWN}}' }, async () => 'x')).rejects.toThrow('unsupported')
    await expect(resolvePresetValues({ value: 'prefix {{MIO_API_KEY}}' }, async () => 'x')).rejects.toThrow('whole string')
  })
})
