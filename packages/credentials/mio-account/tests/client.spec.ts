/** Envelope, deadline, and failure behavior of the raw mioagent HTTP client. */
/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { MioClient } from '../src/client.ts'
import { MioAccountError, mioAccountErrorOf } from '../src/error.ts'

const DATA = z.object({ value: z.string() })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function client(options: { timeoutMs?: number; onUnauthorized?: () => Promise<void>; baseUrl?: string } = {}): MioClient {
  return new MioClient({
    baseUrl: options.baseUrl ?? 'http://mio.test',
    timeoutMs: options.timeoutMs ?? 1_000,
    onUnauthorized: options.onUnauthorized ?? (() => Promise.resolve()),
  })
}

function respond(reply: { status?: number; body?: string }): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(reply.body ?? '', { status: reply.status ?? 200 })))
}

function waitForAbort(): typeof fetch {
  return vi.fn((_input: string | URL | Request, init: RequestInit = {}) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- propagate the caller's exact cancellation reason.
      reject(init.signal?.reason ?? new DOMException('aborted', 'AbortError'))
    }, { once: true })
  }))
}

it('returns validated data from a successful envelope', async () => {
  respond({ body: JSON.stringify({ code: 200, msg: '', data: { value: 'ok' }, traceId: 'trace-1' }) })
  expect(await client().request('/thing', DATA)).toEqual({ value: 'ok' })
})

it('reports a non-JSON response as a protocol failure', async () => {
  respond({ status: 502, body: '<html>bad gateway</html>' })
  await expect(client().request('/thing', DATA)).rejects.toMatchObject({ code: 'PROTOCOL', httpStatus: 502 })
})

it('reports a malformed envelope as a protocol failure', async () => {
  respond({ body: JSON.stringify({ code: '200', data: {} }) })
  await expect(client().request('/thing', DATA)).rejects.toMatchObject({ code: 'PROTOCOL' })
})

it('reports invalid response data with the backend trace id', async () => {
  respond({ body: JSON.stringify({ code: 200, msg: '', data: { value: 1 }, traceId: 'trace-2' }) })
  await expect(client().request('/thing', DATA)).rejects.toMatchObject({ code: 'PROTOCOL', traceId: 'trace-2' })
  await expect(client().request('/thing', DATA)).rejects.toThrow(/value: invalid_type/u)
})

it('reports invalid response data without inventing a trace id', async () => {
  respond({ body: JSON.stringify({ code: 200, msg: '', data: { value: 1 } }) })
  const failure: unknown = await client().request('/thing', DATA).catch((error: unknown) => error)
  expect(failure).toMatchObject({ code: 'PROTOCOL' })
  expect((failure as MioAccountError).traceId).toBeUndefined()
})

it('identifies its own failures and nothing else', () => {
  const failure = new MioAccountError('NETWORK', 'offline')
  expect(mioAccountErrorOf(failure)).toBe(failure)
  expect(mioAccountErrorOf(new Error('offline'))).toBeUndefined()
  expect(mioAccountErrorOf(undefined)).toBeUndefined()
})

it('prefers the backend errorCode and message', async () => {
  respond({
    status: 409,
    body: JSON.stringify({ code: 409, msg: 'mobile already registered', data: null, errorCode: 'MOBILE_TAKEN', traceId: 'trace-3' }),
  })
  await expect(client().request('/thing', DATA)).rejects.toMatchObject({
    code: 'MOBILE_TAKEN',
    message: 'mobile already registered',
    httpStatus: 409,
    traceId: 'trace-3',
  })
})

it('falls back to an HTTP failure code and message', async () => {
  respond({ status: 500, body: JSON.stringify({ code: 500, msg: '', data: null }) })
  await expect(client().request('/thing', DATA)).rejects.toMatchObject({
    code: 'HTTP_500',
    message: 'mioagent request failed (HTTP 500)',
  })
})

it('treats an envelope code 401 as a rejected token and notifies its owner', async () => {
  const unauthorized = vi.fn(async () => {})
  respond({ body: JSON.stringify({ code: 401, msg: 'expired', data: null }) })
  await expect(client({ onUnauthorized: unauthorized }).request('/thing', DATA, { token: 'at-1' }))
    .rejects.toMatchObject({ code: 'TOKEN_INVALID' })
  expect(unauthorized).toHaveBeenCalledTimes(1)
})

it('does not notify its owner for a tokenless rejection', async () => {
  const unauthorized = vi.fn(async () => {})
  respond({ status: 401, body: JSON.stringify({ code: 401, msg: 'wrong password', data: null }) })
  await expect(client({ onUnauthorized: unauthorized }).request('/login', DATA))
    .rejects.toMatchObject({ code: 'TOKEN_INVALID' })
  expect(unauthorized).not.toHaveBeenCalled()
})

it('times out a request that never answers', async () => {
  vi.stubGlobal('fetch', waitForAbort())
  await expect(client({ timeoutMs: 5 }).request('/thing', DATA)).rejects.toMatchObject({ code: 'TIMEOUT' })
})

it('propagates caller cancellation instead of reporting a timeout', async () => {
  vi.stubGlobal('fetch', waitForAbort())
  const lifetime = new AbortController()
  const reason = new Error('caller moved on')
  const pending = client().request('/thing', DATA, { signal: lifetime.signal })
  lifetime.abort(reason)
  await expect(pending).rejects.toBe(reason)
})

it('reports a transport failure before any response', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
  await expect(client().request('/thing', DATA)).rejects.toBeInstanceOf(MioAccountError)
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
  await expect(client().request('/thing', DATA)).rejects.toMatchObject({ code: 'NETWORK' })
})

it('sends the documented prefix, bearer token, and JSON body', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ code: 200, msg: '', data: { value: 'ok' } })))
  vi.stubGlobal('fetch', fetch)
  await client().request('/thing', DATA, { method: 'POST', body: { mobile: '1' }, token: 'at-1' })
  expect(fetch).toHaveBeenCalledExactlyOnceWith('http://mio.test/mio/client/v1/thing', expect.objectContaining({
    method: 'POST',
    body: '{"mobile":"1"}',
    headers: expect.objectContaining({ authorization: 'Bearer at-1', 'content-type': 'application/json' }),
  }))
})

it('appends the API prefix after a deployment path prefix', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ code: 200, msg: '', data: { value: 'ok' } })))
  vi.stubGlobal('fetch', fetch)
  const deployments = {
    'https://mioagent.dev.zrshuiwu.com/prod-api': 'https://mioagent.dev.zrshuiwu.com/prod-api/mio/client/v1/auth/login/password',
    'https://mioagent.zrshuiwu.com/prod-api': 'https://mioagent.zrshuiwu.com/prod-api/mio/client/v1/auth/login/password',
  }
  for (const [baseUrl, expected] of Object.entries(deployments)) {
    await client({ baseUrl }).request('/auth/login/password', DATA, { method: 'POST', body: {} })
    expect(fetch).toHaveBeenLastCalledWith(expected, expect.objectContaining({ method: 'POST' }))
  }
})
