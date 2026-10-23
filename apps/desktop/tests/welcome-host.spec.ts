/** Native welcome reuses authenticated Web RPC for mioagent login and never reads credential values. */
import { describe, expect, it, vi } from 'vitest'
import type { MioAccountView } from '@deepseek-ai/dsh-mio-account/types'
import { connectDesktopWelcome } from '../src/welcome-backend.ts'

const signedOut: MioAccountView = { status: 'signed-out', user: null }
const signedIn: MioAccountView = { status: 'signed-in', user: null }

function transport(options: { locale?: string; state?: MioAccountView; failState?: boolean } = {}) {
  const calls: { method: string; args: Record<string, unknown> }[] = []
  const send = vi.fn<Parameters<typeof connectDesktopWelcome>[1]>(async (_input, init) => {
    if (init?.method !== 'POST') return new Response('index')
    const { rpcId, method, payload } = JSON.parse(init.body as string) as {
      rpcId: string
      method: string
      payload: { args: Record<string, unknown> }
    }
    calls.push({ method, args: payload.args })
    let value: unknown
    if (method === 'mioAccount/getState') {
      if (options.failState === true) return new Response('', { status: 500 })
      value = options.state ?? signedOut
    } else if (method === 'mioAccount/sendSmsCode') {
      value = { smsRequestId: 'sms-1', retryAfterSeconds: 60, expiresIn: 300 }
    } else if (method === 'mioAccount/loginWithSms' || method === 'mioAccount/loginWithPassword') {
      value = signedIn
    } else if (method === 'mioAccount/resetPassword') {
      value = undefined
    } else if (method === 'mioAccount/getAgreements') {
      value = [{ agreementType: 'USER', content: '<p>agreement</p>' }]
    } else if (method === 'settings/describe') {
      value = { namespaces: [{ ns: 'locale', value: options.locale === undefined ? {} : { preference: options.locale } }] }
    } else if (method === 'productAnalytics/enabled') {
      value = true
    } else if (method === 'productAnalytics/report') {
      value = undefined
    } else {
      throw new Error(`unexpected RPC ${method}`)
    }
    return Response.json({ type: 'server-response', rpcId, result: { ok: true, value } })
  })
  return { send, calls }
}

const url = 'http://127.0.0.1:19387/?token=fixture'

describe('desktop welcome Web operations', () => {
  it('authenticates through Web and reports the stored login state', async () => {
    const host = transport()
    const backend = await connectDesktopWelcome(url, host.send)
    expect(host.send).toHaveBeenCalledExactlyOnceWith(url, { credentials: 'include' })
    expect(await backend.analyticsEnabled()).toBe(true)
    expect(await backend.read()).toEqual({ loggedIn: false, localePreference: null })
    for (const [input, init] of host.send.mock.calls.slice(1)) {
      expect(input).toMatch(/^http:\/\/127\.0\.0\.1:19387\/api\//u)
      expect(init).toMatchObject({ credentials: 'include', redirect: 'error' })
    }
  })

  it('recognizes a signed-in account and the explicit language preference', async () => {
    const host = transport({ locale: 'zh', state: signedIn })
    const backend = await connectDesktopWelcome(url, host.send)
    expect(await backend.read()).toEqual({ loggedIn: true, localePreference: 'zh' })
    expect(host.calls.map(call => call.method)).toEqual(['mioAccount/getState', 'settings/describe'])
  })

  it('reads language without querying the account', async () => {
    const host = transport({ locale: 'zh' })
    const backend = await connectDesktopWelcome(url, host.send)
    expect(await backend.readLocalePreference()).toBe('zh')
    expect(host.calls.map(call => call.method)).toEqual(['settings/describe'])
  })

  it('treats an unavailable account Remote as signed out', async () => {
    const host = transport({ failState: true })
    const backend = await connectDesktopWelcome(url, host.send)
    expect(await backend.read()).toEqual({ loggedIn: false, localePreference: null })
  })

  it('forwards every mioagent operation to its Remote method', async () => {
    const host = transport()
    const backend = await connectDesktopWelcome(url, host.send)
    const smsRequest = { countryCode: '+86', mobile: '13800138000', scene: 'LOGIN' as const }
    expect(await backend.sendSmsCode(smsRequest)).toEqual({ smsRequestId: 'sms-1', retryAfterSeconds: 60, expiresIn: 300 })
    const smsLogin = { countryCode: '+86', mobile: '13800138000', smsRequestId: 'sms-1', smsCode: '123456' }
    expect(await backend.loginWithSms(smsLogin)).toEqual(signedIn)
    const passwordLogin = { countryCode: '+86', mobile: '13800138000', password: 'secret123' }
    expect(await backend.loginWithPassword(passwordLogin)).toEqual(signedIn)
    const resetRequest = {
      countryCode: '+86', mobile: '13800138000', smsRequestId: 'sms-1', smsCode: '123456', newPassword: 'newsecret',
    }
    await backend.resetPassword(resetRequest)
    expect(await backend.getAgreements()).toEqual([{ agreementType: 'USER', content: '<p>agreement</p>' }])
    expect(host.calls.map(call => call.method)).toEqual([
      'mioAccount/sendSmsCode', 'mioAccount/loginWithSms', 'mioAccount/loginWithPassword',
      'mioAccount/resetPassword', 'mioAccount/getAgreements',
    ])
    expect(host.calls.map(call => call.args)).toEqual([
      { request: smsRequest }, { request: smsLogin }, { request: passwordLogin }, { request: resetRequest }, {},
    ])
  })
})
