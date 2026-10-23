/**
 * HTTP provider of the mioagent account seam. The provider owns session
 * persistence and the Host-only model-access cache; the service Definition
 * lives beside it so model, Remote, and UI consumers share one vocabulary.
 * @module @deepseek-ai/dsh-mio-account
 */

import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { z } from 'zod'
import { MioClient, normalizeMioBaseUrl } from './client.ts'
import { MioAccountError } from './error.ts'
import { MioAccount } from './service.ts'
import type { MioPluginCatalogItem } from './service.ts'
import type {
  MioAccountStatusView, MioAccountView, MioAgreement, MioModelAccess, MioModelCatalogView,
  MioOrderStatus, MioPasswordLoginRequest, MioPlan, MioPurchaseRequest, MioPurchaseResult, MioQuotaView,
  MioRegisterRequest, MioResetPasswordRequest, MioSmsCode, MioSmsCodeRequest, MioSmsLoginRequest,
  MioSubscriptionsView, MioUser,
} from './types.ts'
import {
  accountStatusSchema, agreementsSchema, loginSchema, modelAccessSchema, modelCatalogSchema,
  orderStatusSchema, planSchema, pluginCatalogSchema, purchaseResultSchema, quotaSchema, smsCodeSchema,
  storedSessionSchema, subscriptionsSchema, userSchema,
} from './wire.ts'
import type { LoginPayload, StoredSession } from './wire.ts'

export { MioAccount } from './service.ts'
export type { MioPluginCatalogItem } from './service.ts'
export { MioAccountError, mioAccountErrorOf } from './error.ts'
export { normalizeMioBaseUrl } from './client.ts'
export type { MioInternalErrorCode, MioAccountErrorOptions } from './error.ts'
export type * from './types.ts'

/** Credential record holding the access token and display-safe user projection. */
const SESSION_KEY = credentialKey('mio-account', 'session')

/** Deployment choices of the mioagent business client. */
export interface Config {
  /** Business backend origin, for example `http://localhost:8080`. */
  businessBaseUrl?: string
  /** Deadline of one business request. */
  requestTimeoutMs?: number
  /** Maximum age of a resolved model key before the next access re-fetches it. */
  modelAccessTtlMs?: number
}

/** Validated deployment choices. */
export const Config = Schema.object({
  businessBaseUrl: Schema.string().default('http://localhost:8080'),
  requestTimeoutMs: Schema.number().min(1).max(120_000).default(30_000),
  modelAccessTtlMs: Schema.number().step(1).min(1).max(3_600_000).default(300_000),
})

interface CachedModelAccess {
  readonly value: MioModelAccess
  /** Access token the key was issued for. */
  readonly token: string
  /** Wall-clock time after which the key is fetched again. */
  readonly refreshAt: number
}

/** HTTP implementation of {@link MioAccount}. */
export class MioAccountHttp extends MioAccount {
  static inject = ['credentials']
  static Config = Config
  private readonly client: MioClient
  private readonly modelAccessTtlMs: number
  private readonly listeners = new Set<() => void>()
  private modelAccess: CachedModelAccess | undefined
  private closed = false

  /**
   * @param ctx - Host with the credentials service.
   * @param config - deployment choices; the business origin is validated here.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    const resolved = Config(config)
    const baseUrl = normalizeMioBaseUrl(resolved.businessBaseUrl)
    this.modelAccessTtlMs = resolved.modelAccessTtlMs
    this.client = new MioClient({
      baseUrl,
      timeoutMs: resolved.requestTimeoutMs,
      onUnauthorized: () => this.expire(),
    })
    ctx.on('credentials/record-updated', (key) => {
      if (key !== SESSION_KEY) return
      this.modelAccess = undefined
      this.changed()
    })
    ctx.effect(() => () => {
      this.closed = true
      this.listeners.clear()
    }, 'mio-account: state listeners')
  }

  async [Service.init](): Promise<void> {
    await this.readSession()
  }

  override async getState(): Promise<MioAccountView> {
    const session = await this.readSession()
    return session === null
      ? { status: 'signed-out', user: null }
      : this.viewOf(session)
  }

  override async *watch(signal: AbortSignal): AsyncIterable<MioAccountView> {
    let dirty = true
    let wake: (() => void) | undefined
    const wakeUp = (): void => { dirty = true; wake?.() }
    this.listeners.add(wakeUp)
    signal.addEventListener('abort', wakeUp, { once: true })
    try {
      while (!this.closed && !signal.aborted) {
        if (dirty) { dirty = false; yield await this.getState(); continue }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      this.listeners.delete(wakeUp)
      signal.removeEventListener('abort', wakeUp)
    }
  }

  override async sendSmsCode(request: MioSmsCodeRequest, signal?: AbortSignal): Promise<MioSmsCode> {
    const session = request.authenticated === true ? await this.requireSession() : undefined
    return this.client.request('/auth/sms/code', smsCodeSchema, {
      method: 'POST',
      body: {
        countryCode: request.countryCode,
        ...session === undefined ? { mobile: request.mobile } : {},
        scene: request.scene,
      },
      ...session === undefined ? {} : { token: session.accessToken },
      ...signal === undefined ? {} : { signal },
    })
  }

  override async register(request: MioRegisterRequest, signal?: AbortSignal): Promise<MioAccountView> {
    const payload = await this.client.request('/auth/register', loginSchema, {
      method: 'POST',
      body: {
        countryCode: request.countryCode,
        mobile: request.mobile,
        password: request.password,
        nickname: request.nickname,
        ...request.smsRequestId === undefined ? {} : { smsRequestId: request.smsRequestId },
        ...request.smsCode === undefined ? {} : { smsCode: request.smsCode },
      },
      ...signal === undefined ? {} : { signal },
    })
    return this.saveLogin(payload)
  }

  override async loginWithPassword(request: MioPasswordLoginRequest, signal?: AbortSignal): Promise<MioAccountView> {
    const payload = await this.client.request('/auth/login/password', loginSchema, {
      method: 'POST',
      body: { countryCode: request.countryCode, mobile: request.mobile, password: request.password },
      ...signal === undefined ? {} : { signal },
    })
    return this.saveLogin(payload)
  }

  override async loginWithSms(request: MioSmsLoginRequest, signal?: AbortSignal): Promise<MioAccountView> {
    const payload = await this.client.request('/auth/login/sms', loginSchema, {
      method: 'POST',
      body: {
        countryCode: request.countryCode,
        mobile: request.mobile,
        smsRequestId: request.smsRequestId,
        smsCode: request.smsCode,
      },
      ...signal === undefined ? {} : { signal },
    })
    return this.saveLogin(payload)
  }

  override async resetPassword(request: MioResetPasswordRequest, signal?: AbortSignal): Promise<void> {
    const session = request.authenticated === true ? await this.requireSession() : undefined
    await this.client.request('/auth/password/reset', z.unknown(), {
      method: 'POST',
      body: {
        countryCode: request.countryCode,
        // The authenticated flow lets the backend resolve the bound phone from
        // the token; the empty field keeps the anonymous request shape stable.
        mobile: session === undefined ? request.mobile : '',
        smsRequestId: request.smsRequestId,
        smsCode: request.smsCode,
        newPassword: request.newPassword,
      },
      ...session === undefined ? {} : { token: session.accessToken },
      ...signal === undefined ? {} : { signal },
    })
    // The reset revokes the current access token, so the stored session can no
    // longer call the server, not even logout. Drop it locally and return the
    // client to the login gate.
    await this.ctx.credentials.deleteRecord(SESSION_KEY)
    this.modelAccess = undefined
    this.changed()
  }

  override async logout(signal?: AbortSignal): Promise<MioAccountView> {
    const session = await this.readSession()
    if (session === null) return this.getState()
    try {
      await this.client.request('/auth/logout', z.unknown(), {
        method: 'POST',
        token: session.accessToken,
        ...signal === undefined ? {} : { signal },
      })
    } catch (error) {
      // A rejected token was already removed by the unauthorized hook; a
      // non-JSON 401 still identifies a dead session.
      if (!(error instanceof MioAccountError
        && (error.code === 'TOKEN_INVALID' || error.httpStatus === 401))) throw error
    }
    await this.ctx.credentials.deleteRecord(SESSION_KEY)
    this.modelAccess = undefined
    this.changed()
    return this.getState()
  }

  override async getProfile(signal?: AbortSignal): Promise<MioUser | null> {
    const session = await this.readSession()
    if (session === null) return null
    const user = await this.client.request('/users/me', userSchema, {
      token: session.accessToken,
      ...signal === undefined ? {} : { signal },
    })
    const landed = { value: false }
    await this.ctx.credentials.modifyRecord(SESSION_KEY, (current) => {
      const currentSession = this.sessionOf(current)
      if (currentSession === null || currentSession.accessToken !== session.accessToken) {
        return Promise.resolve(undefined)
      }
      landed.value = true
      return Promise.resolve({ kind: 'grant', payload: { ...currentSession, user } })
    })
    // `modifyRecord` answers with the current record when the mutation
    // declines, so only this flag says whether this read actually landed.
    if (!landed.value) return null
    this.changed()
    return user
  }

  override async getAccountStatus(signal?: AbortSignal): Promise<MioAccountStatusView> {
    const session = await this.requireSession()
    const status = await this.client.request('/account/status', accountStatusSchema, {
      token: session.accessToken,
      ...signal === undefined ? {} : { signal },
    })
    await this.saveStatus(session.accessToken, status)
    return status
  }

  override async retryAccount(signal?: AbortSignal): Promise<MioAccountStatusView> {
    const session = await this.requireSession()
    const status = await this.client.request('/account/retry', accountStatusSchema, {
      method: 'POST',
      token: session.accessToken,
      ...signal === undefined ? {} : { signal },
    })
    await this.saveStatus(session.accessToken, status)
    return status
  }

  override async getModels(signal?: AbortSignal): Promise<MioModelCatalogView> {
    const session = await this.requireSession()
    return this.client.request('/models', modelCatalogSchema, {
      token: session.accessToken,
      ...signal === undefined ? {} : { signal },
    })
  }

  override async getModelAccess(signal?: AbortSignal): Promise<MioModelAccess> {
    const session = await this.requireSession()
    const cached = this.modelAccess
    if (cached !== undefined && cached.token === session.accessToken && cached.refreshAt > Date.now()) {
      return cached.value
    }
    const access = await this.client.request('/models/config', modelAccessSchema, {
      method: 'POST',
      token: session.accessToken,
      ...signal === undefined ? {} : { signal },
    })
    this.modelAccess = {
      value: access,
      token: session.accessToken,
      refreshAt: this.refreshAt(access.expiresAt),
    }
    return access
  }

  override invalidateModelAccess(): void {
    this.modelAccess = undefined
    if (!this.closed) this.ctx.emit('mio-account/changed')
  }

  override async getQuota(signal?: AbortSignal): Promise<MioQuotaView> {
    const session = await this.requireSession()
    return this.client.request('/quota', quotaSchema, {
      token: session.accessToken,
      ...signal === undefined ? {} : { signal },
    })
  }

  override async getPlans(signal?: AbortSignal): Promise<readonly MioPlan[]> {
    const session = await this.requireSession()
    return this.client.request('/plans', z.array(planSchema), {
      token: session.accessToken,
      ...signal === undefined ? {} : { signal },
    })
  }

  override async purchasePlan(request: MioPurchaseRequest, signal?: AbortSignal): Promise<MioPurchaseResult> {
    const session = await this.requireSession()
    return this.client.request(`/plans/${String(request.planId)}/purchase`, purchaseResultSchema, {
      method: 'POST',
      token: session.accessToken,
      body: {
        requestId: request.requestId,
        ...request.paymentChannel === undefined ? {} : { paymentChannel: request.paymentChannel },
      },
      ...signal === undefined ? {} : { signal },
    })
  }

  override async getOrder(orderNo: string, signal?: AbortSignal): Promise<MioOrderStatus> {
    const session = await this.requireSession()
    return this.client.request(`/orders/${encodeURIComponent(orderNo)}`, orderStatusSchema, {
      token: session.accessToken,
      ...signal === undefined ? {} : { signal },
    })
  }

  override async getSubscriptions(signal?: AbortSignal): Promise<MioSubscriptionsView> {
    const session = await this.requireSession()
    return this.client.request('/subscriptions', subscriptionsSchema, {
      token: session.accessToken,
      ...signal === undefined ? {} : { signal },
    })
  }

  override async getAgreements(signal?: AbortSignal): Promise<readonly MioAgreement[]> {
    return this.client.request('/agreements', agreementsSchema, {
      ...signal === undefined ? {} : { signal },
    })
  }

  override async getPlugins(signal?: AbortSignal): Promise<readonly MioPluginCatalogItem[]> {
    const session = await this.requireSession()
    return this.client.request('/plugins', pluginCatalogSchema, {
      token: session.accessToken,
      ...signal === undefined ? {} : { signal },
    })
  }

  /** Read and validate the stored session, discarding invalid records. */
  private async readSession(): Promise<StoredSession | null> {
    const record = await this.ctx.credentials.readRecord(SESSION_KEY)
    if (record === undefined) return null
    const session = this.sessionOf(record)
    if (session === null) {
      this.warn('stored mioagent session is not a valid grant; removing it')
      await this.ctx.credentials.deleteRecord(SESSION_KEY)
      return null
    }
    return session
  }

  /** Validate one credential record as a stored session. */
  private sessionOf(record: import('@deepseek-ai/dsh-credentials').CredentialRecord | undefined): StoredSession | null {
    if (record?.kind !== 'grant') return null
    const parsed = storedSessionSchema.safeParse(record.payload)
    return parsed.success ? parsed.data : null
  }

  /** Store a login result and publish the new state. */
  private async saveLogin(payload: LoginPayload): Promise<MioAccountView> {
    const session: StoredSession = {
      version: 1,
      accessToken: payload.accessToken,
      user: payload.user,
    }
    await this.ctx.credentials.modifyRecord(SESSION_KEY, () => Promise.resolve({ kind: 'grant', payload: session }))
    this.modelAccess = undefined
    this.changed()
    return this.viewOf(session)
  }

  /** Mirror status fields into the stored user projection without disturbing the token. */
  private async saveStatus(token: string, status: MioAccountStatusView): Promise<void> {
    const stored = { value: false }
    await this.ctx.credentials.modifyRecord(SESSION_KEY, (current) => {
      const session = this.sessionOf(current)
      if (session === null || session.accessToken !== token || session.user === null) return Promise.resolve(undefined)
      if (session.user.accountStatus === status.status && session.user.credentialStatus === status.credentialStatus) {
        return Promise.resolve(undefined)
      }
      stored.value = true
      return Promise.resolve({
        kind: 'grant',
        payload: {
          ...session,
          user: { ...session.user, accountStatus: status.status, credentialStatus: status.credentialStatus },
        },
      })
    })
    if (stored.value) this.changed()
  }

  /** Remove a rejected session and tell UI consumers that login expired. */
  private async expire(): Promise<void> {
    const record = await this.ctx.credentials.readRecord(SESSION_KEY)
    if (record !== undefined) await this.ctx.credentials.deleteRecord(SESSION_KEY)
    this.modelAccess = undefined
    if (!this.closed) this.ctx.emit('mio-account/session-expired')
    this.changed()
  }

  /** Resolve the session or refuse an operation that needs one. */
  private async requireSession(): Promise<StoredSession> {
    const session = await this.readSession()
    if (session === null) throw new MioAccountError('NOT_SIGNED_IN', 'Sign in to mioagent to continue')
    return session
  }

  /** Cache deadline, capped by a parsable server expiry. */
  private refreshAt(expiresAt: string): number {
    const now = Date.now()
    const parsed = Date.parse(expiresAt.replace(' ', 'T'))
    const remaining = Number.isFinite(parsed) && parsed > now ? parsed - now : this.modelAccessTtlMs
    return now + Math.min(this.modelAccessTtlMs, remaining)
  }

  /** Project a stored session into the client-safe view. */
  private viewOf(session: StoredSession): MioAccountView {
    return { status: 'signed-in', user: session.user }
  }

  /** Publish stored-state changes to snapshot listeners and Host consumers. */
  private changed(): void {
    for (const listener of this.listeners) listener()
    if (!this.closed) this.ctx.emit('mio-account/changed')
  }

  /** Record a local storage problem without failing a read. */
  private warn(message: string): void {
    this.ctx.logger.warn(`mio-account: ${message}`)
  }
}

export default MioAccountHttp
