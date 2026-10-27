/** Behavior of the mioagent account provider at its HTTP and credential boundaries. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import MioAccountHttp, { normalizeMioBaseUrl } from '../src/index.ts'
import type { Config, MioAccountView } from '../src/index.ts'

const BASE = 'http://mio.test'
const SESSION_KEY = credentialKey('mio-account', 'session')

const USER = {
  userId: '42',
  maskedPhone: '138****0000',
  nickname: 'Tester',
  accountStatus: 'INITIALIZING',
  credentialStatus: 'PENDING',
}

const SIGNED_OUT: MioAccountView = { status: 'signed-out', user: null }

interface Request {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

interface Reply {
  status?: number
  body?: unknown
  raw?: string
  /** Runs before the response is produced, so a test can change stored state mid-request. */
  before?: () => Promise<void>
}

const requests: Request[] = []
const replies: Reply[] = []
const cleanups: Array<() => Promise<void>> = []

beforeEach(() => {
  requests.length = 0
  replies.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = input
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(init.headers ?? {})) headers[name.toLowerCase()] = String(value)
    requests.push({
      url,
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    const reply = replies.shift()
    if (reply === undefined) throw new Error(`unexpected request: ${url}`)
    await reply.before?.()
    return new Response(reply.raw ?? JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }))
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  while (cleanups.length > 0) await cleanups.pop()!()
})

function ok(data: unknown): Reply {
  return { body: { code: 200, msg: '', data } }
}

function loginReply(overrides: { token?: string } = {}): Reply {
  return ok({
    accessToken: overrides.token ?? 'at-1',
    tokenType: 'Bearer',
    user: USER,
  })
}

async function bootCredentials(): Promise<Context> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mio-account-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  return ctx
}

async function boot(config: Partial<Config> = {}): Promise<Context> {
  const ctx = await bootCredentials()
  await ctx.plugin(MioAccountHttp, { businessBaseUrl: BASE, ...config })
  return ctx
}

/** Boot the provider on its own fiber so a test can reload it and inspect the retired instance. */
async function bootControlled(config: Partial<Config> = {}) {
  const ctx = await bootCredentials()
  const fiber = ctx.plugin(MioAccountHttp, { businessBaseUrl: BASE, ...config })
  await fiber
  return { ctx, fiber, account: ctx.mioAccount }
}

async function signedIn(config: Partial<Config> = {}, token = 'at-1'): Promise<Context> {
  const ctx = await boot(config)
  replies.push(loginReply({ token }))
  await ctx.mioAccount.loginWithPassword({ countryCode: '+86', mobile: '13800000000', password: 'secret123' })
  requests.length = 0
  return ctx
}

function changedEvents(ctx: Context): number[] {
  const seen: number[] = []
  ctx.on('mio-account/changed', () => { seen.push(1) })
  return seen
}

describe('business origin validation', () => {
  it('accepts a bare HTTP(S) origin and drops the trailing slash', () => {
    expect(normalizeMioBaseUrl('http://localhost:8080/')).toBe('http://localhost:8080')
    expect(normalizeMioBaseUrl('HTTPS://MIO.test')).toBe('https://mio.test')
  })

  it('accepts an origin with a path prefix and drops the trailing slash', () => {
    expect(normalizeMioBaseUrl('https://mioagent.dev.zrshuiwu.com/prod-api')).toBe('https://mioagent.dev.zrshuiwu.com/prod-api')
    expect(normalizeMioBaseUrl('https://mioagent.dev.zrshuiwu.com/prod-api/')).toBe('https://mioagent.dev.zrshuiwu.com/prod-api')
    expect(normalizeMioBaseUrl('http://localhost:8080/api/v1')).toBe('http://localhost:8080/api/v1')
  })

  it.each([
    ['not a url', /not a valid URL/],
    ['ftp://mio.test', /HTTP\(S\) URL/],
    ['http://user@mio.test', /HTTP\(S\) URL/],
    ['http://:secret@mio.test', /HTTP\(S\) URL/],
    ['http://mio.test?q=1', /HTTP\(S\) URL/],
    ['http://mio.test#fragment', /HTTP\(S\) URL/],
  ] as const)('rejects %s', (value, message) => {
    expect(() => normalizeMioBaseUrl(value)).toThrow(message)
  })

  it('mounts with a path prefix', async () => {
    const ctx = await bootCredentials()
    await expect(ctx.plugin(MioAccountHttp, { businessBaseUrl: 'http://mio.test/v1' })).resolves.toBeDefined()
  })
})

describe('login and registration', () => {
  it('stores a password login as one grant and exposes only the safe view', async () => {
    const ctx = await boot()
    replies.push(loginReply())
    const view = await ctx.mioAccount.loginWithPassword({
      countryCode: '+86',
      mobile: '13800000000',
      password: 'secret123',
    })

    expect(view).toMatchObject({ status: 'signed-in', user: USER })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      url: `${BASE}/mio/client/v1/auth/login/password`,
      method: 'POST',
      body: { countryCode: '+86', mobile: '13800000000', password: 'secret123' },
    })
    expect(requests[0]?.headers['authorization']).toBeUndefined()
    const record = await ctx.credentials.readRecord(SESSION_KEY)
    expect(record?.kind === 'grant' ? record.payload : undefined)
      .toMatchObject({ version: 1, accessToken: 'at-1', user: USER })
    expect(await ctx.mioAccount.getState()).toEqual(view)
  })

  it('stores a login without a user projection', async () => {
    const ctx = await boot()
    replies.push(ok({ accessToken: 'at-1' }))
    const view = await ctx.mioAccount.loginWithPassword({
      countryCode: '+86',
      mobile: '13800000000',
      password: 'secret123',
    })
    expect(view).toEqual({ status: 'signed-in', user: null })
    const record = await ctx.credentials.readRecord(SESSION_KEY)
    expect(record?.kind === 'grant' ? record.payload : undefined)
      .toMatchObject({ version: 1, accessToken: 'at-1', user: null })
    expect(await ctx.mioAccount.getState()).toEqual(view)
  })

  it('normalizes nullable user fields', async () => {
    const ctx = await boot()
    replies.push(ok({
      accessToken: 'at-1',
      user: {
        userId: 7, maskedPhone: null, nickname: null, accountStatus: null, credentialStatus: 'READY',
      },
    }))
    const view = await ctx.mioAccount.loginWithPassword({
      countryCode: '+86',
      mobile: '13800000000',
      password: 'secret123',
    })
    expect(view.user).toEqual({
      userId: '7', maskedPhone: '', nickname: '', accountStatus: '', credentialStatus: 'READY',
    })
  })

  it('omits absent SMS fields from registration and forwards a caller signal', async () => {
    const ctx = await boot()
    replies.push(ok({ accessToken: 'at-register', user: USER }))
    const lifetime = new AbortController()
    const view = await ctx.mioAccount.register({
      countryCode: '+86',
      mobile: '13800000000',
      password: 'secret123',
      nickname: 'Tester',
    }, lifetime.signal)
    expect(view.status).toBe('signed-in')
    expect(requests[0]).toMatchObject({
      url: `${BASE}/mio/client/v1/auth/register`,
      body: { countryCode: '+86', mobile: '13800000000', password: 'secret123', nickname: 'Tester' },
    })
    expect(requests[0]?.body).not.toHaveProperty('smsRequestId')
    expect(requests[0]?.body).not.toHaveProperty('smsCode')
  })

  it('forwards SMS fields in registration and both SMS login shapes', async () => {
    const ctx = await boot()
    replies.push(ok({ accessToken: 'at-register', user: USER }))
    await ctx.mioAccount.register({
      countryCode: '+86',
      mobile: '13800000000',
      password: 'secret123',
      nickname: 'Tester',
      smsRequestId: 'sms-1',
      smsCode: '123456',
    })
    replySmsCode()
    const code = await ctx.mioAccount.sendSmsCode({ countryCode: '+86', mobile: '13800000000', scene: 'LOGIN' })
    expect(code).toEqual({ smsRequestId: 'sms-1', retryAfterSeconds: 60, expiresIn: 300 })
    replies.push(loginReply({ token: 'at-sms' }))
    await ctx.mioAccount.loginWithSms({
      countryCode: '+86',
      mobile: '13800000000',
      smsRequestId: 'sms-1',
      smsCode: '123456',
    })
    expect(requests.map(request => request.url)).toEqual([
      `${BASE}/mio/client/v1/auth/register`,
      `${BASE}/mio/client/v1/auth/sms/code`,
      `${BASE}/mio/client/v1/auth/login/sms`,
    ])
    expect(requests[0]?.body).toMatchObject({ smsRequestId: 'sms-1', smsCode: '123456' })
    expect(requests[1]).toMatchObject({
      method: 'POST',
      body: { countryCode: '+86', mobile: '13800000000', scene: 'LOGIN' },
    })
    expect(requests[2]?.body).toEqual({
      countryCode: '+86',
      mobile: '13800000000',
      smsRequestId: 'sms-1',
      smsCode: '123456',
    })
    expect(requests[2]?.headers['authorization']).toBeUndefined()
  })

  it('resets a forgotten password with an anonymous SMS-authorized request', async () => {
    const ctx = await boot()
    replies.push(ok({ smsRequestId: 'sms-reset', retryAfterSeconds: 60, expiresIn: 300 }))
    await ctx.mioAccount.sendSmsCode({ countryCode: '+86', mobile: '13800000000', scene: 'RESET_PASSWORD' })
    replies.push(ok(null))
    await expect(ctx.mioAccount.resetPassword({
      countryCode: '+86',
      mobile: '13800000000',
      smsRequestId: 'sms-reset',
      smsCode: '654321',
      newPassword: 'newsecret123',
    })).resolves.toBeUndefined()

    expect(requests.map(request => request.url)).toEqual([
      `${BASE}/mio/client/v1/auth/sms/code`,
      `${BASE}/mio/client/v1/auth/password/reset`,
    ])
    expect(requests[0]?.body).toEqual({ countryCode: '+86', mobile: '13800000000', scene: 'RESET_PASSWORD' })
    expect(requests[1]).toMatchObject({
      method: 'POST',
      body: {
        countryCode: '+86',
        mobile: '13800000000',
        smsRequestId: 'sms-reset',
        smsCode: '654321',
        newPassword: 'newsecret123',
      },
    })
    expect(requests[1]?.headers['authorization']).toBeUndefined()
  })

  it('clears the stored session after a password reset revokes its token', async () => {
    const ctx = await signedIn()
    replies.push(ok(null))
    await ctx.mioAccount.resetPassword({
      countryCode: '+86',
      mobile: '13800000000',
      smsRequestId: 'sms-reset',
      smsCode: '654321',
      newPassword: 'newsecret123',
    })

    expect(await ctx.mioAccount.getState()).toEqual(SIGNED_OUT)
    expect(await ctx.credentials.readRecord(SESSION_KEY)).toBeUndefined()
  })

  it('reads the enabled plugin catalog with the stored token', async () => {
    const ctx = await signedIn()
    replies.push(ok([{
      pluginId: 42,
      pluginName: 'AI 生图',
      packageName: '@q253595422/dsh-imagegen-video',
      category: 'image',
      description: 'Generate images',
      status: '0',
      autoRefresh: '0',
      config: { target: 'imagegen', values: { channels: [] } },
    }]))

    expect(await ctx.mioAccount.getPlugins()).toEqual([{
      pluginId: '42',
      pluginName: 'AI 生图',
      packageName: '@q253595422/dsh-imagegen-video',
      category: 'image',
      description: 'Generate images',
      autoRefresh: true,
      config: { target: 'imagegen', values: { channels: [] } },
    }])
    expect(requests[0]).toMatchObject({
      url: `${BASE}/mio/client/v1/plugins`,
      method: 'GET',
      headers: { authorization: 'Bearer at-1' },
    })
  })

  it('reads the refresh switch only from the status-convention on value', async () => {
    const ctx = await signedIn()
    const entry = (autoRefresh: unknown): Record<string, unknown> => ({
      pluginId: 1, pluginName: 'p', packageName: '@acme/dsh-p', category: '', description: '', autoRefresh,
    })
    replies.push(ok([entry('0'), entry(0), entry('1'), entry(1), entry(undefined), entry(true)]))

    expect((await ctx.mioAccount.getPlugins()).map(item => item.autoRefresh))
      .toEqual([true, true, false, false, false, false])
  })

  it('uses the stored token for the authenticated password-change flow', async () => {
    const ctx = await signedIn()
    replies.push(ok({ smsRequestId: 'sms-change', retryAfterSeconds: 60, expiresIn: 300 }))
    expect(await ctx.mioAccount.sendSmsCode({
      countryCode: '+86', mobile: '', scene: 'RESET_PASSWORD', authenticated: true,
    })).toEqual({ smsRequestId: 'sms-change', retryAfterSeconds: 60, expiresIn: 300 })
    expect(requests[0]).toMatchObject({
      url: `${BASE}/mio/client/v1/auth/sms/code`,
      method: 'POST',
      headers: { authorization: 'Bearer at-1' },
      body: { countryCode: '+86', scene: 'RESET_PASSWORD' },
    })
    expect(requests[0]?.body).not.toHaveProperty('mobile')

    replies.push(ok(null))
    await ctx.mioAccount.resetPassword({
      countryCode: '+86',
      mobile: '',
      smsRequestId: 'sms-change',
      smsCode: '654321',
      newPassword: 'newsecret123',
      authenticated: true,
    })
    expect(requests[1]).toMatchObject({
      url: `${BASE}/mio/client/v1/auth/password/reset`,
      method: 'POST',
      headers: { authorization: 'Bearer at-1' },
      body: { countryCode: '+86', mobile: '', smsRequestId: 'sms-change', smsCode: '654321', newPassword: 'newsecret123' },
    })
    expect(await ctx.mioAccount.getState()).toEqual(SIGNED_OUT)
  })

  function replySmsCode(): void {
    replies.push(ok({ smsRequestId: 'sms-1', retryAfterSeconds: 60, expiresIn: 300 }))
  }
})

describe('rejected credentials', () => {
  it('keeps the stored session when a tokenless login is rejected', async () => {
    const ctx = await signedIn()
    const expired = vi.fn()
    ctx.on('mio-account/session-expired', expired)
    replies.push({
      status: 401,
      body: { code: 401, msg: 'wrong password', data: null, errorCode: 'INVALID_CREDENTIALS', traceId: 'trace-1' },
    })

    await expect(ctx.mioAccount.loginWithPassword({
      countryCode: '+86',
      mobile: '13800000000',
      password: 'wrong-pass',
    })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', httpStatus: 401, traceId: 'trace-1' })
    expect((await ctx.mioAccount.getState()).status).toBe('signed-in')
    expect(expired).not.toHaveBeenCalled()
  })

  it('removes the session and announces expiry when a stored token is rejected', async () => {
    const ctx = await signedIn()
    const expired = vi.fn()
    ctx.on('mio-account/session-expired', expired)
    replies.push({ status: 401, body: { code: 401, msg: 'token expired', data: null } })

    await expect(ctx.mioAccount.getModels()).rejects.toMatchObject({ code: 'TOKEN_INVALID' })
    expect(expired).toHaveBeenCalledTimes(1)
    expect(await ctx.mioAccount.getState()).toEqual(SIGNED_OUT)
    expect(await ctx.credentials.readRecord(SESSION_KEY)).toBeUndefined()
  })

  it('treats a TOKEN_INVALID error code as expiry even without a 401 status', async () => {
    const ctx = await signedIn()
    replies.push({
      status: 403,
      body: { code: 403, msg: 'token revoked', data: null, errorCode: 'TOKEN_INVALID' },
    })

    await expect(ctx.mioAccount.getQuota()).rejects.toMatchObject({ code: 'TOKEN_INVALID', httpStatus: 403 })
    expect((await ctx.mioAccount.getState()).status).toBe('signed-out')
  })

  it('survives expiry when the stored record was already removed', async () => {
    const ctx = await signedIn()
    const expired = vi.fn()
    ctx.on('mio-account/session-expired', expired)
    replies.push({
      status: 401,
      body: { code: 401, msg: 'expired', data: null },
      before: async () => { await ctx.credentials.deleteRecord(SESSION_KEY) },
    })

    await expect(ctx.mioAccount.getModels()).rejects.toMatchObject({ code: 'TOKEN_INVALID' })
    expect(expired).toHaveBeenCalledTimes(1)
    expect(await ctx.credentials.readRecord(SESSION_KEY)).toBeUndefined()
  })
})

describe('logout', () => {
  it('revokes the server session and removes the local grant', async () => {
    const ctx = await signedIn()
    replies.push(ok(null))

    expect(await ctx.mioAccount.logout()).toEqual(SIGNED_OUT)
    expect(requests[0]).toMatchObject({ url: `${BASE}/mio/client/v1/auth/logout`, method: 'POST' })
    expect(requests[0]?.headers['authorization']).toBe('Bearer at-1')
    expect(await ctx.credentials.readRecord(SESSION_KEY)).toBeUndefined()
  })

  it('reports signed-out without a backend call when nothing is stored', async () => {
    const ctx = await boot()
    expect(await ctx.mioAccount.logout()).toEqual(SIGNED_OUT)
    expect(requests).toHaveLength(0)
  })

  it('still removes a session the backend has already rejected', async () => {
    const ctx = await signedIn()
    replies.push({ status: 401, body: { code: 401, msg: 'gone', data: null } })

    expect(await ctx.mioAccount.logout()).toEqual(SIGNED_OUT)
    expect(await ctx.credentials.readRecord(SESSION_KEY)).toBeUndefined()
  })

  it('still removes a session rejected without a JSON envelope', async () => {
    const ctx = await signedIn()
    replies.push({ status: 401, raw: 'token expired' })

    expect(await ctx.mioAccount.logout()).toEqual(SIGNED_OUT)
    expect(await ctx.credentials.readRecord(SESSION_KEY)).toBeUndefined()
  })

  it('keeps the session and reports other backend failures', async () => {
    const ctx = await signedIn()
    replies.push({ status: 500, body: { code: 500, msg: 'boom', data: null, errorCode: 'SERVER_ERROR' } })

    await expect(ctx.mioAccount.logout()).rejects.toMatchObject({ code: 'SERVER_ERROR' })
    expect((await ctx.mioAccount.getState()).status).toBe('signed-in')
  })
})

describe('stored session hygiene', () => {
  it('discards a malformed grant at startup', async () => {
    const ctx = await bootCredentials()
    await ctx.credentials.modifyRecord(SESSION_KEY, async () => ({ kind: 'grant', payload: { version: 9 } }))
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await ctx.plugin(MioAccountHttp, { businessBaseUrl: BASE })

    expect(await ctx.mioAccount.getState()).toEqual(SIGNED_OUT)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a valid grant'))
    expect(await ctx.credentials.readRecord(SESSION_KEY)).toBeUndefined()
  })

  it('discards a non-grant record at startup', async () => {
    const ctx = await bootCredentials()
    await ctx.credentials.modifyRecord(SESSION_KEY, async () => ({ kind: 'api-key', key: 'stray' }))
    vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await ctx.plugin(MioAccountHttp, { businessBaseUrl: BASE })

    expect(await ctx.mioAccount.getState()).toEqual(SIGNED_OUT)
    expect(await ctx.credentials.readRecord(SESSION_KEY)).toBeUndefined()
  })

  it('keeps a stored grant whose legacy expiry has passed', async () => {
    const ctx = await bootCredentials()
    await ctx.credentials.modifyRecord(SESSION_KEY, async () => ({
      kind: 'grant',
      payload: { version: 1, accessToken: 'at-old', expiresAt: Date.now() - 1, user: USER },
    }))
    const expired = vi.fn()
    ctx.on('mio-account/session-expired', expired)
    await ctx.plugin(MioAccountHttp, { businessBaseUrl: BASE })

    // Expiry belongs to the backend: a stored record's legacy field is ignored.
    expect(await ctx.mioAccount.getState()).toEqual({ status: 'signed-in', user: USER })
    expect(expired).not.toHaveBeenCalled()
    expect(await ctx.credentials.readRecord(SESSION_KEY)).toBeDefined()
  })

})

describe('account state stream', () => {
  it('replays the current state, then follows sign-in and cancellation', async () => {
    const ctx = await boot()
    const lifetime = new AbortController()
    const iterator = ctx.mioAccount.watch(lifetime.signal)[Symbol.asyncIterator]()

    expect(await iterator.next()).toEqual({ done: false, value: SIGNED_OUT })
    const next = iterator.next()
    replies.push(loginReply())
    const view = await ctx.mioAccount.loginWithPassword({
      countryCode: '+86',
      mobile: '13800000000',
      password: 'secret123',
    })
    let current = await next
    while (!current.done && current.value.status !== 'signed-in') current = await iterator.next()
    expect(current).toEqual({ done: false, value: view })

    lifetime.abort()
    for (;;) {
      const end = await iterator.next()
      if (end.done) break
    }
  })

  it('ends when the provider is disposed even before the reader aborts', async () => {
    const ctx = await boot()
    const lifetime = new AbortController()
    const iterator = ctx.mioAccount.watch(lifetime.signal)[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ done: false, value: SIGNED_OUT })
    const pending = iterator.next()
    await ctx.fiber.dispose()
    lifetime.abort()
    expect(await pending).toEqual({ done: true, value: undefined })
  })
})

describe('profile and provisioning status', () => {
  it('returns no profile without a session', async () => {
    const ctx = await boot()
    expect(await ctx.mioAccount.getProfile()).toBeNull()
  })

  it('refreshes and stores the display profile', async () => {
    const ctx = await signedIn()
    const changed = changedEvents(ctx)
    const updated = { ...USER, nickname: 'Renamed' }
    replies.push(ok(updated))

    expect(await ctx.mioAccount.getProfile()).toEqual(updated)
    expect(requests[0]?.url).toBe(`${BASE}/mio/client/v1/users/me`)
    expect(requests[0]?.headers['authorization']).toBe('Bearer at-1')
    expect(changed.length).toBeGreaterThan(0)
    expect((await ctx.mioAccount.getState()).user).toEqual(updated)
  })

  it('drops a profile read whose session was replaced in flight', async () => {
    const ctx = await signedIn()
    replies.push({
      ...ok({ ...USER, nickname: 'Stale' }),
      before: async () => {
        await ctx.credentials.modifyRecord(SESSION_KEY, async (current) => {
          if (current?.kind !== 'grant') return undefined
          return { kind: 'grant', payload: { ...(current.payload as object), accessToken: 'at-2' } }
        })
      },
    })

    expect(await ctx.mioAccount.getProfile()).toBeNull()
    expect((await ctx.mioAccount.getState()).user).toMatchObject({ nickname: USER.nickname })
  })

  it('drops a profile read whose session was removed in flight', async () => {
    const ctx = await signedIn()
    replies.push({
      ...ok({ ...USER, nickname: 'Stale' }),
      before: async () => { await ctx.credentials.deleteRecord(SESSION_KEY) },
    })

    expect(await ctx.mioAccount.getProfile()).toBeNull()
  })

  it('mirrors provisioning progress into the stored user without touching the token', async () => {
    const ctx = await signedIn()
    const changed = changedEvents(ctx)
    replies.push(ok({ status: 'READY', stage: 'done', credentialStatus: 'READY', retryable: false, retryAfterSeconds: 0 }))

    const status = await ctx.mioAccount.getAccountStatus()
    expect(status).toEqual({
      status: 'READY',
      stage: 'done',
      credentialStatus: 'READY',
      retryable: false,
      retryAfterSeconds: 0,
    })
    expect(requests[0]).toMatchObject({ url: `${BASE}/mio/client/v1/account/status`, method: 'GET' })
    expect(requests[0]?.headers['authorization']).toBe('Bearer at-1')
    const state = await ctx.mioAccount.getState()
    expect(state.user).toMatchObject({ accountStatus: 'READY', credentialStatus: 'READY', nickname: USER.nickname })
    const afterFirstRead = changed.length
    expect(afterFirstRead).toBeGreaterThan(0)
    const record = await ctx.credentials.readRecord(SESSION_KEY)
    expect(record?.kind === 'grant' ? record.payload : undefined).toMatchObject({ accessToken: 'at-1' })

    replies.push(ok({ status: 'READY', stage: 'done', credentialStatus: 'READY', retryable: false, retryAfterSeconds: 0 }))
    await ctx.mioAccount.getAccountStatus()
    expect(changed).toHaveLength(afterFirstRead)
  })

  it('skips a status write when the session changed in flight', async () => {
    const ctx = await signedIn()
    replies.push({
      ...ok({ status: 'READY', stage: 'done', credentialStatus: 'READY', retryable: false, retryAfterSeconds: 0 }),
      before: async () => { await ctx.credentials.deleteRecord(SESSION_KEY) },
    })

    expect((await ctx.mioAccount.getAccountStatus()).status).toBe('READY')
    expect(await ctx.credentials.readRecord(SESSION_KEY)).toBeUndefined()
  })

  it('asks the backend to retry provisioning', async () => {
    const ctx = await signedIn()
    const lifetime = new AbortController()
    replies.push(ok({ status: 'READY', stage: 'credential', credentialStatus: 'READY', retryable: true, retryAfterSeconds: 5 }))

    expect((await ctx.mioAccount.retryAccount(lifetime.signal)).retryable).toBe(true)
    expect(requests[0]).toMatchObject({ url: `${BASE}/mio/client/v1/account/retry`, method: 'POST' })
  })
})

describe('model catalog and access', () => {
  it('requires a session for account-scoped reads', async () => {
    const ctx = await boot()
    await expect(ctx.mioAccount.getModels()).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' })
    await expect(ctx.mioAccount.getQuota()).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' })
    await expect(ctx.mioAccount.getModelAccess()).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' })
    expect(requests).toHaveLength(0)
  })

  it('reads the model directory with the stored token', async () => {
    const ctx = await signedIn()
    const catalog = {
      items: [{
        modelId: 'model-a',
        displayName: 'Model A',
        providerName: 'mio',
        modelType: 'LANGUAGE',
        requestTimeoutMs: 30_000,
        isDefault: true,
        parameters: {},
      }],
      fetchedAt: '2026-10-20T00:00:00Z',
      stale: false,
    }
    replies.push(ok(catalog))

    expect(await ctx.mioAccount.getModels()).toEqual(catalog)
    expect(requests[0]).toMatchObject({ url: `${BASE}/mio/client/v1/models`, method: 'GET' })
    expect(requests[0]?.headers['authorization']).toBe('Bearer at-1')
  })

  it('reads plans, purchases one, polls its order, and lists subscriptions', async () => {
    const ctx = await signedIn()
    const plan = {
      planId: 1, planName: 'Monthly', planType: 'MONTHLY', planContent: 'Everyday use', quota: 1000,
      maxPurchasePerUser: 1, price: 19, currency: 'CNY', durationUnit: 'MONTH', durationValue: 1,
      customSeconds: 0, quotaResetPeriod: 'MONTHLY', quotaResetCustomSeconds: 0,
    }
    const purchase = {
      orderNo: 'ord-1', paymentStatus: 'PENDING', paymentChannel: 'WECHAT', paymentScene: 'NATIVE',
      codeUrl: 'weixin://wxpay/bizpayurl?pr=test', expireTime: '2026-10-21 12:00:00',
      grantStatus: 'PENDING', subscriptionId: null,
    }
    const order = { ...purchase, subscriptionId: 7 }
    const subscription = {
      subscriptionId: 7, planId: 1, planName: 'Monthly', amountTotal: 1000, amountUsed: 120,
      startTime: '2026-10-21 12:00:00', endTime: '2026-11-21 12:00:00', status: 'active',
      lastResetTime: null, nextResetTime: '2026-11-21 12:00:00', allowWalletOverflow: false,
    }

    replies.push(ok([plan]))
    expect(await ctx.mioAccount.getPlans()).toEqual([plan])
    expect(requests[0]).toMatchObject({ url: `${BASE}/mio/client/v1/plans`, method: 'GET' })
    expect(requests[0]?.headers['authorization']).toBe('Bearer at-1')

    replies.push(ok(purchase))
    expect(await ctx.mioAccount.purchasePlan({ planId: 1, requestId: 'req-1' })).toEqual(purchase)
    expect(requests[1]).toMatchObject({
      url: `${BASE}/mio/client/v1/plans/1/purchase`,
      method: 'POST',
      body: { requestId: 'req-1' },
    })

    replies.push(ok(order))
    expect(await ctx.mioAccount.getOrder('ord-1')).toEqual(order)
    expect(requests[2]).toMatchObject({ url: `${BASE}/mio/client/v1/orders/ord-1`, method: 'GET' })

    replies.push(ok({ items: [subscription], realtime: false }))
    expect(await ctx.mioAccount.getSubscriptions()).toEqual({ items: [subscription], realtime: false })
    expect(requests[3]).toMatchObject({ url: `${BASE}/mio/client/v1/subscriptions`, method: 'GET' })
    expect(requests[3]?.headers['authorization']).toBe('Bearer at-1')
  })

  it('normalizes model metadata the directory omits', async () => {
    const ctx = await signedIn()
    replies.push(ok({
      items: [
        { modelId: 'model-a', modelType: 'LANGUAGE' },
        {
          modelId: 'embed-1', modelType: 'EMBEDDING', displayName: null, providerName: null,
          requestTimeoutMs: null, isDefault: null, parameters: null,
        },
      ],
      fetchedAt: '2026-10-20T00:00:00Z',
      stale: false,
    }))

    expect(await ctx.mioAccount.getModels()).toEqual({
      items: [
        {
          modelId: 'model-a', displayName: '', providerName: '', modelType: 'LANGUAGE',
          requestTimeoutMs: 0, isDefault: false, parameters: {},
        },
        {
          modelId: 'embed-1', displayName: '', providerName: '', modelType: 'EMBEDDING',
          requestTimeoutMs: 0, isDefault: false, parameters: {},
        },
      ],
      fetchedAt: '2026-10-20T00:00:00Z',
      stale: false,
    })
  })

  it('caches model access per token, re-reads after expiry, and invalidates on demand', async () => {
    const ctx = await signedIn({ modelAccessTtlMs: 1_000 })
    const changed = changedEvents(ctx)
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const first = access('sk-1', '2030-01-01T00:00:00Z')
    replies.push(ok(first))
    expect(await ctx.mioAccount.getModelAccess()).toEqual(first)
    expect(await ctx.mioAccount.getModelAccess()).toEqual(first)
    expect(requests).toHaveLength(1)

    now += 1_001
    const second = access('sk-2', '2030-01-01T00:00:00Z')
    replies.push(ok(second))
    expect(await ctx.mioAccount.getModelAccess()).toEqual(second)
    expect(requests).toHaveLength(2)

    ctx.mioAccount.invalidateModelAccess()
    expect(changed).toHaveLength(1)
    const third = access('sk-3', 'not-a-date')
    replies.push(ok(third))
    expect(await ctx.mioAccount.getModelAccess()).toEqual(third)
    expect(requests).toHaveLength(3)

    ctx.mioAccount.invalidateModelAccess()
    const fourth = access('sk-4', '1970-01-01 00:00:00')
    replies.push(ok(fourth))
    expect(await ctx.mioAccount.getModelAccess()).toEqual(fourth)
    expect(requests).toHaveLength(4)
    expect(requests[3]).toMatchObject({ url: `${BASE}/mio/client/v1/models/config`, method: 'POST' })
    expect(requests[3]?.headers['authorization']).toBe('Bearer at-1')
  })

  it('resolves a fresh key after the access token changes', async () => {
    const ctx = await signedIn()
    replies.push(ok(access('sk-1', '2030-01-01T00:00:00Z')))
    await ctx.mioAccount.getModelAccess()
    replies.push(loginReply({ token: 'at-2' }))
    await ctx.mioAccount.loginWithPassword({ countryCode: '+86', mobile: '13800000000', password: 'secret123' })
    replies.push(ok(access('sk-2', '2030-01-01T00:00:00Z')))

    expect((await ctx.mioAccount.getModelAccess()).apiKey).toBe('sk-2')
    expect(requests.at(-1)?.headers['authorization']).toBe('Bearer at-2')
  })

  it('drops cached model access when the stored record changes externally', async () => {
    const ctx = await signedIn()
    replies.push(ok(access('sk-1', '2030-01-01T00:00:00Z')))
    await ctx.mioAccount.getModelAccess()
    await ctx.credentials.modifyRecord(SESSION_KEY, async (current) => {
      if (current?.kind !== 'grant') return undefined
      return { kind: 'grant', payload: { ...(current.payload as object), accessToken: 'at-2' } }
    })
    replies.push(ok(access('sk-2', '2030-01-01T00:00:00Z')))

    expect((await ctx.mioAccount.getModelAccess()).apiKey).toBe('sk-2')
  })

  it('ignores credential updates for other records', async () => {
    const ctx = await signedIn()
    const changed = changedEvents(ctx)
    replies.push(ok(access('sk-1', '2030-01-01T00:00:00Z')))
    await ctx.mioAccount.getModelAccess()
    requests.length = 0

    ctx.emit('credentials/record-updated', credentialKey('other', 'session'))

    expect(changed).toHaveLength(0)
    expect((await ctx.mioAccount.getModelAccess()).apiKey).toBe('sk-1')
    expect(requests).toHaveLength(0)
  })

  it('reads quota and public agreements', async () => {
    const ctx = await signedIn()
    const quota = { remainingQuota: 10, usedQuota: 5, unit: 'USD', fetchedAt: '2026-10-20T00:00:00Z' }
    replies.push(ok(quota))
    expect(await ctx.mioAccount.getQuota()).toEqual(quota)
    const agreements = [
      { agreementType: 'USER', title: 'User agreement', content: 'text', version: '1', updatedAt: '2026-10-20T00:00:00Z' },
      { agreementType: 'PRIVACY', content: 'privacy' },
    ]
    replies.push(ok(agreements))
    const lifetime = new AbortController()
    expect(await ctx.mioAccount.getAgreements(lifetime.signal)).toEqual(agreements)
    expect(requests[1]).toMatchObject({ url: `${BASE}/mio/client/v1/agreements`, method: 'GET' })
    expect(requests[1]?.headers['authorization']).toBeUndefined()
  })
})

describe('caller cancellation', () => {
  it('accepts a signal on every operation', async () => {
    const ctx = await signedIn()
    const signal = new AbortController().signal
    const status = { status: 'READY', stage: 'done', credentialStatus: 'READY', retryable: false, retryAfterSeconds: 0 }
    const quota = { remainingQuota: 10, usedQuota: 5, unit: 'USD', fetchedAt: '2026-10-20T00:00:00Z' }

    replies.push(ok({ smsRequestId: 'sms-1', retryAfterSeconds: 0, expiresIn: 60 }))
    await ctx.mioAccount.sendSmsCode({ countryCode: '+86', mobile: '13800000000', scene: 'LOGIN' }, signal)
    replies.push(loginReply({ token: 'at-2' }))
    await ctx.mioAccount.register({
      countryCode: '+86', mobile: '13800000000', password: 'secret123', nickname: 'Tester',
    }, signal)
    replies.push(loginReply({ token: 'at-3' }))
    await ctx.mioAccount.loginWithPassword({ countryCode: '+86', mobile: '13800000000', password: 'secret123' }, signal)
    replies.push(loginReply({ token: 'at-4' }))
    await ctx.mioAccount.loginWithSms({
      countryCode: '+86', mobile: '13800000000', smsRequestId: 'sms-1', smsCode: '123456',
    }, signal)
    replies.push(ok(USER))
    await ctx.mioAccount.getProfile(signal)
    replies.push(ok(status))
    await ctx.mioAccount.getAccountStatus(signal)
    replies.push(ok(status))
    await ctx.mioAccount.retryAccount()
    replies.push(ok({ items: [], fetchedAt: '2026-10-20T00:00:00Z', stale: false }))
    await ctx.mioAccount.getModels(signal)
    replies.push(ok(access('sk-1', '2030-01-01T00:00:00Z')))
    await ctx.mioAccount.getModelAccess(signal)
    replies.push(ok(quota))
    await ctx.mioAccount.getQuota(signal)
    replies.push(ok([]))
    await ctx.mioAccount.getAgreements()
    replies.push(ok(null))
    await ctx.mioAccount.logout(signal)
    replies.push(ok(null))
    await ctx.mioAccount.resetPassword({
      countryCode: '+86', mobile: '13800000000', smsRequestId: 'sms-1', smsCode: '123456', newPassword: 'newsecret123',
    }, signal)

    expect(requests).toHaveLength(13)
  })
})

describe('provider reload', () => {
  it('stops publishing state from a retired provider instance', async () => {
    const { ctx, fiber, account } = await bootControlled()
    replies.push(loginReply())
    await account.loginWithPassword({ countryCode: '+86', mobile: '13800000000', password: 'secret123' })
    requests.length = 0
    let changed = 0
    let expired = 0
    ctx.on('mio-account/changed', () => { changed += 1 })
    ctx.on('mio-account/session-expired', () => { expired += 1 })

    await fiber.restart()

    account.invalidateModelAccess()
    expect(changed).toBe(0)

    replies.push({ status: 401, body: { code: 401, msg: 'expired', data: null } })
    await expect(account.getModelAccess()).rejects.toMatchObject({ code: 'TOKEN_INVALID' })
    expect(expired).toBe(0)

    replies.push(loginReply({ token: 'at-2' }))
    await account.loginWithPassword({ countryCode: '+86', mobile: '13800000000', password: 'secret123' })
    // Expiry belongs to the backend; the retired instance publishes neither state nor expiry notifications.
    expect(await account.getState()).toEqual({ status: 'signed-in', user: USER })
    expect(expired).toBe(0)
  })
})

function access(apiKey: string, expiresAt: string): Record<string, unknown> {
  return { baseUrl: 'http://model.test/v1', apiKey, credentialVersion: 7, expiresAt }
}
