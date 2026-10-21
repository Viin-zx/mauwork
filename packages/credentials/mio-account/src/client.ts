/**
 * Fetch client for the mioagent business API. It owns envelope handling,
 * deadlines, and unauthorized notification; callers own schemas and tokens.
 * @module @deepseek-ai/dsh-mio-account/client
 */

import type { ZodType } from 'zod'
import { MioAccountError } from './error.ts'
import { envelopeSchema } from './wire.ts'

/** Path prefix of the documented mioagent client API. */
export const MIO_API_PREFIX = '/mio/client/v1'

/** One business request. */
export interface MioRequest {
  /** HTTP method; GET when omitted. */
  readonly method?: 'GET' | 'POST' | 'DELETE'
  /** JSON request body. */
  readonly body?: unknown
  /** Access token sent as `Authorization: Bearer`. */
  readonly token?: string
  /** Caller cancellation. */
  readonly signal?: AbortSignal
}

/** Constructor options for {@link MioClient}. */
export interface MioClientOptions {
  /** Business backend origin, already validated by {@link normalizeMioBaseUrl}. */
  readonly baseUrl: string
  /** Deadline of one request. */
  readonly timeoutMs: number
  /** Notified before a 401 failure is thrown, so the provider can remove the session. */
  readonly onUnauthorized: () => Promise<void>
}

/**
 * Validate and normalize the business backend address.
 * @param value - configured origin with optional path prefix, for example `http://localhost:8080` or `https://example.com/prod-api`.
 * @returns the origin and path without a trailing slash.
 * @throws TypeError when the address is not a valid HTTP(S) URL with credentials, query, or fragment.
 */
export function normalizeMioBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new TypeError(`mio-account: businessBaseUrl "${value}" is not a valid URL`, { cause: error })
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '') {
    throw new TypeError('mio-account: businessBaseUrl must be an HTTP(S) URL without credentials, query, or fragment')
  }
  // Remove trailing slash from pathname (but keep bare `/` as empty).
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  return url.origin + path
}

/** Fetch-backed client for one business backend origin. */
export class MioClient {
  private readonly baseUrl: string

  /** @param options - origin, deadline, and unauthorized notification. */
  constructor(private readonly options: MioClientOptions) {
    this.baseUrl = normalizeMioBaseUrl(options.baseUrl)
  }

  /**
   * Perform one request and validate both the envelope and its data.
   * @param path - API path below `/mio/client/v1`.
   * @param schema - validator for the envelope's `data`.
   * @param request - method, body, token, and cancellation.
   * @returns the validated `data`.
   * @throws {MioAccountError} backend `errorCode`, or a client transport code.
   */
  async request<T>(path: string, schema: ZodType<T>, request: MioRequest = {}): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, this.options.timeoutMs)
    const signal = request.signal === undefined
      ? controller.signal
      : AbortSignal.any([request.signal, controller.signal])
    const headers: Record<string, string> = { accept: 'application/json' }
    if (request.token !== undefined) headers.authorization = `Bearer ${request.token}`
    if (request.body !== undefined) headers['content-type'] = 'application/json'
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${MIO_API_PREFIX}${path}`, {
        method: request.method ?? 'GET',
        headers,
        ...request.body === undefined ? {} : { body: JSON.stringify(request.body) },
        signal,
      })
    } catch (error) {
      if (request.signal?.aborted === true) throw request.signal.reason
      if (controller.signal.aborted) {
        throw new MioAccountError('TIMEOUT', `mioagent request timed out after ${this.options.timeoutMs}ms`, { cause: error })
      }
      throw new MioAccountError('NETWORK', 'mioagent request failed before a response arrived', { cause: error })
    } finally {
      clearTimeout(timer)
    }

    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      throw new MioAccountError('PROTOCOL', `mioagent returned a non-JSON response (HTTP ${response.status})`, {
        httpStatus: response.status,
        cause: error,
      })
    }
    const envelope = envelopeSchema.safeParse(body)
    if (!envelope.success) {
      throw new MioAccountError('PROTOCOL', `mioagent returned an invalid response envelope (HTTP ${response.status})`, {
        httpStatus: response.status,
        cause: envelope.error,
      })
    }
    const failure = envelope.data.code === 200 && response.ok
      ? undefined
      : {
        code: envelope.data.errorCode
          ?? (response.status === 401 || envelope.data.code === 401 ? 'TOKEN_INVALID' : `HTTP_${response.status}`),
        message: envelope.data.msg.length > 0 ? envelope.data.msg : `mioagent request failed (HTTP ${response.status})`,
      }
    if (failure !== undefined) {
      // Without a token the failure belongs to the credentials the request
      // carried, not to a stored session: a wrong password must not sign the
      // current user out.
      if (request.token !== undefined
        && (response.status === 401 || envelope.data.code === 401 || failure.code === 'TOKEN_INVALID')) {
        await this.options.onUnauthorized()
      }
      throw new MioAccountError(failure.code, failure.message, {
        httpStatus: response.status,
        ...envelope.data.traceId === undefined ? {} : { traceId: envelope.data.traceId },
      })
    }
    const data = schema.safeParse(envelope.data.data)
    if (!data.success) {
      const issues = data.error.issues
        .map(issue => `${issue.path.length === 0 ? '(root)' : issue.path.join('.')}: ${issue.code}`)
        .join(', ')
      throw new MioAccountError('PROTOCOL', `mioagent response data is invalid for ${path}: ${issues}`, {
        httpStatus: response.status,
        cause: data.error,
        ...envelope.data.traceId === undefined ? {} : { traceId: envelope.data.traceId },
      })
    }
    return data.data
  }
}
