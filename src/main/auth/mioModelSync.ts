import type { AuthService, MioModelVo, MioModelParameters } from './authService'
import { ApiEndpointType, ModelType } from '@shared/model'
import { isReasoningEffort } from '@shared/types/model-db'
import type { MODEL_META, ModelConfig } from '@shared/types/provider'
import { normalizeTtsSettings, type TtsResponseFormat, type TtsSettings } from '@shared/ttsSettings'
import {
  DEFAULT_MODEL_CONTEXT_LENGTH,
  DEFAULT_MODEL_FUNCTION_CALL,
  DEFAULT_MODEL_MAX_TOKENS,
  DEFAULT_MODEL_TIMEOUT,
  DEFAULT_MODEL_VISION
} from '@shared/modelConfigDefaults'
import { ZR_PROVIDER_ID } from './zrProviderSync'

export { ZR_PROVIDER_ID }

/**
 * 将 MioModelVo.modelType 字符串映射为 ModelType 枚举
 */
function mapModelType(rawType: string): ModelType | undefined {
  switch (rawType) {
    case 'LANGUAGE':
      return ModelType.Chat
    case 'EMBEDDING':
      return ModelType.Embedding
    case 'RERANK':
      return ModelType.Rerank
    case 'IMAGE':
      return ModelType.ImageGeneration
    case 'VIDEO':
      return ModelType.VideoGeneration
    case 'TTS':
      return ModelType.TTS
    default:
      return undefined
  }
}

/**
 * 从 MioModelParameters 中提取能力（vision / functionCall / reasoning）
 */
function extractCapabilities(params: MioModelParameters | undefined): {
  vision: boolean
  functionCall: boolean
  reasoning: boolean
  contextLength?: number
  maxTokens?: number
} {
  return {
    vision: params?.visionEnabled ?? false,
    functionCall: params?.functionCallingEnabled ?? false,
    reasoning: params?.reasoningEnabled ?? false,
    contextLength: params?.contextWindowTokens,
    maxTokens: params?.maxOutputTokens
  }
}

/**
 * 将单个 MioModelVo 转换为 MODEL_META
 */
export function mioModelVoToMeta(vo: MioModelVo, providerId: string): MODEL_META {
  const caps = extractCapabilities(vo.parameters)
  const type = mapModelType(vo.modelType)
  return {
    id: vo.modelId,
    name: vo.displayName || vo.modelId,
    group: vo.providerName || 'default',
    providerId,
    type,
    isDefault: vo.isDefault,
    contextLength: caps.contextLength,
    maxTokens: caps.maxTokens,
    vision: caps.vision,
    functionCall: caps.functionCall,
    reasoning: caps.reasoning
  }
}

/**
 * 将 MioModelVo[] 转换为 MODEL_META[]
 */
export function mioModelListToMetas(models: MioModelVo[], providerId: string): MODEL_META[] {
  return models.map((vo) => mioModelVoToMeta(vo, providerId))
}

/**
 * 从 MioModelParameters 中提取 TTS 设置（仅 TTS 模型，字段无效时不写入）
 *
 * 接口字段与 TtsSettings 字段的对应关系：
 * - speechAgentId → voice（语音 Agent ID）
 * - audioFormat → responseFormat（音频格式，接口为大写如 "MP3"，需转小写并校验）
 */
function extractTtsSettings(
  params: MioModelParameters | undefined,
  isTts: boolean
): TtsSettings | undefined {
  if (!isTts || !params) return undefined
  const candidate: TtsSettings = {}
  if (typeof params.speechAgentId === 'string') {
    candidate.voice = params.speechAgentId
  }
  if (typeof params.audioFormat === 'string') {
    candidate.responseFormat = params.audioFormat.trim().toLowerCase() as TtsResponseFormat
  }
  return normalizeTtsSettings(candidate)
}

/**
 * 将单个 MioModelVo 映射为 ModelConfig（接口参数 → 客户端模型设置）
 *
 * 接口字段与 ModelConfig 字段的对应关系：
 * - contextWindowTokens → contextLength
 * - maxOutputTokens → maxTokens
 * - visionEnabled → vision
 * - functionCallingEnabled → functionCall
 * - reasoningEnabled → reasoning
 * - speechRecognitionEnabled → speechRecognition（接口未下发时不写入，避免覆盖用户手动配置）
 * - requestTimeoutMs → timeout
 * - temperature / topP / reasoningEffort 直映
 * - speechAgentId / audioFormat → tts（仅 TTS 模型）
 * - modelType → type
 */
export function mioModelVoToConfig(vo: MioModelVo): ModelConfig {
  const params = vo.parameters
  const reasoningEffort = params?.reasoningEffort
  const type = mapModelType(vo.modelType) ?? ModelType.Chat
  const tts = extractTtsSettings(params, type === ModelType.TTS)
  return {
    maxTokens: params?.maxOutputTokens ?? DEFAULT_MODEL_MAX_TOKENS,
    contextLength: params?.contextWindowTokens ?? DEFAULT_MODEL_CONTEXT_LENGTH,
    timeout: vo.requestTimeoutMs || DEFAULT_MODEL_TIMEOUT,
    temperature: params?.temperature,
    topP: params?.topP,
    vision: params?.visionEnabled ?? DEFAULT_MODEL_VISION,
    functionCall: params?.functionCallingEnabled ?? DEFAULT_MODEL_FUNCTION_CALL,
    reasoning: params?.reasoningEnabled ?? false,
    speechRecognition: params?.speechRecognitionEnabled,
    type,
    reasoningEffort:
      reasoningEffort && isReasoningEffort(reasoningEffort) ? reasoningEffort : undefined,
    apiEndpoint: ApiEndpointType.Chat,
    ...(tts ? { tts } : {})
  }
}

/**
 * 通过 AuthService 拉取 /models 并更新 zr provider 的模型列表
 *
 * @param auth AuthService 实例
 * @param setProviderModels 写 provider 模型列表的函数
 * @param notifyModelsChanged 通知渲染层模型列表已变更的函数
 * @returns 模型列表，失败返回 null
 */
export async function refreshZrModels(
  auth: AuthService,
  setProviderModels: (providerId: string, models: MODEL_META[]) => void,
  notifyModelsChanged: (providerId?: string) => void,
  setModelsEnabled?: (providerId: string, modelIds: string[], enabled: boolean) => void,
  setModelConfig?: (modelId: string, providerId: string, config: ModelConfig) => void
): Promise<MODEL_META[] | null> {
  if (!auth.isAuthenticated()) {
    console.warn('[ZrModels] 跳过刷新：未登录')
    return null
  }

  // forceFresh: API 失败时 fetchModels 返回 null 而非旧缓存，
  // 避免用过期模型列表覆盖存储中已有的数据
  const models = await auth.fetchModels({ forceFresh: true })
  if (!models || models.length === 0) {
    console.warn('[ZrModels] 获取模型列表为空或拉取失败，跳过更新')
    return null
  }

  // /mio/client/v1/models 返回的都是服务端已启用的模型，这里全部标记为开启
  if (setModelsEnabled) {
    setModelsEnabled(
      ZR_PROVIDER_ID,
      models.map((vo) => vo.modelId),
      true
    )
  }

  const metas = mioModelListToMetas(models, ZR_PROVIDER_ID)
  console.info(`[ZrModels] 转换 ${metas.length} 个模型 MODEL_META`)

  setProviderModels(ZR_PROVIDER_ID, metas)
  notifyModelsChanged(ZR_PROVIDER_ID)

  // 同步接口返回的模型参数到本地模型配置，使「模型设置」能展示服务端配置
  if (setModelConfig) {
    for (const vo of models) {
      setModelConfig(vo.modelId, ZR_PROVIDER_ID, mioModelVoToConfig(vo))
    }
    console.info(`[ZrModels] 同步 ${models.length} 个模型配置到本地模型设置`)
  }

  return metas
}

/** refreshZrModelsWithSettings 依赖的最小设置端口 */
export interface ZrModelSettingsPort {
  setProviderModels(providerId: string, models: MODEL_META[]): void
  notifyModelsChanged(providerId?: string): void
  batchSetModelStatus(providerId: string, modelStatusMap: Record<string, boolean>): void
  /** 写入单个模型的完整配置（接口参数 → 客户端模型设置） */
  setModelConfig(modelId: string, providerId: string, config: ModelConfig): void
}

/**
 * refreshZrModels 的便捷封装：写入/通知/启用回调固定落到 ProviderSettings，
 * 供启动同步、登录回调和运行时兜底刷新共用，避免各调用点重复拼回调。
 */
export async function refreshZrModelsWithSettings(
  auth: AuthService,
  providerSettings: ZrModelSettingsPort
): Promise<MODEL_META[] | null> {
  return refreshZrModels(
    auth,
    (providerId, models) => providerSettings.setProviderModels(providerId, models),
    (providerId) => providerSettings.notifyModelsChanged(providerId),
    (providerId, modelIds, enabled) =>
      providerSettings.batchSetModelStatus(
        providerId,
        Object.fromEntries(modelIds.map((modelId) => [modelId, enabled]))
      ),
    (modelId, providerId, config) => providerSettings.setModelConfig(modelId, providerId, config)
  )
}
