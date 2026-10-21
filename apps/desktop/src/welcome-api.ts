/** Operations available to the isolated native welcome renderer. */

import type { ProductEventMap } from '@deepseek-ai/dsh-client-product-analytics/types'
import type {
  MioAccountView, MioAgreement, MioPasswordLoginRequest, MioResetPasswordRequest, MioSmsCode,
  MioSmsCodeRequest, MioSmsLoginRequest,
} from '@deepseek-ai/dsh-mio-account/types'
import type { DesktopLocale } from './locale.ts'

/** Private native welcome channels, installed only while its window exists. */
export const WELCOME_IPC = {
  analytics: 'dsh-welcome:analytics',
  analyticsEnabled: 'dsh-welcome:analytics-enabled',
  skip: 'dsh-welcome:skip',
  getState: 'dsh-welcome:get-state',
  sendSmsCode: 'dsh-welcome:send-sms-code',
  loginWithSms: 'dsh-welcome:login-sms',
  loginWithPassword: 'dsh-welcome:login-password',
  resetPassword: 'dsh-welcome:reset-password',
  getAgreements: 'dsh-welcome:get-agreements',
} as const

type WelcomeEventName = 'auth_page_view' | 'auth_page_click'

/** Host-owned operations used by the welcome window. */
export interface WelcomeOperations {
  /** @param eventName - allowed welcome event. @param attributes - approved fields without credentials. */
  analytics?<K extends WelcomeEventName>(eventName: K, attributes: ProductEventMap[K]): Promise<void>
  /** @returns the Host's current effective collection policy. */
  analyticsEnabled(): Promise<boolean>
  /** @returns current mioagent account state. */
  getState(): Promise<MioAccountView>
  /** @param request - SMS code request. @returns the issued code metadata. */
  sendSmsCode(request: MioSmsCodeRequest): Promise<MioSmsCode>
  /** @param request - SMS login request. @returns the account view after login. */
  loginWithSms(request: MioSmsLoginRequest): Promise<MioAccountView>
  /** @param request - password login request. @returns the account view after login. */
  loginWithPassword(request: MioPasswordLoginRequest): Promise<MioAccountView>
  /** @param request - password reset request. @returns after reset completes. */
  resetPassword(request: MioResetPasswordRequest): Promise<void>
  /** @returns the list of agreements the user must accept. */
  getAgreements(): Promise<readonly MioAgreement[]>
  /**
   * Enter the workspace without completing login.
   * @returns completion after the workspace opens.
   */
  skip(): Promise<void>
}

/** The renderer receives localized copy and login operations. */
export type WelcomeApi = DesktopLocale & WelcomeOperations

/** Authentication facts supplied at cold start or after a completed sign-out. */
export interface WelcomeAuthentication {
  readonly loggedIn: boolean
}

/**
 * Decide whether a startup or sign-out requires the welcome entry.
 * @param authentication - current account state.
 * @returns true when not logged in.
 */
export function needsWelcome(authentication: WelcomeAuthentication): boolean {
  return !authentication.loggedIn
}
