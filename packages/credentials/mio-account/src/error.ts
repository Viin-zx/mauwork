/** Typed failures of the mioagent business backend. */

/** Failure codes produced by this client; backend failures keep their own `errorCode`. */
export type MioInternalErrorCode = 'NETWORK' | 'TIMEOUT' | 'PROTOCOL' | 'NOT_SIGNED_IN' | 'STORAGE'

/** Options carried by {@link MioAccountError}. */
export interface MioAccountErrorOptions extends ErrorOptions {
  /** HTTP status observed at the business boundary. */
  httpStatus?: number
  /** Backend request trace identifier, safe to record for diagnosis. */
  traceId?: string
}

/**
 * One business-backend failure. Backend `errorCode` values are preserved
 * verbatim so callers branch on stable codes rather than messages.
 */
export class MioAccountError extends Error {
  /** Stable business or client failure code. */
  readonly code: string
  /** HTTP status when the failure came from a response. */
  readonly httpStatus?: number
  /** Backend trace identifier when supplied. */
  readonly traceId?: string

  /**
   * @param code - backend `errorCode`, or a {@link MioInternalErrorCode}.
   * @param message - user-displayable summary.
   * @param options - HTTP status, trace identifier, and cause.
   */
  constructor(code: string, message: string, options: MioAccountErrorOptions = {}) {
    super(message, options)
    this.name = 'MioAccountError'
    this.code = code
    if (options.httpStatus !== undefined) this.httpStatus = options.httpStatus
    if (options.traceId !== undefined) this.traceId = options.traceId
  }
}

/**
 * Identify a mioagent failure across duplicate module instances.
 * @param value - a caught value.
 * @returns the failure when it is a MioAccountError, otherwise undefined.
 */
export function mioAccountErrorOf(value: unknown): MioAccountError | undefined {
  return value instanceof MioAccountError ? value : undefined
}
