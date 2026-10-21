import type { ProductEvent } from '@deepseek-ai/dsh-client-product-analytics/types'
/** Native welcome operations using the shared Web authentication and RPC APIs. */

import { randomUUID } from 'node:crypto'
import type {
  MioAccountView, MioAgreement, MioPasswordLoginRequest, MioResetPasswordRequest, MioSmsCode,
  MioSmsCodeRequest, MioSmsLoginRequest,
} from '@deepseek-ai/dsh-mio-account/types'

/** Metadata needed before the native entry or workspace becomes visible. */
export interface WelcomeState {
  readonly loggedIn: boolean
  readonly localePreference: string | null
}

/** Narrow operations available to the native welcome flow. */
export interface DesktopWelcomeBackend {
  /** @returns the current Host policy; every read observes live configuration. */
  analyticsEnabled(): Promise<boolean>
  /** @param event - desktop-owned fields. @returns after local Host intake. */
  report(event: ProductEvent): Promise<void>
  /** @returns Configured-key presence and the shared language preference, without credential values. */
  read(): Promise<WelcomeState>
  /** @returns The saved UI language without account or provider requests. */
  readLocalePreference(): Promise<string | null>
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
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Authenticate the native HTTP client through the Web application's launch URL.
 * @param authenticatedUrl - URL supplied by the running Desktop Host.
 * @param send - Electron session fetch, retaining the Web authentication cookie.
 * @returns metadata reads and mioagent login operations over standard RPC.
 */
export async function connectDesktopWelcome(
  authenticatedUrl: string,
  send: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<DesktopWelcomeBackend> {
  const origin = new URL(authenticatedUrl).origin
  const authenticated = await send(authenticatedUrl, { credentials: 'include' })
  await authenticated.body?.cancel()
  if (!authenticated.ok) throw new Error('desktop welcome: Web authentication failed')
  const invoke = async (
    request: { namespace: string; method: string; args: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const rpcId = randomUUID()
    const method = `${request.namespace}/${request.method}`
    const response = await send(new URL(`/api/${method}`, origin).href, {
      method: 'POST', credentials: 'include', redirect: 'error', ...(signal === undefined ? {} : { signal }),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: request.args } }),
    })
    if (!response.ok) throw new Error('desktop welcome: Web request failed')
    const envelope: unknown = await response.json()
    if (!record(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId
      || !record(envelope.result)) {
      throw new Error('desktop welcome: Web RPC failed')
    }
    if (envelope.result.ok !== true) {
      const failure = envelope.result.error
      throw new Error(record(failure) && typeof failure.message === 'string' && failure.message !== ''
        ? failure.message
        : 'desktop welcome: Web RPC failed')
    }
    return envelope.result.value
  }
  const localePreference = async (): Promise<string | null> => {
    const settings = await invoke({ namespace: 'settings', method: 'describe', args: {} })
    if (!record(settings) || !Array.isArray(settings.namespaces)) throw new Error('desktop welcome: missing settings namespaces')
    const locale: unknown = settings.namespaces.find((item: unknown) => record(item) && item.ns === 'locale')
    if (!record(locale) || !record(locale.value)
      || (locale.value.preference !== undefined && typeof locale.value.preference !== 'string')) {
      throw new Error('desktop welcome: invalid locale preference')
    }
    return locale.value.preference ?? null
  }
  const read = async (): Promise<WelcomeState> => {
    let loggedIn = false
    try {
      const state = await invoke({ namespace: 'mioAccount', method: 'getState', args: {} })
      if (record(state) && state.status === 'signed-in') loggedIn = true
    } catch {
      // The mioAccount Remote may not exist; treat as not logged in.
    }
    return {
      loggedIn,
      localePreference: await localePreference(),
    }
  }
  return {
    read,
    async analyticsEnabled() {
      const enabled = await invoke({ namespace: 'productAnalytics', method: 'enabled', args: {} }, AbortSignal.timeout(1000))
      if (typeof enabled !== 'boolean') throw new Error('desktop analytics: invalid collection policy')
      return enabled
    },
    async report(event) { await invoke({ namespace: 'productAnalytics', method: 'report', args: { event } }, AbortSignal.timeout(1000)) },
    readLocalePreference: localePreference,
    async getState() {
      const state = await invoke({ namespace: 'mioAccount', method: 'getState', args: {} })
      return state as MioAccountView
    },
    async sendSmsCode(request) {
      const result = await invoke({ namespace: 'mioAccount', method: 'sendSmsCode', args: { request } })
      return result as MioSmsCode
    },
    async loginWithSms(request) {
      const result = await invoke({ namespace: 'mioAccount', method: 'loginWithSms', args: { request } })
      return result as MioAccountView
    },
    async loginWithPassword(request) {
      const result = await invoke({ namespace: 'mioAccount', method: 'loginWithPassword', args: { request } })
      return result as MioAccountView
    },
    async resetPassword(request) {
      await invoke({ namespace: 'mioAccount', method: 'resetPassword', args: { request } })
    },
    async getAgreements() {
      const result = await invoke({ namespace: 'mioAccount', method: 'getAgreements', args: {} })
      return result as readonly MioAgreement[]
    },
  }
}
