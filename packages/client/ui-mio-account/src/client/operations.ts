/** Account calls shared by the login form, the reset dialog, and the launcher. */
import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  MioAccountView, MioAgreement, MioPasswordLoginRequest, MioResetPasswordRequest, MioSmsCode,
  MioSmsCodeRequest, MioSmsLoginRequest,
} from '@deepseek-ai/dsh-mio-account/types'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MioAccountState } from './account-state.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Mirrors the controller's wire contract for mioagent business failures. */
    'mio-account/failure': { readonly code: string; readonly httpStatus?: number; readonly traceId?: string }
  }
}

/** One account failure with its stable backend code preserved for branching. */
export class MioAccountClientError extends Error {
  /**
   * @param code - backend `errorCode`, or a Remote carrier code.
   * @param message - user-displayable summary from the backend.
   */
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'MioAccountClientError'
  }
}

/** Business face shared by every login-surface slot registration. */
export interface MioAccountInjected {
  hooks: { account: HostObservable<MioAccountState> }
  readonly sendSmsCode: (request: MioSmsCodeRequest) => Promise<MioSmsCode>
  readonly loginWithSms: (request: MioSmsLoginRequest) => Promise<MioAccountView>
  readonly loginWithPassword: (request: MioPasswordLoginRequest) => Promise<MioAccountView>
  readonly resetPassword: (request: MioResetPasswordRequest) => Promise<void>
  readonly getAgreements: () => Promise<readonly MioAgreement[]>
  readonly logout: () => Promise<MioAccountView>
}

/** Injected face without its observable compartment. */
export type MioAccountOperations = Omit<MioAccountInjected, 'hooks'>

/** @param failure - Remote error branch. @returns the failure with the backend code when present. */
function accountFailure(failure: RemoteFailure): MioAccountClientError {
  return failure.code === 'mio-account/failure'
    ? new MioAccountClientError(failure.details.code, failure.message)
    : new MioAccountClientError(failure.code, failure.message)
}

/**
 * Resolve user-displayable copy for a caught failure.
 * @param error - caught value.
 * @param fallback - copy used when the error carries no message.
 * @returns user-displayable copy.
 */
export function accountMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== '' ? error.message : fallback
}

/**
 * Bind the account Remote namespace to the login surface's operations.
 * @param ctx - client context carrying the mounted mioAccount Remote.
 * @returns operations shared by every registration.
 */
export function createMioAccountOperations(ctx: Context): MioAccountOperations {
  const call = async <T>(operation: () => Promise<RemoteResult<T>>): Promise<T> => {
    const result = await operation()
    if (result.ok) return result.value
    throw accountFailure(result.error)
  }
  return {
    sendSmsCode: request => call(() => ctx.remote.mioAccount.sendSmsCode(request)),
    loginWithSms: request => call(() => ctx.remote.mioAccount.loginWithSms(request)),
    loginWithPassword: request => call(() => ctx.remote.mioAccount.loginWithPassword(request)),
    resetPassword: request => call(() => ctx.remote.mioAccount.resetPassword(request)),
    getAgreements: () => call(() => ctx.remote.mioAccount.getAgreements()),
    logout: () => call(() => ctx.remote.mioAccount.logout()),
  }
}
