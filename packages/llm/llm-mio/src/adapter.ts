/**
 * pi-ai adapter for the mioagent model service. The route exists only while the
 * backend reports the account ready: the catalog, endpoint, and key all come
 * from the account seam, and the key reaches pi-ai per request rather than
 * through configuration.
 * @module @deepseek-ai/dsh-llm-mio/adapter
 */

import type { Context } from '@deepseek-ai/cordis'
import { assertUsableApiKey, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type {
  AdapterRegistrationHandle, GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo,
  PreparedAdapterCall, StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { authContextFrom, credentialStoreFrom, PiAiAdapter, resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiModelProfile, PiAiProviderProfile, ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { MioAccount } from '@deepseek-ai/dsh-mio-account'
import type { MioModel, MioModelCatalogView } from '@deepseek-ai/dsh-mio-account/types'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-fs'
import { reasoningEffortsFor } from './reasoning.ts'

/** Construction facts of {@link MioAdapter}. */
export interface MioAdapterOptions {
  /** Host context supplying the LLM, attachment, filesystem, and credential seams. */
  readonly context: Context
  /** Account service owning the session and model-access cache. */
  readonly account: MioAccount
  /** Harness route key this adapter registers while the account is ready. */
  readonly provider: string
  /** Display name shown by model selectors. */
  readonly displayName: string
  /** Maximum age of the fetched model directory before it is read again. */
  readonly catalogTtlMs: number
  /** Delay before re-reading provisioning status while the account is not ready. */
  readonly provisioningRetryMs: number
  /** Notified with the published chat models and the backend-declared default after one route refresh. */
  readonly onModelsPublished?: (models: readonly { readonly id: string }[], defaultModelId: string | undefined) => void
}

/** One catalog entry projected into the pi-ai model vocabulary. */
function toPiModel(model: MioModel): PiAiModelProfile {
  const { parameters } = model
  const efforts = reasoningEffortsFor(model.modelId)
  return {
    id: model.modelId,
    ...model.displayName === '' ? {} : { name: model.displayName },
    ...parameters.contextWindowTokens === undefined ? {} : { contextWindow: parameters.contextWindowTokens },
    ...parameters.maxOutputTokens === undefined ? {} : { maxTokens: parameters.maxOutputTokens },
    input: parameters.visionEnabled === true ? ['text', 'image'] : ['text'],
    ...efforts === undefined ? {} : { reasoningEfforts: efforts },
  }
}

/**
 * The model route backed by mioagent. Registration follows account readiness:
 * the route appears once `/account/status` reports both `READY`, and disappears
 * when the session ends or the account leaves that state, so signed-out
 * sessions are never offered a model they cannot call.
 */
export class MioAdapter extends PiAiAdapter {
  private profiles = new Map<string, ResolvedPiAiProviderProfile>()
  private catalog: { view: MioModelCatalogView; fetchedAt: number } | undefined
  private refreshing: Promise<void> | undefined
  private dirty = true
  private lastRefreshAt = 0
  private registration: AdapterRegistrationHandle | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  /** @param options - account seam, route identity, and catalog lifetime. */
  constructor(private readonly options: MioAdapterOptions) {
    super({
      profiles: () => this.profiles,
      resolveApiKey: () => this.modelKey(),
      auth: {
        credentials: credentialStoreFrom(options.context),
        authContext: authContextFrom(options.context),
      },
      resolveAttachments: () => options.context.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
        attachments,
        hostPath => options.context.get('fs')?.processPathFromHostPath(hostPath),
        ref,
      ),
      onReplayDegrade: ({ provider, model, reason }) => {
        options.context.logger.warn(
          `llm-mio: unusable replay state on assistant history for route "${provider}/${model}";`
          + ` sending that message as provider-neutral content (${reason})`,
        )
      },
    })
  }

  /**
   * Re-read account state, catalog, and model access, then publish or withdraw
   * the route. Coalesces concurrent callers onto one backend round trip.
   * @returns once the adapter reflects the latest account state.
   */
  async refreshNow(): Promise<void> {
    while (!this.disposed && (this.refreshing !== undefined || this.dirty || this.lastRefreshAt === 0
      || Date.now() - this.lastRefreshAt >= this.options.catalogTtlMs)) {
      if (this.refreshing !== undefined) {
        await this.refreshing
        continue
      }
      this.dirty = false
      const run = this.refresh()
      this.refreshing = run
      try {
        await run
      } catch (error) {
        this.dirty = true
        throw error
      } finally {
        this.refreshing = undefined
        this.lastRefreshAt = Date.now()
      }
    }
  }

  /** Mark the published route stale and refresh it in the background. */
  markDirty(): void {
    if (this.disposed) return
    this.dirty = true
    void this.refreshNow().catch((error: unknown) => {
      this.options.context.logger.warn('llm-mio: could not refresh the mioagent model route')
      this.options.context.logger.warn(error)
    })
  }

  /** Withdraw the route and stop observing account changes. */
  dispose(): void {
    this.disposed = true
    this.clearProvisioningRetry()
    this.registration?.()
    this.registration = undefined
    this.profiles = new Map()
    this.catalog = undefined
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.options.displayName }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve().then(async () => {
      await this.refreshNow()
      return this.profiles.has(provider) ? super.listModels(provider) : []
    })
  }

  override resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve().then(async () => {
      await this.refreshNow()
      return super.resolveModel(provider, model, signal)
    })
  }

  override prepareCall(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<PreparedAdapterCall> {
    return Promise.resolve().then(async () => {
      await this.refreshNow()
      const prepared = await super.prepareCall(provider, model, signal)
      return { model: prepared.model, stream: options => this.observeKeyRejection(prepared.stream(options)) }
    })
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.ensuredStream(options)
  }

  private async * ensuredStream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    await this.refreshNow()
    yield* this.observeKeyRejection(super.stream(options))
  }

  /**
   * Discard the cached model key when the model service rejects it, so the next
   * request resolves a fresh one through the account seam. The key failure is
   * still reported to the caller; a rejected business token clears the session
   * on its own when the refresh asks for model access again.
   */
  private async * observeKeyRejection(chunks: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    for await (const chunk of chunks) {
      if (chunk.type === 'finish' && chunk.reason.kind === 'error' && chunk.reason.failure.code === 'AUTH') {
        this.options.account.invalidateModelAccess()
      }
      yield chunk
    }
  }

  /** Resolve the current model key for one request, refusing a malformed value. */
  private async modelKey(): Promise<string> {
    const access = await this.options.account.getModelAccess()
    return assertUsableApiKey(access.apiKey, 'llm-mio', 'the mioagent model configuration')
  }

  /** Read the account and rebuild the route profile from backend facts. */
  private async refresh(): Promise<void> {
    const state = await this.options.account.getState()
    if (state.status !== 'signed-in' || state.user === null) {
      this.clearProvisioningRetry()
      this.catalog = undefined
      this.setProfiles(new Map())
      return
    }
    // The directory is readable after login; the model key and service are
    // only available once provisioning reports both statuses ready.
    const catalog = await this.ensureCatalog()
    if (state.user.accountStatus !== 'READY' || state.user.credentialStatus !== 'READY') {
      this.setProfiles(new Map())
      this.scheduleProvisioningRetry()
      return
    }
    this.clearProvisioningRetry()
    const access = await this.options.account.getModelAccess()
    const models: PiAiModelProfile[] = []
    const seen = new Set<string>()
    let defaultModelId: string | undefined
    for (const model of catalog.items) {
      // Only LANGUAGE models speak chat completions; the directory also lists
      // embedding, image, and other services this route cannot call.
      if (model.modelType !== 'LANGUAGE' || seen.has(model.modelId)) continue
      seen.add(model.modelId)
      if (model.isDefault && defaultModelId === undefined) defaultModelId = model.modelId
      models.push(toPiModel(model))
    }
    if (models.length === 0) {
      this.setProfiles(new Map())
      return
    }
    const profile: PiAiProviderProfile = {
      displayName: this.options.displayName,
      api: 'openai-completions',
      // The backend returns an OpenAI-compatible base URL; pi-ai's completion
      // client appends `/chat/completions`, so the trailing slash is dropped.
      baseURL: access.baseUrl.replace(/\/+$/, ''),
      models,
    }
    this.setProfiles(resolveProfiles({ [this.options.provider]: profile }))
    if (this.profiles.size > 0) this.options.onModelsPublished?.(models, defaultModelId)
  }

  /** Fetch the directory when the cached snapshot is older than its lifetime. */
  private async ensureCatalog(): Promise<MioModelCatalogView> {
    const cached = this.catalog
    if (cached !== undefined && Date.now() - cached.fetchedAt < this.options.catalogTtlMs) return cached.view
    const view = await this.options.account.getModels()
    this.catalog = { view, fetchedAt: Date.now() }
    return view
  }

  /**
   * Re-read provisioning status after one delay, then republish the route.
   * Runs only while a signed-in account is not ready; signing out or reaching
   * readiness stops the loop.
   */
  private scheduleProvisioningRetry(): void {
    if (this.disposed || this.retryTimer !== undefined) return
    const timer = setTimeout(() => {
      this.retryTimer = undefined
      void (async () => {
        try {
          const state = await this.options.account.getState()
          if (this.disposed || state.status !== 'signed-in' || state.user === null) {
            this.clearProvisioningRetry()
            return
          }
          await this.options.account.getAccountStatus()
          this.markDirty()
        } catch (error) {
          this.options.context.logger.warn('llm-mio: could not read the mioagent account status')
          this.options.context.logger.warn(error)
          this.scheduleProvisioningRetry()
        }
      })()
    }, this.options.provisioningRetryMs)
    timer.unref()
    this.retryTimer = timer
  }

  /** Stop waiting for provisioning progress. */
  private clearProvisioningRetry(): void {
    if (this.retryTimer === undefined) return
    clearTimeout(this.retryTimer)
    this.retryTimer = undefined
  }

  /** Publish a profile set and reconcile the registered route with it. */
  private setProfiles(profiles: Map<string, ResolvedPiAiProviderProfile>): void {
    if (this.disposed) return
    this.profiles = profiles
    const routes = profiles.size === 0 ? [] : [this.options.provider]
    try {
      if (this.registration === undefined) {
        if (routes.length === 0) return
        this.registration = this.options.context.llm.registerAdapter(routes, this)
        return
      }
      this.registration.replace(routes)
    } catch (error) {
      this.profiles = new Map()
      this.options.context.logger.error(`llm-mio: could not publish provider route "${this.options.provider}"`)
      this.options.context.logger.error(error)
    }
  }
}
