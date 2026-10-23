/** Account-driven route publication and streaming of the mioagent model adapter. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import LlmRuntime, { createMessage, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MioAccount } from '@deepseek-ai/dsh-mio-account'
import type { MioAccountStatusView, MioAccountView, MioAgreement, MioModelAccess, MioModelCatalogView, MioPasswordLoginRequest, MioQuotaView, MioRegisterRequest, MioResetPasswordRequest, MioSmsCode, MioSmsCodeRequest, MioSmsLoginRequest, MioUser } from '@deepseek-ai/dsh-mio-account/types'
import * as LlmMio from '../src/index.ts'
import { MioAdapter } from '../src/index.ts'
import type { MioAdapterOptions } from '../src/index.ts'
import { closeMockServers, mockServer, textEvents } from '../../llm-pi-ai/tests/mock-server.ts'

const USER: MioUser = {
  userId: 'account' as MioUser['userId'],
  maskedPhone: '138****0000',
  nickname: 'Tester',
  accountStatus: 'READY',
  credentialStatus: 'READY',
}
const READY: MioAccountView = { status: 'signed-in', user: USER, expiresAt: 1_800_000_000_000 }
const SIGNED_OUT: MioAccountView = { status: 'signed-out', user: null, expiresAt: null }
const ACCESS: MioModelAccess = {
  baseUrl: 'http://model.test/v1',
  apiKey: 'sk-model',
  credentialVersion: 1,
  expiresAt: '2030-01-01T00:00:00Z',
}
const CATALOG: MioModelCatalogView = {
  items: [
    {
      modelId: 'model-a',
      displayName: 'Model A',
      providerName: 'mio',
      modelType: 'LANGUAGE',
      requestTimeoutMs: 30_000,
      isDefault: true,
      parameters: { contextWindowTokens: 128_000, maxOutputTokens: 8_192, visionEnabled: true },
    },
    {
      modelId: 'model-a',
      displayName: 'Duplicate A',
      providerName: 'mio',
      modelType: 'LANGUAGE',
      requestTimeoutMs: 30_000,
      isDefault: false,
      parameters: {},
    },
    {
      modelId: 'model-b',
      displayName: 'Model B',
      providerName: 'mio',
      modelType: 'LANGUAGE',
      requestTimeoutMs: 30_000,
      isDefault: false,
      parameters: {},
    },
    {
      modelId: 'embed-1',
      displayName: 'Embedding',
      providerName: 'mio',
      modelType: 'EMBEDDING',
      requestTimeoutMs: 30_000,
      isDefault: false,
      parameters: {},
    },
    {
      modelId: 'image-1',
      displayName: 'Image',
      providerName: 'mio',
      modelType: 'IMAGE',
      requestTimeoutMs: 30_000,
      isDefault: false,
      parameters: {},
    },
  ],
  fetchedAt: '2026-10-20T00:00:00Z',
  stale: false,
}

const IMAGE: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png',
  bytes: 1,
  width: 1,
  height: 1,
}
const HOST_IMAGE_PATH = '/host/attachments/a.png'

/** Attachment provider that exposes the normalized object without reading its bytes. */
class StubAttachments extends Service {
  constructor(ctx: Context) { super(ctx, 'attachments') }

  imageHostPath(): string { return HOST_IMAGE_PATH }
}

/** Filesystem provider mapping the host object into the tool execution world. */
class StubFs extends Service {
  constructor(ctx: Context) { super(ctx, 'fs') }

  processPathFromHostPath(hostPath: string): string { return `/model${hostPath}` }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function imageMessage(): GenerateOptions['messages'] {
  return [createUserMessage({
    content: [{ type: 'image', attachment: IMAGE, offloaded: true }],
    source: { kind: 'test' },
  })]
}

const roots: Context[] = []
const adapters: MioAdapter[] = []
afterEach(async () => {
  for (const adapter of adapters.splice(0)) adapter.dispose()
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  await closeMockServers()
  vi.restoreAllMocks()
})

/** Account double: only state, catalog, model access, and provisioning drive the adapter. */
class TestAccount extends MioAccount {
  state: MioAccountView = SIGNED_OUT
  catalog: MioModelCatalogView = CATALOG
  access: MioModelAccess = ACCESS
  status: MioAccountStatusView = {
    status: 'READY', stage: 'done', credentialStatus: 'READY', retryable: false, retryAfterSeconds: 0,
  }
  modelReads = 0
  accessReads = 0
  statusReads = 0
  invalidations = 0
  stateGate: Promise<void> | undefined

  override async getState(): Promise<MioAccountView> {
    await this.stateGate
    return this.state
  }

  override getModels(): Promise<MioModelCatalogView> {
    this.modelReads += 1
    return Promise.resolve(this.catalog)
  }

  override getModelAccess(): Promise<MioModelAccess> {
    this.accessReads += 1
    return Promise.resolve(this.access)
  }

  override getAccountStatus(): Promise<MioAccountStatusView> {
    this.statusReads += 1
    return Promise.resolve(this.status)
  }

  override invalidateModelAccess(): void { this.invalidations += 1 }

  override watch(): AsyncIterable<MioAccountView> { throw new Error('unused') }
  override sendSmsCode(_request: MioSmsCodeRequest): Promise<MioSmsCode> { throw new Error('unused') }
  override register(_request: MioRegisterRequest): Promise<MioAccountView> { throw new Error('unused') }
  override loginWithPassword(_request: MioPasswordLoginRequest): Promise<MioAccountView> { throw new Error('unused') }
  override loginWithSms(_request: MioSmsLoginRequest): Promise<MioAccountView> { throw new Error('unused') }
  override resetPassword(_request: MioResetPasswordRequest): Promise<void> { throw new Error('unused') }
  override logout(): Promise<MioAccountView> { throw new Error('unused') }
  override getProfile(): Promise<MioUser | null> { throw new Error('unused') }
  override retryAccount(): Promise<MioAccountStatusView> { throw new Error('unused') }
  override getQuota(): Promise<MioQuotaView> { throw new Error('unused') }
  override getAgreements(): Promise<readonly MioAgreement[]> { throw new Error('unused') }
  override getPlugins(): Promise<never> { throw new Error('unused') }
  override getPlans(): Promise<never> { throw new Error('unused') }
  override purchasePlan(): Promise<never> { throw new Error('unused') }
  override getOrder(): Promise<never> { throw new Error('unused') }
  override getSubscriptions(): Promise<never> { throw new Error('unused') }
}

async function harness(
  catalogTtlMs = 60_000,
  options: { provisioningRetryMs?: number; onModelsPublished?: MioAdapterOptions['onModelsPublished'] } = {},
): Promise<{ ctx: Context; account: TestAccount; adapter: MioAdapter }> {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(LlmRuntime)
  const account = new TestAccount(ctx)
  const adapter = new MioAdapter({
    context: ctx,
    account,
    provider: 'mio',
    displayName: 'mauagent',
    catalogTtlMs,
    provisioningRetryMs: options.provisioningRetryMs ?? 5_000,
    ...options.onModelsPublished === undefined ? {} : { onModelsPublished: options.onModelsPublished },
  })
  adapters.push(adapter)
  return { ctx, account, adapter }
}

describe('route publication', () => {
  it('offers no route while signed out and reads no backend facts', async () => {
    const { ctx, account, adapter } = await harness()
    await adapter.refreshNow()

    expect(ctx.llm.listProviders()).toEqual([])
    expect(await adapter.listModels('mio')).toEqual([])
    expect(account.modelReads).toBe(0)
    expect(account.accessReads).toBe(0)
  })

  it('publishes only LANGUAGE models once both statuses are ready', async () => {
    const { ctx, account, adapter } = await harness()
    account.state = READY
    await adapter.refreshNow()

    expect(ctx.llm.listProviders()).toEqual([{ id: 'mio', name: 'mauagent' }])
    expect(await adapter.listModels('mio')).toMatchObject([
      { provider: 'mio', id: 'model-a', name: 'Model A', inputModalities: ['text', 'image'] },
      { provider: 'mio', id: 'model-b', name: 'Model B', inputModalities: ['text'] },
    ])
    expect(await adapter.resolveModel('mio', 'model-a')).toMatchObject({
      provider: 'mio',
      id: 'model-a',
      context: { contextWindow: 128_000 },
    })
  })

  it('withholds the route while account provisioning is incomplete', async () => {
    const { ctx, account, adapter } = await harness()
    account.state = {
      ...READY,
      user: { ...USER, accountStatus: 'PROVISIONING', credentialStatus: 'PENDING' },
    }
    await adapter.refreshNow()

    expect(ctx.llm.listProviders()).toEqual([])
    expect(account.modelReads).toBe(1)
    expect(account.accessReads).toBe(0)
  })

  it('publishes the chat model projections to its observer', async () => {
    const published = vi.fn()
    const { account, adapter } = await harness(60_000, { onModelsPublished: published })
    account.state = READY
    await adapter.refreshNow()

    expect(published).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ id: 'model-a' }),
      expect.objectContaining({ id: 'model-b' }),
    ], 'model-a')
  })

  it('reports the backend-declared default among the published chat models', async () => {
    const published = vi.fn()
    const { account, adapter } = await harness(60_000, { onModelsPublished: published })
    account.state = READY
    account.catalog = {
      ...CATALOG,
      items: CATALOG.items.map(item => item.modelId === 'model-b'
        ? { ...item, isDefault: true }
        : { ...item, isDefault: false }),
    }
    await adapter.refreshNow()

    expect(published.mock.calls[0]?.[1]).toBe('model-b')
  })

  it('polls provisioning status until the account becomes ready', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, account, adapter } = await harness(60_000, { provisioningRetryMs: 1_000 })
      account.state = { ...READY, user: { ...USER, accountStatus: 'PROVISIONING', credentialStatus: 'PENDING' } }
      await adapter.refreshNow()
      expect(ctx.llm.listProviders()).toEqual([])
      expect(account.statusReads).toBe(0)

      account.state = READY
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.advanceTimersByTimeAsync(0)
      expect(account.statusReads).toBe(1)
      await vi.advanceTimersByTimeAsync(0)
      expect(ctx.llm.listProviders()).toEqual([{ id: 'mio', name: 'mauagent' }])
    } finally { vi.useRealTimers() }
  })

  it('stops polling when disposed before the retry fires', async () => {
    vi.useFakeTimers()
    try {
      const { account, adapter } = await harness(60_000, { provisioningRetryMs: 1_000 })
      account.state = { ...READY, user: { ...USER, accountStatus: 'PROVISIONING', credentialStatus: 'PENDING' } }
      await adapter.refreshNow()
      adapter.dispose()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(account.statusReads).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('publishes nothing when the directory offers no chat model', async () => {
    const { ctx, account, adapter } = await harness()
    account.state = READY
    account.catalog = { ...CATALOG, items: CATALOG.items.filter(item => item.modelType !== 'LANGUAGE') }
    await adapter.refreshNow()

    expect(ctx.llm.listProviders()).toEqual([])
    expect(account.accessReads).toBe(1)
  })

  it('withdraws the route when the account signs out', async () => {
    const { ctx, account, adapter } = await harness()
    account.state = READY
    await adapter.refreshNow()
    expect(ctx.llm.listProviders()).toHaveLength(1)

    account.state = SIGNED_OUT
    adapter.markDirty()
    await adapter.refreshNow()
    expect(ctx.llm.listProviders()).toEqual([])
    expect(account.accessReads).toBe(1)
  })

  it('withdraws the route on disposal and ignores later refreshes', async () => {
    const { ctx, account, adapter } = await harness()
    account.state = READY
    await adapter.refreshNow()
    adapter.dispose()

    expect(ctx.llm.listProviders()).toEqual([])
    expect(await adapter.listModels('mio')).toEqual([])
    adapter.markDirty()
    await adapter.refreshNow()
    expect(account.modelReads).toBe(1)
  })

  it('withdraws the route when disposal races an in-flight refresh', async () => {
    const { ctx, account, adapter } = await harness()
    account.state = READY
    const gate = Promise.withResolvers<undefined>()
    account.stateGate = gate.promise
    const refresh = adapter.refreshNow()
    adapter.dispose()
    gate.resolve(undefined)
    await refresh

    expect(ctx.llm.listProviders()).toEqual([])
    expect(await adapter.listModels('mio')).toEqual([])
  })

  it('keeps the catalog until its lifetime expires', async () => {
    const { account, adapter } = await harness()
    account.state = READY
    await adapter.refreshNow()
    adapter.markDirty()
    await adapter.refreshNow()

    expect(account.modelReads).toBe(1)
  })

  it('coalesces concurrent refreshes onto one backend round trip', async () => {
    const { account, adapter } = await harness()
    account.state = READY
    const gate = Promise.withResolvers<undefined>()
    account.stateGate = gate.promise
    const first = adapter.refreshNow()
    const second = adapter.refreshNow()
    gate.resolve(undefined)
    await Promise.all([first, second])
    account.stateGate = undefined

    expect(account.modelReads).toBe(1)
    expect(await adapter.listModels('mio')).toHaveLength(2)
  })

  it('retries after a failed refresh', async () => {
    const { account, adapter } = await harness()
    account.state = READY
    const failure = new Error('backend unavailable')
    const getState = vi.spyOn(account, 'getState').mockRejectedValueOnce(failure)
    await expect(adapter.refreshNow()).rejects.toBe(failure)
    getState.mockRestore()

    await adapter.refreshNow()
    expect(await adapter.listModels('mio')).toHaveLength(2)
  })

  it('logs a background refresh failure without disturbing the route', async () => {
    const { ctx, account, adapter } = await harness()
    account.state = READY
    await adapter.refreshNow()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    vi.spyOn(account, 'getState').mockRejectedValueOnce(new Error('offline'))
    adapter.markDirty()

    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('llm-mio: could not refresh the mioagent model route') })
    expect(ctx.llm.listProviders()).toHaveLength(1)
  })

  it('reports a route conflict without publishing a stale profile', async () => {
    const { ctx, account, adapter } = await harness()
    class OtherAdapter extends LlmAdapter {
      override providerInfo(provider: string) {
        return { id: provider, name: 'other' }
      }
      override async * stream(): AsyncIterable<never> {}
    }
    ctx.llm.registerAdapter(['mio'], new OtherAdapter())
    const error = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
    account.state = READY
    await adapter.refreshNow()

    expect(error).toHaveBeenCalledWith('llm-mio: could not publish provider route "mio"')
    expect(ctx.llm.listProviders()).toEqual([{ id: 'mio', name: 'other' }])
    expect(await adapter.listModels('mio')).toEqual([])
  })
})

describe('model calls', () => {
  it('streams through the prepared call with the model id, key, and normalized endpoint', async () => {
    const server = await mockServer([{ events: textEvents }])
    const { ctx, account, adapter } = await harness()
    account.state = READY
    account.access = { ...ACCESS, baseUrl: `${server.url}/v1//` }
    await adapter.refreshNow()

    const chunks = []
    for await (const chunk of ctx.llm.stream({ provider: 'mio', model: 'model-a', messages: [] })) chunks.push(chunk)

    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(server.paths).toEqual(['/v1/chat/completions'])
    expect(server.headers[0]?.authorization).toBe('Bearer sk-model')
    expect(server.requests[0]).toMatchObject({ model: 'model-a', stream: true })
  })

  it('streams directly for callers that bypass call preparation', async () => {
    const server = await mockServer([{ events: textEvents }])
    const { account, adapter } = await harness()
    account.state = READY
    account.access = { ...ACCESS, baseUrl: `${server.url}/v1` }
    await adapter.refreshNow()

    const chunks = []
    for await (const chunk of adapter.stream({ provider: 'mio', model: 'model-a', messages: [] })) chunks.push(chunk)

    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(server.requests[0]).toMatchObject({ model: 'model-a' })
  })

  it('refuses image history without the durable attachment service', async () => {
    const { account, adapter } = await harness()
    account.state = READY
    await adapter.refreshNow()

    await expect(collect(adapter.stream({
      provider: 'mio',
      model: 'model-a',
      messages: imageMessage(),
    }))).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
  })

  it('resolves offloaded image access through the filesystem provider', async () => {
    const server = await mockServer([{ events: textEvents }])
    const { ctx, account, adapter } = await harness()
    account.state = READY
    account.access = { ...ACCESS, baseUrl: `${server.url}/v1` }
    await adapter.refreshNow()
    await ctx.plugin(StubAttachments)
    await ctx.plugin(StubFs)

    const chunks = await collect(adapter.stream({
      provider: 'mio',
      model: 'model-a',
      messages: imageMessage(),
    }))

    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(JSON.stringify(server.requests[0])).toContain(`/model${HOST_IMAGE_PATH}`)
  })

  it('reports unusable replay state instead of failing the call', async () => {
    const server = await mockServer([{ events: textEvents }])
    const { ctx, account, adapter } = await harness()
    account.state = READY
    account.access = { ...ACCESS, baseUrl: `${server.url}/v1` }
    await adapter.refreshNow()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

    const chunks = await collect(adapter.stream({
      provider: 'mio',
      model: 'model-a',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        source: {
          kind: 'model',
          ...{
            provider: 'mio',
            model: 'old',
            replayState: { response: { kind: 'pi-ai', version: 3 }, blocks: [] },
          },
        },
      })],
    }))

    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unusable replay state'))
  })

  it('invalidates the cached model key when the service rejects it', async () => {
    const server = await mockServer([{
      status: 401,
      body: JSON.stringify({ error: { message: 'invalid api key 401' } }),
    }])
    const { ctx, account, adapter } = await harness()
    account.state = READY
    account.access = { ...ACCESS, baseUrl: `${server.url}/v1` }
    await adapter.refreshNow()

    const chunks = []
    for await (const chunk of ctx.llm.stream({ provider: 'mio', model: 'model-a', messages: [] })) chunks.push(chunk)

    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH' } } })
    expect(account.invalidations).toBe(1)
  })
})

describe('plugin composition', () => {
  /** Default-model double: records persisted selections without a config editor. */
  class StubDefaultModel extends Service {
    selection: { provider: string; model: string } = { provider: 'deepseek-official', model: 'deepseek-flash' }
    saves: { provider: string; model: string }[] = []

    constructor(ctx: Context) { super(ctx, 'agentDefaultModel') }

    currentSelection(): { provider: string; model: string } { return this.selection }

    async saveSelection(next: { provider: string; model: string }): Promise<void> {
      this.saves.push({ provider: next.provider, model: next.model })
      this.selection = next
    }
  }

  it('reconciles the route with account events and adopts the first published model', async () => {
    const ctx = new Context()
    roots.push(ctx)
    await ctx.plugin(LlmRuntime)
    const account = new TestAccount(ctx)
    const defaults = new StubDefaultModel(ctx)
    account.state = READY
    await ctx.plugin(LlmMio)

    await vi.waitFor(() => { expect(ctx.llm.listProviders()).toEqual([{ id: 'mio', name: 'mauagent' }]) })
    await vi.waitFor(() => { expect(defaults.saves).toEqual([{ provider: 'mio', model: 'model-a' }]) })
    account.state = SIGNED_OUT
    ctx.emit('mio-account/changed')
    await vi.waitFor(() => { expect(ctx.llm.listProviders()).toEqual([]) })
    account.state = READY
    ctx.emit('mio-account/session-expired')
    await vi.waitFor(() => { expect(ctx.llm.listProviders()).toEqual([{ id: 'mio', name: 'mauagent' }]) })
    expect(defaults.saves).toHaveLength(1)
  })

  it('keeps a routable stored default model', async () => {
    const ctx = new Context()
    roots.push(ctx)
    await ctx.plugin(LlmRuntime)
    const account = new TestAccount(ctx)
    const defaults = new StubDefaultModel(ctx)
    defaults.selection = { provider: 'mio', model: 'model-b' }
    account.state = READY
    await ctx.plugin(LlmMio)

    await vi.waitFor(() => { expect(ctx.llm.listProviders()).toEqual([{ id: 'mio', name: 'mauagent' }]) })
    expect(defaults.saves).toEqual([])
    expect(defaults.selection).toEqual({ provider: 'mio', model: 'model-b' })
  })

  it('adopts the backend-declared default even when it is not first', async () => {
    const ctx = new Context()
    roots.push(ctx)
    await ctx.plugin(LlmRuntime)
    const account = new TestAccount(ctx)
    const defaults = new StubDefaultModel(ctx)
    account.state = READY
    account.catalog = {
      ...CATALOG,
      items: CATALOG.items.map(item => item.modelId === 'model-b'
        ? { ...item, isDefault: true }
        : { ...item, isDefault: false }),
    }
    await ctx.plugin(LlmMio)

    await vi.waitFor(() => { expect(defaults.saves).toEqual([{ provider: 'mio', model: 'model-b' }]) })
  })

  it('rejects an unnamed route or display name', async () => {
    const ctx = new Context()
    roots.push(ctx)
    await ctx.plugin(LlmRuntime)
    new TestAccount(ctx)
    expect(() => { LlmMio.apply(ctx, { provider: '', displayName: 'mauagent' }) }).toThrow(/provider/)
    expect(() => { LlmMio.apply(ctx, { provider: 'mio', displayName: '' }) }).toThrow(/displayName/)
  })
})
