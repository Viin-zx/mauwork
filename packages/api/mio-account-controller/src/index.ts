/** Authenticated Remote operations for mioagent account UI consumers. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { mioAccountErrorOf } from '@deepseek-ai/dsh-mio-account'
import type {} from '@deepseek-ai/dsh-mio-account'
import type {
  MioAccountStatusView, MioAccountView, MioAgreement, MioModelCatalogView, MioOrderStatus,
  MioPasswordLoginRequest, MioPlan, MioPurchaseRequest, MioPurchaseResult, MioQuotaView,
  MioRegisterRequest, MioResetPasswordRequest, MioSmsCode, MioSmsCodeRequest, MioSmsLoginRequest,
  MioSubscriptionsView, MioUser,
} from '@deepseek-ai/dsh-mio-account/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** mioagent business failure carrying the stable backend code and support trace identifier. */
    'mio-account/failure': { readonly code: string; readonly httpStatus?: number; readonly traceId?: string }
  }
}

/** Account commands, credential-expiry notices, and reconnect-safe state. */
export class MioAccountController extends TypertRemoteService {
  static inject = ['mioAccount']
  /** @param ctx - Host with the mioagent account provider mounted. */
  constructor(ctx: Context) { super(ctx, 'mioAccountController', { namespace: 'mioAccount' }) }
  /**
   * Read the safe account projection.
   * @returns stored login presence and its user projection.
   */
  @Remote
  getState(): Promise<MioAccountView> { return this.forward(() => this.ctx.mioAccount.getState()) }
  /**
   * Query display-safe profile data.
   * @returns the refreshed user, or null when the session changed during the read.
   */
  @Remote
  getProfile(): Promise<MioUser | null> { return this.forward(() => this.ctx.mioAccount.getProfile()) }
  /**
   * Request an SMS verification code.
   * @param request - phone number and purpose.
   * @returns the issued code handle and its timing facts.
   */
  @Remote
  sendSmsCode(request: MioSmsCodeRequest): Promise<MioSmsCode> {
    return this.forward(() => this.ctx.mioAccount.sendSmsCode(request))
  }
  /**
   * Register a new user and sign in.
   * @param request - registration fields.
   * @returns the stored account state.
   */
  @Remote
  register(request: MioRegisterRequest): Promise<MioAccountView> {
    return this.forward(() => this.ctx.mioAccount.register(request))
  }
  /**
   * Log in with a phone number and password.
   * @param request - credentials.
   * @returns the stored account state.
   */
  @Remote
  loginWithPassword(request: MioPasswordLoginRequest): Promise<MioAccountView> {
    return this.forward(() => this.ctx.mioAccount.loginWithPassword(request))
  }
  /**
   * Log in with an SMS verification code.
   * @param request - phone number, code handle, and code.
   * @returns the stored account state.
   */
  @Remote
  loginWithSms(request: MioSmsLoginRequest): Promise<MioAccountView> {
    return this.forward(() => this.ctx.mioAccount.loginWithSms(request))
  }
  /**
   * Replace a forgotten password using an SMS code.
   * @param request - phone number, code handle, code, and replacement password.
   * @returns after the backend accepted the new password.
   */
  @Remote
  resetPassword(request: MioResetPasswordRequest): Promise<void> {
    return this.forward(() => this.ctx.mioAccount.resetPassword(request))
  }
  /**
   * Revoke the server session and remove the stored login state.
   * @returns the signed-out state.
   */
  @Remote
  logout(): Promise<MioAccountView> { return this.forward(() => this.ctx.mioAccount.logout()) }
  /**
   * Query NewAPI account provisioning progress.
   * @returns the current account and credential status.
   */
  @Remote
  getAccountStatus(): Promise<MioAccountStatusView> {
    return this.forward(() => this.ctx.mioAccount.getAccountStatus())
  }
  /**
   * Ask the backend to retry account provisioning.
   * @returns the latest account status.
   */
  @Remote
  retryAccount(): Promise<MioAccountStatusView> {
    return this.forward(() => this.ctx.mioAccount.retryAccount())
  }
  /**
   * Read the business model directory.
   * @returns every model the backend currently offers.
   */
  @Remote
  getModels(): Promise<MioModelCatalogView> { return this.forward(() => this.ctx.mioAccount.getModels()) }
  /**
   * Read the remaining upstream quota.
   * @returns the quota snapshot.
   */
  @Remote
  getQuota(): Promise<MioQuotaView> { return this.forward(() => this.ctx.mioAccount.getQuota()) }

  /**
   * Read the plans the current user may purchase.
   * @returns purchasable plans.
   */
  @Remote
  getPlans(): Promise<readonly MioPlan[]> { return this.forward(() => this.ctx.mioAccount.getPlans()) }

  /**
   * Start one purchase; a retry reuses the same `requestId`.
   * @param request - plan, idempotency key, and optional payment channel.
   * @returns the created order and, for WeChat Native, its QR payload.
   */
  @Remote
  purchasePlan(request: MioPurchaseRequest): Promise<MioPurchaseResult> {
    return this.forward(() => this.ctx.mioAccount.purchasePlan(request))
  }

  /**
   * Read one order's payment and provisioning state.
   * @param orderNo - order returned by the purchase call.
   * @returns the current order state.
   */
  @Remote
  getOrder(orderNo: string): Promise<MioOrderStatus> {
    return this.forward(() => this.ctx.mioAccount.getOrder(orderNo))
  }

  /**
   * Read the current user's subscriptions.
   * @returns subscription items and whether the read refreshed NewAPI.
   */
  @Remote
  getSubscriptions(): Promise<MioSubscriptionsView> {
    return this.forward(() => this.ctx.mioAccount.getSubscriptions())
  }
  /**
   * Read user, privacy, and subscription agreements.
   * @returns agreement documents in the backend's fixed order.
   */
  @Remote
  getAgreements(): Promise<readonly MioAgreement[]> {
    return this.forward(() => this.ctx.mioAccount.getAgreements())
  }
  /**
   * Subscribe to credential expiry without replaying prior notifications.
   * @param signal - stream lifetime.
   * @returns notifications emitted while subscribed.
   */
  @Remote({ mode: 'stream' })
  async *watchExpiry(signal: AbortSignal): AsyncIterable<'session-expired'> {
    let pending = 0
    let wake: (() => void) | undefined
    const stop = this.ctx.on('mio-account/session-expired', () => { pending++; wake?.() })
    const abort = (): void => { wake?.() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (!signal.aborted) {
        if (pending > 0) { pending--; yield 'session-expired'; continue }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      stop()
      signal.removeEventListener('abort', abort)
    }
  }
  /**
   * Stream the safe account projection.
   * @param signal - stream lifetime.
   * @returns initial snapshot and subsequent changes.
   */
  @Remote({ mode: 'stream' })
  watch(signal: AbortSignal): AsyncIterable<MioAccountView> { return this.ctx.mioAccount.watch(signal) }

  /**
   * Carry the provider's stable failure code across the Remote wire.
   * @param operation - one provider call.
   * @returns the provider result.
   */
  private async forward<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      const failure = mioAccountErrorOf(error)
      if (failure === undefined) throw error
      throw new RemoteError('mio-account/failure', failure.message, {
        code: failure.code,
        ...failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus },
        ...failure.traceId === undefined ? {} : { traceId: failure.traceId },
      })
    }
  }
}
export default MioAccountController
