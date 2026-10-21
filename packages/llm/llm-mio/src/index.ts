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
import type {} from '@deepseek-ai/dsh-agent-default-model'
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
  /** Delay before re-reading account status while provisioning is incomplete. */
  provisioningRetryMs?: number
  /** Adopt the backend-declared default chat model when the current agent default is not routable. */
  autoSelectDefaultModel?: boolean
}

/** Validated deployment choices. */
export const Config = Schema.object({
  provider: Schema.string().default('mio'),
  displayName: Schema.string().default('mioagent'),
  catalogTtlMs: Schema.number().step(1).min(1).max(3_600_000).default(60_000),
  provisioningRetryMs: Schema.number().step(1).min(250).max(600_000).default(5_000),
  autoSelectDefaultModel: Schema.boolean().default(true),
})

export const name = 'llm-mio'
export const inject = ['llm', 'mioAccount', 'agentDefaultModel']

/**
 * Register the mioagent model route and keep it aligned with account state.
 * @param ctx - Host with the LLM registry and account service mounted.
 * @param config - route identity, catalog lifetime, and default-model policy.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = Config(config)
  if (resolved.provider.length === 0) throw new Error('llm-mio: provider must be a non-empty route name')
  if (resolved.displayName.length === 0) throw new Error('llm-mio: displayName must be non-empty')
  let selectedRoute: string | undefined
  let savingDefault = false
  // Login alone should leave the user on a usable model: when the stored
  // default names another provider or a model the backend no longer serves,
  // repoint it at the first published chat model.
  const selectDefaultModel = (models: readonly { readonly id: string }[], defaultModelId: string | undefined): void => {
    if (!resolved.autoSelectDefaultModel || savingDefault) return
    const preferred = models.find(model => model.id === defaultModelId) ?? models[0]
    if (preferred === undefined) return
    const route = `${resolved.provider}/${preferred.id}`
    if (route === selectedRoute) return
    const current = ctx.agentDefaultModel.currentSelection()
    if (current.provider === resolved.provider && models.some(model => model.id === current.model)) {
      selectedRoute = route
      return
    }
    savingDefault = true
    void ctx.agentDefaultModel.saveSelection({ provider: resolved.provider, model: preferred.id }).then(
      () => { selectedRoute = route },
      (error: unknown) => {
        ctx.logger.warn('llm-mio: could not save the default model selection')
        ctx.logger.warn(error)
      },
    ).finally(() => { savingDefault = false })
  }
  const adapter = new MioAdapter({
    context: ctx,
    account: ctx.mioAccount,
    provider: resolved.provider,
    displayName: resolved.displayName,
    catalogTtlMs: resolved.catalogTtlMs,
    provisioningRetryMs: resolved.provisioningRetryMs,
    onModelsPublished: selectDefaultModel,
  })
  ctx.effect(() => () => { adapter.dispose() }, 'llm-mio: model route')
  ctx.on('mio-account/changed', () => { adapter.markDirty() })
  ctx.on('mio-account/session-expired', () => { adapter.markDirty() })
  adapter.markDirty()
}

export { MioAdapter } from './adapter.ts'
export type { MioAdapterOptions } from './adapter.ts'
