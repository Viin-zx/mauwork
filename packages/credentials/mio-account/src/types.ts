/**
 * Client-safe values of the mioagent account seam. Tokens and model keys stay
 * inside the Host provider; every type here is safe to cross the Remote wire.
 * @module @deepseek-ai/dsh-mio-account/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** mioagent user identifier; the service always exposes it as a string. */
export type MioUserId = Branded<'MioUserId'>

/** SMS verification purpose understood by the mioagent client API. */
export type MioSmsScene = 'REGISTER' | 'LOGIN' | 'RESET_PASSWORD'

/** One SMS verification-code request. */
export interface MioSmsCodeRequest {
  /** Dialing prefix such as `+86`. */
  readonly countryCode: string
  /** Mobile number without the dialing prefix; ignored when `authenticated` is true. */
  readonly mobile: string
  /** Flow the verified code authorizes. */
  readonly scene: MioSmsScene
  /** Send the code to the signed-in account's bound phone through its stored token. */
  readonly authenticated?: boolean
}

/** Issued SMS verification-code handle and its timing facts. */
export interface MioSmsCode {
  /** Identifier the login or registration request echoes back. */
  readonly smsRequestId: string
  /** Seconds the client should wait before requesting another code. */
  readonly retryAfterSeconds: number
  /** Seconds the issued code stays valid. */
  readonly expiresIn: number
}

/** Registration request; the SMS fields may be absent while development verification is disabled. */
export interface MioRegisterRequest {
  readonly countryCode: string
  readonly mobile: string
  readonly smsRequestId?: string
  readonly smsCode?: string
  /** New password, at least eight characters. */
  readonly password: string
  readonly nickname: string
}

/** Password login request. */
export interface MioPasswordLoginRequest {
  readonly countryCode: string
  readonly mobile: string
  readonly password: string
}

/** SMS login request; the code must have been issued for the `LOGIN` scene. */
export interface MioSmsLoginRequest {
  readonly countryCode: string
  readonly mobile: string
  readonly smsRequestId: string
  readonly smsCode: string
}

/** Password reset; the code must have been issued for the `RESET_PASSWORD` scene. */
export interface MioResetPasswordRequest {
  readonly countryCode: string
  /** Mobile number without the dialing prefix; ignored when `authenticated` is true. */
  readonly mobile: string
  readonly smsRequestId: string
  readonly smsCode: string
  /** Replacement password, at least eight characters. */
  readonly newPassword: string
  /** Reset the signed-in account's password through its stored token instead of `mobile`. */
  readonly authenticated?: boolean
}

/** Display-safe user projection returned by login and profile reads. */
export interface MioUser {
  readonly userId: MioUserId
  readonly maskedPhone: string
  readonly nickname: string
  /** NewAPI account provisioning status reported by the business backend. */
  readonly accountStatus: string
  /** Model credential status; only `READY` allows model configuration. */
  readonly credentialStatus: string
}

/** Stored login presence and its user projection; never contains an access token. */
export interface MioAccountView {
  readonly status: 'signed-out' | 'signed-in'
  readonly user: MioUser | null
  /** Access-token expiry as Unix epoch milliseconds; null while signed out or when the login response carried no expiry. */
  readonly expiresAt: number | null
}

/** Account provisioning progress returned by `/account/status` and `/account/retry`. */
export interface MioAccountStatusView {
  readonly status: string
  readonly stage: string
  readonly credentialStatus: string
  readonly retryable: boolean
  readonly retryAfterSeconds: number
}

/** Model type discriminator published by the mioagent model directory. */
export type MioModelType = 'LANGUAGE' | 'EMBEDDING' | 'RERANK' | 'IMAGE' | 'VIDEO' | 'TTS'

/**
 * Type-specific model parameters. Only the fields the mioagent client API
 * documents are projected; image and video models carry none of them.
 */
export interface MioModelParameters {
  readonly contextWindowTokens?: number | undefined
  readonly maxOutputTokens?: number | undefined
  readonly temperature?: number | null | undefined
  readonly topP?: number | null | undefined
  readonly reasoningEffort?: string | null | undefined
  readonly reasoningEnabled?: boolean | undefined
  readonly visionEnabled?: boolean | undefined
  readonly functionCallingEnabled?: boolean | undefined
  readonly speechRecognitionEnabled?: boolean | undefined
}

/** One model offered by the business backend. */
export interface MioModel {
  /** Wire model id; the only value a model request may name. */
  readonly modelId: string
  /** Display name; empty when the backend omits it. */
  readonly displayName: string
  /** Provider display name; empty when the backend omits it. */
  readonly providerName: string
  readonly modelType: MioModelType
  /** Declared request deadline; 0 when the backend omits it. */
  readonly requestTimeoutMs: number
  readonly isDefault: boolean
  readonly parameters: MioModelParameters
}

/** Model directory snapshot returned by `/models`. */
export interface MioModelCatalogView {
  readonly items: readonly MioModel[]
  readonly fetchedAt: string
  /** True when the backend served its last local snapshot instead of a fresh upstream read. */
  readonly stale: boolean
}

/** Host-only model access facts; `apiKey` must never cross the Remote wire or enter logs. */
export interface MioModelAccess {
  readonly baseUrl: string
  readonly apiKey: string
  readonly credentialVersion: number
  /** Backend-formatted expiry timestamp, retained for display and cache bounds. */
  readonly expiresAt: string
}

/** Remaining upstream quota; the unit is opaque and never converted by clients. */
export interface MioQuotaView {
  readonly remainingQuota: number
  readonly usedQuota: number
  readonly unit: string
  readonly fetchedAt: string
}

/** One purchasable plan from `GET /plans`. */
export interface MioPlan {
  readonly planId: number
  readonly planName: string
  /** Display grouping such as `MONTHLY`; it does not change validity. */
  readonly planType: string
  /** Plain or rich text describing what the plan includes. */
  readonly planContent: string
  /** Plan quota; 0 means unlimited. */
  readonly quota: number
  /** Purchases allowed per user within the validity window; 0 means unlimited. */
  readonly maxPurchasePerUser: number
  readonly price: number
  readonly currency: string
  readonly durationUnit: string
  readonly durationValue: number
  readonly customSeconds: number
  readonly quotaResetPeriod: string
  readonly quotaResetCustomSeconds: number
}

/** One purchase request for `POST /plans/{planId}/purchase`. */
export interface MioPurchaseRequest {
  readonly planId: number
  /** Client-generated idempotency key persisted for one purchase intent. */
  readonly requestId: string
  /** Payment channel; omitted lets the server decide. */
  readonly paymentChannel?: string
}

/** Purchase result; a WeChat Native `codeUrl` is rendered as a QR code. */
export interface MioPurchaseResult {
  readonly orderNo: string
  readonly paymentStatus: string
  readonly paymentChannel?: string | null | undefined
  readonly paymentScene?: string | null | undefined
  readonly codeUrl?: string | null | undefined
  readonly expireTime?: string | null | undefined
  readonly grantStatus: string
  readonly subscriptionId: number | null
}

/** Order state from `GET /orders/{orderNo}`. */
export interface MioOrderStatus {
  readonly orderNo: string
  readonly paymentStatus: string
  readonly paymentChannel?: string | null | undefined
  readonly paymentScene?: string | null | undefined
  readonly codeUrl?: string | null | undefined
  readonly expireTime?: string | null | undefined
  readonly grantStatus: string
  readonly subscriptionId?: number | null | undefined
}

/** One subscription from `GET /subscriptions`. */
export interface MioSubscription {
  readonly subscriptionId: number
  readonly planId: number
  readonly planName: string
  readonly amountTotal: number
  readonly amountUsed: number
  readonly startTime: string
  readonly endTime: string
  readonly status: string
  readonly lastResetTime?: string | null | undefined
  readonly nextResetTime?: string | null | undefined
  readonly allowWalletOverflow: boolean
}

/** Subscription list plus whether this read refreshed NewAPI. */
export interface MioSubscriptionsView {
  readonly items: readonly MioSubscription[]
  /** False means the items are the backend's last successful snapshot. */
  readonly realtime: boolean
}

/** One agreement document; `content` is trusted rich text and is never executed. */
export interface MioAgreement {
  readonly agreementType: string
  readonly title?: string | undefined
  readonly content: string
  readonly version?: string | undefined
  readonly updatedAt?: string | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** The business backend rejected the stored access token and the Host removed it.
     * @mode emit
     */
    'mio-account/session-expired'(): void
    /** Stored login state or model access changed; Host consumers re-read their inputs.
     * @mode emit
     */
    'mio-account/changed'(): void
  }
}
