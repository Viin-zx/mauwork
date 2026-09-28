import { describe, expect, it } from 'vitest'
import { mioModelVoToConfig } from '../../../src/main/auth/mioModelSync'
import type { MioModelVo } from '../../../src/main/auth/authService'
import { ApiEndpointType, ModelType } from '../../../src/shared/model'
import { DEFAULT_MODEL_TIMEOUT } from '../../../src/shared/modelConfigDefaults'

const makeVo = (overrides: Partial<MioModelVo> = {}): MioModelVo => ({
  localModelId: 1,
  modelId: 'tts-model',
  displayName: 'TTS Model',
  providerName: 'zr',
  modelType: 'TTS',
  requestTimeoutMs: 600000,
  isDefault: false,
  parameters: {},
  ...overrides
})

describe('mioModelVoToConfig TTS 参数映射', () => {
  it('将 speechAgentId / audioFormat 映射进 config.tts（音频格式转小写）', () => {
    const config = mioModelVoToConfig(
      makeVo({
        parameters: {
          speechAgentId: '2',
          audioFormat: 'MP3',
          temperature: 0.71
        }
      })
    )

    expect(config.type).toBe(ModelType.TTS)
    expect(config.tts).toEqual({ voice: '2', responseFormat: 'mp3' })
    expect(config.temperature).toBe(0.71)
    expect(config.apiEndpoint).toBe(ApiEndpointType.Chat)
  })

  it('非 TTS 模型不写入 tts，即使携带 TTS 参数', () => {
    const config = mioModelVoToConfig(
      makeVo({
        modelType: 'LANGUAGE',
        parameters: { speechAgentId: '2', audioFormat: 'MP3' }
      })
    )

    expect(config.type).toBe(ModelType.Chat)
    expect(config.tts).toBeUndefined()
  })

  it('TTS 模型缺少有效 TTS 参数时不写入 tts', () => {
    const config = mioModelVoToConfig(makeVo({ parameters: { temperature: 0.5 } }))

    expect(config.tts).toBeUndefined()
    expect(config.temperature).toBe(0.5)
  })

  it('不受支持的音频格式不写入 responseFormat', () => {
    const config = mioModelVoToConfig(
      makeVo({ parameters: { speechAgentId: '2', audioFormat: 'OGG' } })
    )

    expect(config.tts).toEqual({ voice: '2' })
  })

  it('超时时间回退到默认值', () => {
    const config = mioModelVoToConfig(makeVo({ requestTimeoutMs: 0 }))

    expect(config.timeout).toBe(DEFAULT_MODEL_TIMEOUT)
  })
})
