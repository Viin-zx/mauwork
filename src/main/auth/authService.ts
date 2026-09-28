import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** mioagent 业务后端地址（含接口前缀）。构建时注入：dev 模式用 .env.development，生产模式用 .env.production，未配置时回退开发环境 */
const API_BASE_URL =
  import.meta.env.VITE_MIOAGENT_BASE_URL ||
  'https://mioagent.dev.zrshuiwu.com/prod-api/mio/client/v1'
const COUNTRY_CODE = '+86'
const TOKEN_FILE_NAME = 'mio-auth.json'

export type SmsScene = 'REGISTER' | 'LOGIN'

interface MioUser {
  userId?: string
  mobile?: string
  maskedPhone?: string
  nickname?: string
  accountStatus?: string
  credentialStatus?: string
}

/** 后端登录/注册成功响应 data（MioLoginVo） */
interface MioLoginVo {
  accessToken: string
  tokenType?: string
  expiresIn?: number
  user?: MioUser
  accountStatus?: string
}

/** 模型网关配置（POST /models/config 返回） */
export interface MioModelConfig {
  baseUrl: string
  apiKey: string
  credentialVersion?: number
  /** ISO 8601 字符串，后端返回的 apiKey 过期时间 */
  expiresAt?: string
}

/** 可购买套餐（GET /plans 返回的单条 plan） */
export interface MioPlan {
  planId: number
  planName: string
  /** 本地展示分类：MONTHLY / QUARTERLY / YEARLY；不决定订阅有效期 */
  planType: string
  /** 本地配置的普通文本套餐内容 */
  planContent: string
  quota: number
  /** NewAPI 每用户历史订阅次数上限；0 表示不限 */
  maxPurchasePerUser: number
  price: number
  currency: string
  durationUnit: string
  durationValue: number
  customSeconds: number
  quotaResetPeriod: string
  quotaResetCustomSeconds: number
}

/** 购买结果（POST /plans/{planId}/purchase 返回的 data） */
export interface MioPurchaseResult {
  orderNo: string
  paymentStatus: string
  paymentChannel?: string | null
  paymentScene?: string | null
  codeUrl?: string | null
  expireTime?: string | null
  grantStatus: string
  subscriptionId: number | null
}

/** 订单状态（GET /orders/{orderNo} 返回的 data） */
export interface MioOrderStatus {
  orderNo: string
  paymentStatus: string
  paymentChannel?: string | null
  paymentScene?: string | null
  codeUrl?: string | null
  expireTime?: string | null
  grantStatus: string
  subscriptionId?: number | null
}

/** 单条订阅信息（GET /subscriptions 返回的 items[]） */
export interface MioSubscription {
  subscriptionId: number
  planId: number
  planName: string
  amountTotal: number
  amountUsed: number
  startTime: string
  endTime: string
  status: string
  lastResetTime?: string
  nextResetTime?: string
  allowWalletOverflow: boolean
}

/** 订阅列表响应（GET /subscriptions 返回的 data） */
export interface MioSubscriptionsResult {
  items: MioSubscription[]
  realtime: boolean
}

/** 账户额度（GET /quota 返回的 data） */
export interface MioQuota {
  remainingQuota?: number | null
  usedQuota?: number | null
  unit?: string | null
  fetchedAt?: string | null
}

/** 协议类型 */
export type MioAgreementType = 'USER' | 'PRIVACY' | 'SUBSCRIPTION'

/** 单条协议（GET /agreements 返回的 data[]） */
export interface MioAgreement {
  agreementType: MioAgreementType
  title: string
  content: string
  updateTime?: string | null
}

/** 单个模型参数 */
export interface MioModelParameters {
  contextWindowTokens?: number
  maxOutputTokens?: number
  visionEnabled?: boolean
  functionCallingEnabled?: boolean
  reasoningEnabled?: boolean
  speechRecognitionEnabled?: boolean
  temperature?: number
  topP?: number
  reasoningEffort?: string
  [key: string]: unknown
}

/** 单个模型（GET /models 返回的 items[]） */
export interface MioModelVo {
  localModelId: number
  modelId: string
  displayName: string
  providerName: string
  modelType: string
  requestTimeoutMs: number
  isDefault: boolean
  parameters: MioModelParameters
}

/** 模型列表响应（GET /models 返回的 data） */
export interface MioModelListVo {
  items: MioModelVo[]
}

interface StoredSession {
  accessToken: string
  /** 过期时间戳（毫秒），null 表示未知 */
  expiresAt: number | null
  user: MioUser | null
  /** 模型网关配置缓存，credentialVersion 变化或 expiresAt 到期需重拉 */
  modelConfig?: MioModelConfig | null
  /** 模型列表缓存 */
  models?: MioModelVo[] | null
}

interface SmsCodeResult {
  smsRequestId?: string
  retryAfterSeconds?: number
  expiresIn?: number
}

/** 后端通用响应体 */
interface ApiResponse<T> {
  code?: number
  msg?: string
  data?: T
  errorCode?: string
  traceId?: string
}

/** 后端业务错误：携带 msg 面向用户展示，errorCode 供程序判断 */
class MioApiError extends Error {
  constructor(
    public readonly msg: string,
    public readonly errorCode?: string,
    public readonly traceId?: string
  ) {
    super(msg)
    this.name = 'MioApiError'
  }
}

async function postJson<T>(path: string, body: unknown, accessToken?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })
  } catch {
    throw new MioApiError('网络连接失败，请检查网络后重试', 'NETWORK_ERROR')
  }

  let json: ApiResponse<T> | null = null
  try {
    json = (await res.json()) as ApiResponse<T>
  } catch {
    // 响应体非 JSON
  }

  if (!res.ok || !json || json.code !== 200) {
    throw new MioApiError(
      json?.msg || `请求失败（HTTP ${res.status}）`,
      json?.errorCode,
      json?.traceId
    )
  }

  return json.data as T
}

async function getJson<T>(path: string, accessToken?: string): Promise<T> {
  const headers: Record<string, string> = {}
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { method: 'GET', headers })
  } catch {
    throw new MioApiError('网络连接失败，请检查网络后重试', 'NETWORK_ERROR')
  }

  let json: ApiResponse<T> | null = null
  try {
    json = (await res.json()) as ApiResponse<T>
  } catch {
    // 响应体非 JSON
  }

  if (!res.ok || !json || json.code !== 200) {
    throw new MioApiError(
      json?.msg || `请求失败（HTTP ${res.status}）`,
      json?.errorCode,
      json?.traceId
    )
  }

  return json.data as T
}

/**
 * 登录门禁：对接 mioagent 业务后端。
 * accessToken 使用 Electron safeStorage 加密后持久化到 userData，重启保持登录态。
 */
export class AuthService {
  private session: StoredSession | null = null

  constructor() {
    this.loadSession()
  }

  isAuthenticated(): boolean {
    if (!this.session) {
      return false
    }
    if (this.session.expiresAt !== null && Date.now() >= this.session.expiresAt) {
      this.clearSession()
      return false
    }
    return true
  }

  /** 当前登录用户信息（未登录返回 null） */
  getCurrentUser(): MioUser | null {
    if (!this.isAuthenticated()) {
      return null
    }
    return this.session?.user ?? null
  }

  /**
   * 读取会话里的 userId，仅用于启动阶段解析账号数据目录。
   * 不校验/清理过期会话：即使 token 过期，也要让本次启动落在同一账号目录，
   * 由渲染层引导重新登录后再切换。
   */
  peekUserId(): string | null {
    return this.session?.user?.userId?.trim() || null
  }

  /** 读取会话里的 accessToken，仅用于启动阶段调试日志；未登录返回 null */
  peekAccessToken(): string | null {
    return this.session?.accessToken ?? null
  }

  /** 拉取最新用户资料（GET /users/me），失败时回退本地会话缓存 */
  async fetchCurrentUser(): Promise<MioUser | null> {
    if (!this.isAuthenticated()) {
      return null
    }
    const token = this.session?.accessToken
    try {
      const data = await getJson<MioUser>('/users/me', token)
      if (data && this.session) {
        // 合并最新资料：跳过 null/undefined，避免后端部分返回时清掉本地已知信息
        const merged: MioUser = { ...this.session.user }
        for (const [key, value] of Object.entries(data)) {
          if (value !== null && value !== undefined) {
            ;(merged as Record<string, unknown>)[key] = value
          }
        }
        this.session = { ...this.session, user: merged }
        this.persistSession()
      }
      return this.session?.user ?? null
    } catch (error) {
      console.warn('[AuthService] Failed to fetch user profile:', error)
      return this.session?.user ?? null
    }
  }

  /** 读取本地缓存的模型网关配置（未登录或未拉过返回 null） */
  getCachedModelConfig(): MioModelConfig | null {
    if (!this.isAuthenticated()) {
      return null
    }
    return this.session?.modelConfig ?? null
  }

  /** 缓存的 apiKey 是否过期或需要刷新 */
  modelConfigNeedsRefresh(force = false): boolean {
    if (!this.isAuthenticated()) {
      return false
    }
    if (force || !this.session?.modelConfig) {
      return true
    }
    const exp = this.session.modelConfig.expiresAt
    if (exp) {
      const expiresMs = new Date(exp).getTime()
      // 提前 5 分钟判定过期，避免刚好到点请求模型时失败
      if (Date.now() >= expiresMs - 5 * 60 * 1000) {
        return true
      }
    }
    return false
  }

  /** 拉取模型网关配置（POST /models/config），失败返回 null 且保留旧缓存 */
  async fetchModelConfig(force = false): Promise<MioModelConfig | null> {
    if (!this.isAuthenticated()) {
      return null
    }
    if (!this.modelConfigNeedsRefresh(force)) {
      const cached = this.session?.modelConfig ?? null
      console.info(
        `[ModelsConfig] 跳过拉取：缓存有效 (credentialVersion=${cached?.credentialVersion ?? '?'}, expiresAt=${cached?.expiresAt ?? '?'})`
      )
      return cached
    }
    const token = this.session?.accessToken
    console.info(
      `[ModelsConfig] POST ${API_BASE_URL}/models/config (Bearer ***${token ? token.slice(-8) : '(none)'})`
    )
    const startMs = Date.now()
    try {
      const data = await postJson<MioModelConfig>('/models/config', {}, token)
      if (data && this.session) {
        this.session = { ...this.session, modelConfig: data }
        this.persistSession()
      }
      console.info(
        `[ModelsConfig] ✅ ${API_BASE_URL}/models/config → baseUrl=${data?.baseUrl ?? '?'} credentialVersion=${data?.credentialVersion ?? '?'} expiresAt=${data?.expiresAt ?? '?'} apiKey=***${data?.apiKey ? data.apiKey.slice(-6) : '?'} (${Date.now() - startMs}ms)`
      )
      return this.session?.modelConfig ?? null
    } catch (error) {
      console.warn(
        `[ModelsConfig] ❌ ${API_BASE_URL}/models/config failed after ${Date.now() - startMs}ms:`,
        error
      )
      return this.session?.modelConfig ?? null
    }
  }

  /** 读取缓存的模型列表（未登录或未拉过返回 null） */
  getCachedModels(): MioModelVo[] | null {
    if (!this.isAuthenticated()) {
      return null
    }
    return this.session?.models ?? null
  }

  /** 拉取模型列表（GET /models），失败返回 null 且保留旧缓存 */
  async fetchModels(options?: { forceFresh?: boolean }): Promise<MioModelVo[] | null> {
    if (!this.isAuthenticated()) {
      return null
    }
    const token = this.session?.accessToken
    console.info(
      `[Models] GET ${API_BASE_URL}/models (Bearer ***${token ? token.slice(-8) : '(none)'})`
    )
    const startMs = Date.now()
    try {
      const data = await getJson<MioModelListVo>('/models', token)
      const items = data?.items ?? []
      if (this.session) {
        this.session = { ...this.session, models: items }
        this.persistSession()
      }
      console.info(`[Models] ✅ /models → ${items.length} item(s) (${Date.now() - startMs}ms)`)
      return items
    } catch (error) {
      console.warn(`[Models] ❌ /models failed after ${Date.now() - startMs}ms:`, error)
      // forceFresh 模式下不回退旧缓存，避免用过期数据覆盖存储中的模型列表
      if (options?.forceFresh) {
        return null
      }
      return this.session?.models ?? null
    }
  }

  /** 发送短信验证码 */
  async sendSmsCode(mobile: string, scene: SmsScene): Promise<SmsCodeResult> {
    const data = await postJson<{
      smsRequestId?: string
      retryAfterSeconds?: number
      expiresIn?: number
    }>('/auth/sms/code', {
      countryCode: COUNTRY_CODE,
      mobile,
      scene
    })
    return {
      smsRequestId: data.smsRequestId,
      retryAfterSeconds: data.retryAfterSeconds,
      expiresIn: data.expiresIn
    }
  }

  /** 手机号 + 密码登录 */
  async loginByPassword(mobile: string, password: string): Promise<void> {
    const vo = await postJson<MioLoginVo>('/auth/login/password', {
      countryCode: COUNTRY_CODE,
      mobile,
      password
    })
    this.saveSession(vo)
    // 登录成功后后台拉取模型网关配置并持久化
    void this.fetchModelConfig().catch(() => {})
  }

  /** 手机号 + 短信验证码登录 */
  async loginBySms(mobile: string, smsRequestId: string, smsCode: string): Promise<void> {
    const vo = await postJson<MioLoginVo>('/auth/login/sms', {
      countryCode: COUNTRY_CODE,
      mobile,
      smsRequestId,
      smsCode
    })
    this.saveSession(vo)
    void this.fetchModelConfig().catch(() => {})
  }

  /** 注册（成功即取得登录态） */
  async register(input: {
    mobile: string
    password: string
    smsRequestId?: string
    smsCode?: string
    nickname?: string
  }): Promise<void> {
    const vo = await postJson<MioLoginVo>('/auth/register', {
      countryCode: COUNTRY_CODE,
      mobile: input.mobile,
      password: input.password,
      smsRequestId: input.smsRequestId,
      smsCode: input.smsCode,
      nickname: input.nickname
    })
    this.saveSession(vo)
    void this.fetchModelConfig().catch(() => {})
  }

  /**
   * 退出登录：先清除本地凭据让界面立即回到登录页，再后台通知后端撤销会话。
   * 后端撤销是尽力而为的，网络耗时不应阻塞退出交互。
   */
  async logout(): Promise<void> {
    const token = this.session?.accessToken
    this.clearSession()
    if (token) {
      void postJson<unknown>('/auth/logout', {}, token).catch((error) => {
        console.warn('[AuthService] Logout request failed:', error)
      })
    }
  }

  /** 获取可购买套餐（GET /plans） */
  async getPlans(): Promise<MioPlan[]> {
    if (!this.isAuthenticated()) {
      throw new MioApiError('未登录', 'TOKEN_INVALID')
    }
    const token = this.session?.accessToken
    console.info('[Plans] GET /plans')
    return getJson<MioPlan[]>('/plans', token)
  }

  /** 购买套餐（POST /plans/{planId}/purchase），支付渠道缺省由服务端决定（默认 WECHAT） */
  async purchasePlan(
    planId: number,
    requestId: string,
    paymentChannel?: string
  ): Promise<MioPurchaseResult> {
    if (!this.isAuthenticated()) {
      throw new MioApiError('未登录', 'TOKEN_INVALID')
    }
    const token = this.session?.accessToken
    console.info(
      `[Purchase] POST /plans/${planId}/purchase requestId=${requestId} channel=${paymentChannel ?? 'WECHAT'}`
    )
    return postJson<MioPurchaseResult>(
      `/plans/${planId}/purchase`,
      { requestId, paymentChannel: paymentChannel ?? 'WECHAT' },
      token
    )
  }

  /** 查询当前用户订阅（GET /subscriptions） */
  async getSubscriptions(): Promise<MioSubscriptionsResult> {
    if (!this.isAuthenticated()) {
      throw new MioApiError('未登录', 'TOKEN_INVALID')
    }
    const token = this.session?.accessToken
    const result = await getJson<MioSubscriptionsResult>('/subscriptions', token)
    console.info(
      `[Subscriptions] GET /subscriptions → ${result.items?.length ?? 0} item(s)`,
      result.items
    )
    return result
  }

  /** 查询订单状态（GET /orders/{orderNo}） */
  async getOrderStatus(orderNo: string): Promise<MioOrderStatus> {
    if (!this.isAuthenticated()) {
      throw new MioApiError('未登录', 'TOKEN_INVALID')
    }
    const token = this.session?.accessToken
    console.info(`[Order] GET /orders/${orderNo}`)
    return getJson<MioOrderStatus>(`/orders/${orderNo}`, token)
  }

  /** 查询账户额度（GET /quota） */
  async getQuota(): Promise<MioQuota> {
    if (!this.isAuthenticated()) {
      throw new MioApiError('未登录', 'TOKEN_INVALID')
    }
    const token = this.session?.accessToken
    console.info('[Quota] GET /quota')
    return getJson<MioQuota>('/quota', token)
  }

  /** 查询协议列表（GET /agreements，匿名接口） */
  async getAgreements(): Promise<MioAgreement[]> {
    console.info('[Agreements] GET /agreements')
    return getJson<MioAgreement[]>('/agreements')
  }

  // ---- 会话持久化（safeStorage 加密） ----

  private get tokenPath(): string {
    return join(app.getPath('userData'), TOKEN_FILE_NAME)
  }

  private loadSession(): void {
    try {
      if (!existsSync(this.tokenPath)) {
        return
      }
      const raw = readFileSync(this.tokenPath, 'utf8')
      const payload = JSON.parse(raw) as { enc: boolean; data: unknown }

      let session: StoredSession
      if (payload.enc) {
        if (!safeStorage.isEncryptionAvailable()) {
          console.warn('[AuthService] safeStorage unavailable; saved session cannot be decrypted.')
          return
        }
        const decrypted = safeStorage.decryptString(Buffer.from(String(payload.data), 'base64'))
        session = JSON.parse(decrypted) as StoredSession
      } else {
        session = payload.data as StoredSession
      }

      this.session = session
    } catch (error) {
      console.warn('[AuthService] Failed to load saved session:', error)
      this.session = null
    }
  }

  private saveSession(vo: MioLoginVo): void {
    this.session = {
      accessToken: vo.accessToken,
      expiresAt: vo.expiresIn ? Date.now() + vo.expiresIn * 1000 : null,
      user: vo.user ?? null
    }
    this.persistSession()
    console.info(
      `[Auth] ✅ 登录成功 expiresIn=${vo.expiresIn ?? '?'}s userId=${vo.user?.userId ?? '?'} nickname=${vo.user?.nickname ?? '?'}`
    )
  }

  private persistSession(): void {
    if (!this.session) {
      return
    }
    try {
      let payload: unknown
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(JSON.stringify(this.session))
        payload = { enc: true, data: encrypted.toString('base64') }
      } else {
        console.warn('[AuthService] safeStorage unavailable; session will not be persisted.')
        payload = { enc: false, data: this.session }
      }
      writeFileSync(this.tokenPath, JSON.stringify(payload), 'utf8')
    } catch (error) {
      console.warn('[AuthService] Failed to persist session:', error)
    }
  }

  private clearSession(): void {
    this.session = null
    try {
      rmSync(this.tokenPath, { force: true })
    } catch (error) {
      console.warn('[AuthService] Failed to remove session file:', error)
    }
  }
}

export { MioApiError }
