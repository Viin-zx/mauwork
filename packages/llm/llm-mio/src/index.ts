/**
 * mioagent model route plugin. It registers one pi-ai-backed route whose
 * endpoint, key, and catalog come from the account seam, and withdraws the
 * route whenever the account is signed out or still provisioning.
 *
 * ```yaml
 * - id: llm-mio
 *   name: '@deepseek-ai/dsh-llm-mio'
 *   config:
 *     provider: mio
 *     displayName: mioagent
 * ```
 *
 * @module @deepseek-ai/dsh-llm-mio
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-mio-account'
import { MioAdapter } from './adapter.ts'

/** Deployment choices of the mioagent model route. */
export interface Config {
  /** Route key registered with the LLM registry; defaults to `mio`. */
  provider?: string
  /** Display name shown by model selectors; defaults to `mioagent`. */
  displayName?: string
  /** Maximum age of the fetched model directory before it is read again. */
  catalogTtlMs?: number
}

/** Validated deployment choices. */
export const Config = Schema.object({
  provider: Schema.string().default('mio'),
  displayName: Schema.string().default('mioagent'),
  catalogTtlMs: Schema.number().step(1).min(1).max(3_600_000).default(60_000),
})

export const name = 'llm-mio'
export const inject = ['llm', 'mioAccount']

/**
 * Register the mioagent model route and keep it aligned with account state.
 * @param ctx - Host with the LLM registry and account service mounted.
 * @param config - route identity and catalog lifetime.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = Config(config)
  if (resolved.provider.length === 0) throw new Error('llm-mio: provider must be a non-empty route name')
  if (resolved.displayName.length === 0) throw new Error('llm-mio: displayName must be non-empty')
  const adapter = new MioAdapter({
    context: ctx,
    account: ctx.mioAccount,
    provider: resolved.provider,
    displayName: resolved.displayName,
    catalogTtlMs: resolved.catalogTtlMs,
  })
  ctx.effect(() => () => { adapter.dispose() }, 'llm-mio: model route')
  ctx.on('mio-account/changed', () => { adapter.markDirty() })
  ctx.on('mio-account/session-expired', () => { adapter.markDirty() })
  adapter.markDirty()
}

export { MioAdapter } from './adapter.ts'
export type { MioAdapterOptions } from './adapter.ts'
