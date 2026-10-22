/**
 * Service Definition of the mioagent account seam shared by the HTTP provider,
 * the Remote controller, and model consumers. Only the Host can obtain the
 * access token or model key; this interface exposes them solely through
 * {@link MioAccount.getModelAccess}.
 * @module @deepseek-ai/dsh-mio-account
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  MioAccountStatusView, MioAccountView, MioAgreement, MioModelAccess, MioModelCatalogView,
  MioOrderStatus, MioPasswordLoginRequest, MioPlan, MioPurchaseRequest, MioPurchaseResult, MioQuotaView,
  MioRegisterRequest, MioResetPasswordRequest, MioSmsCode, MioSmsCodeRequest, MioSmsLoginRequest,
  MioSubscriptionsView, MioUser,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    mioAccount: MioAccount
  }
}

/**
 * Account operations against the mioagent business backend. Implementations
 * own session persistence and the model-access cache; consumers never see the
 * access token or model key.
 */
/** One enabled plugin in the mioagent catalog; its preset config never crosses the Remote wire. */
export interface MioPluginCatalogItem {
  /** Backend plugin id rendered as a string so large integers keep their digits. */
  readonly pluginId: string
  /** Display name; duplicate names are allowed. */
  readonly pluginName: string
  /** Install spec used by the plugin manager; unique in the catalog. */
  readonly packageName: string
  /** Display grouping supplied by the backend. */
  readonly category: string
  /** Display description supplied by the backend. */
  readonly description: string
  /** Default plugin configuration stored by the backend; null when unconfigured. */
  readonly config: Record<string, unknown> | null
}

export abstract class MioAccount extends Service {
  /** @param ctx - context owning this account implementation. */
  constructor(ctx: Context) { super(ctx, 'mioAccount') }

  /**
   * Read stored login presence without network access.
   * @returns the safe user projection and token expiry, or the signed-out state.
   */
  abstract getState(): Promise<MioAccountView>

  /**
   * Subscribe to stored login state, including the current value first.
   * @param signal - subscription lifetime.
   * @returns complete state snapshots as login state changes.
   */
  abstract watch(signal: AbortSignal): AsyncIterable<MioAccountView>

  /**
   * Request an SMS verification code for registration or login.
   * @param request - phone number and purpose.
   * @param signal - caller cancellation.
   * @returns the issued code handle and its timing facts.
   */
  abstract sendSmsCode(request: MioSmsCodeRequest, signal?: AbortSignal): Promise<MioSmsCode>

  /**
   * Register a new user and store the returned login state.
   * @param request - registration fields.
   * @param signal - caller cancellation.
   * @returns the stored account state.
   */
  abstract register(request: MioRegisterRequest, signal?: AbortSignal): Promise<MioAccountView>

  /**
   * Log in with a phone number and password, storing the returned login state.
   * @param request - credentials.
   * @param signal - caller cancellation.
   * @returns the stored account state.
   */
  abstract loginWithPassword(request: MioPasswordLoginRequest, signal?: AbortSignal): Promise<MioAccountView>

  /**
   * Log in with an SMS verification code, storing the returned login state.
   * @param request - phone number, code handle, and code.
   * @param signal - caller cancellation.
   * @returns the stored account state.
   */
  abstract loginWithSms(request: MioSmsLoginRequest, signal?: AbortSignal): Promise<MioAccountView>

  /**
   * Replace a forgotten password using a code issued for the `RESET_PASSWORD` scene.
   * @param request - phone number, code handle, code, and replacement password.
   * @param signal - caller cancellation.
   */
  abstract resetPassword(request: MioResetPasswordRequest, signal?: AbortSignal): Promise<void>

  /**
   * Revoke the server session and remove the stored login state.
   * @param signal - caller cancellation.
   * @returns the signed-out state.
   */
  abstract logout(signal?: AbortSignal): Promise<MioAccountView>

  /**
   * Refresh the display profile from the business backend.
   * @param signal - caller cancellation.
   * @returns the refreshed user, or null when the session changed during the read.
   */
  abstract getProfile(signal?: AbortSignal): Promise<MioUser | null>

  /**
   * Query NewAPI account provisioning progress.
   * @param signal - caller cancellation.
   * @returns the current account and credential status.
   */
  abstract getAccountStatus(signal?: AbortSignal): Promise<MioAccountStatusView>

  /**
   * Ask the backend to retry account provisioning.
   * @param signal - caller cancellation.
   * @returns the latest account status.
   */
  abstract retryAccount(signal?: AbortSignal): Promise<MioAccountStatusView>

  /**
   * Read the business model directory.
   * @param signal - caller cancellation.
   * @returns every model the backend currently offers.
   */
  abstract getModels(signal?: AbortSignal): Promise<MioModelCatalogView>

  /**
   * Resolve the model endpoint and current key. Host-only; callers must not
   * log, persist outside the credentials seam, or expose the returned key.
   * @param signal - caller cancellation.
   * @returns the endpoint, key, and credential version.
   */
  abstract getModelAccess(signal?: AbortSignal): Promise<MioModelAccess>

  /** Discard the cached model key after a model service rejects it. */
  abstract invalidateModelAccess(): void

  /**
   * Read the remaining upstream quota.
   * @param signal - caller cancellation.
   * @returns the quota snapshot.
   */
  abstract getQuota(signal?: AbortSignal): Promise<MioQuotaView>

  /**
   * Read user, privacy, and subscription agreements.
   * @param signal - caller cancellation.
   * @returns agreement documents in the backend's fixed order.
   */
  abstract getAgreements(signal?: AbortSignal): Promise<readonly MioAgreement[]>

  /**
   * Read the enabled plugin catalog. Preset configs stay inside the Host.
   * @param signal - caller cancellation.
   * @returns enabled plugins in backend order.
   */
  abstract getPlugins(signal?: AbortSignal): Promise<readonly MioPluginCatalogItem[]>

  /**
   * Read the plans the current user may purchase.
   * @param signal - caller cancellation.
   * @returns purchasable plans.
   */
  abstract getPlans(signal?: AbortSignal): Promise<readonly MioPlan[]>

  /**
   * Start one purchase. Reusing the same `requestId` returns the same order.
   * @param request - plan, idempotency key, and optional payment channel.
   * @param signal - caller cancellation.
   * @returns the created order and, for WeChat Native, its QR payload.
   */
  abstract purchasePlan(request: MioPurchaseRequest, signal?: AbortSignal): Promise<MioPurchaseResult>

  /**
   * Read one order's payment and provisioning state.
   * @param orderNo - order returned by the purchase call.
   * @param signal - caller cancellation.
   * @returns the current order state.
   */
  abstract getOrder(orderNo: string, signal?: AbortSignal): Promise<MioOrderStatus>

  /**
   * Read the current user's subscriptions.
   * @param signal - caller cancellation.
   * @returns subscription items and whether the read refreshed NewAPI.
   */
  abstract getSubscriptions(signal?: AbortSignal): Promise<MioSubscriptionsView>
}
