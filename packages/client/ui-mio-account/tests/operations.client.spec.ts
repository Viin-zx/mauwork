import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  accountMessage, createMioAccountOperations, MioAccountClientError,
} from '../src/client/operations.ts'
import { AGREEMENTS, SIGNED_IN, SIGNED_OUT, SMS } from './harness.client.ts'

function fixture(overrides: Partial<Record<'sendSmsCode' | 'loginWithSms' | 'loginWithPassword' | 'resetPassword' | 'getAgreements' | 'logout', () => Promise<unknown>>> = {}) {
  const namespace = {
    sendSmsCode: vi.fn(async () => ({ ok: true as const, value: SMS })),
    loginWithSms: vi.fn(async () => ({ ok: true as const, value: SIGNED_IN })),
    loginWithPassword: vi.fn(async () => ({ ok: true as const, value: SIGNED_IN })),
    resetPassword: vi.fn(async () => ({ ok: true as const, value: undefined })),
    getAgreements: vi.fn(async () => ({ ok: true as const, value: AGREEMENTS })),
    logout: vi.fn(async () => ({ ok: true as const, value: SIGNED_OUT })),
    ...overrides,
  }
  const ctx = new Context()
  ctx.provide('remote', { mioAccount: namespace } as never)
  return { operations: createMioAccountOperations(ctx), namespace }
}

describe('account operations', () => {
  it('unwraps every Remote success and passes its request through', async () => {
    const { operations, namespace } = fixture()
    const smsRequest = { countryCode: '+86', mobile: '13800000000', scene: 'LOGIN' } as const
    const smsLogin = { countryCode: '+86', mobile: '13800000000', smsRequestId: 'sms-1', smsCode: '123456' }
    const passwordLogin = { countryCode: '+86', mobile: '13800000000', password: 'secret123' }
    const reset = {
      countryCode: '+86', mobile: '13800000000', smsRequestId: 'sms-1', smsCode: '123456', newPassword: 'newsecret123',
    }

    expect(await operations.sendSmsCode(smsRequest)).toBe(SMS)
    expect(await operations.loginWithSms(smsLogin)).toBe(SIGNED_IN)
    expect(await operations.loginWithPassword(passwordLogin)).toBe(SIGNED_IN)
    await expect(operations.resetPassword(reset)).resolves.toBeUndefined()
    expect(await operations.getAgreements()).toBe(AGREEMENTS)
    expect(await operations.logout()).toBe(SIGNED_OUT)
    expect(namespace.sendSmsCode).toHaveBeenCalledExactlyOnceWith(smsRequest)
    expect(namespace.loginWithSms).toHaveBeenCalledExactlyOnceWith(smsLogin)
    expect(namespace.loginWithPassword).toHaveBeenCalledExactlyOnceWith(passwordLogin)
    expect(namespace.resetPassword).toHaveBeenCalledExactlyOnceWith(reset)
    expect(namespace.getAgreements).toHaveBeenCalledTimes(1)
    expect(namespace.logout).toHaveBeenCalledTimes(1)
  })

  it('keeps the backend error code for branching', async () => {
    const { operations } = fixture({
      sendSmsCode: async () => ({
        ok: false as const,
        error: new RemoteError('mio-account/failure', 'code expired', { code: 'SMS_CODE_INVALID' }),
      }),
    })
    const failure = await operations.sendSmsCode({
      countryCode: '+86', mobile: '13800000000', scene: 'LOGIN',
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(MioAccountClientError)
    expect(failure).toMatchObject({ name: 'MioAccountClientError', code: 'SMS_CODE_INVALID', message: 'code expired' })
  })

  it('keeps a Remote carrier code when the Host did not classify the failure', async () => {
    const { operations } = fixture({
      getAgreements: async () => ({
        ok: false as const,
        error: new RemoteError('gateway/internal', 'offline', {}),
      }),
    })
    await expect(operations.getAgreements()).rejects.toMatchObject({
      name: 'MioAccountClientError', code: 'gateway/internal', message: 'offline',
    })
  })

  it('prefers the error message and falls back to localized copy', () => {
    expect(accountMessage(new Error('backend copy'), 'fallback')).toBe('backend copy')
    expect(accountMessage(new Error(''), 'fallback')).toBe('fallback')
    expect(accountMessage('offline', 'fallback')).toBe('fallback')
  })
})
