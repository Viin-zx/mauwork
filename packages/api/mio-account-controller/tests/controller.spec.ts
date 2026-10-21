/** Remote delegation and the reconnect-safe expiry stream of the mioagent account controller. */
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { MioAccount } from '@deepseek-ai/dsh-mio-account'
import { MioAccountError } from '@deepseek-ai/dsh-mio-account'
import type {
  MioAccountStatusView, MioAccountView, MioAgreement, MioModelCatalogView, MioOrderStatus, MioPlan,
  MioPurchaseResult, MioQuotaView, MioSmsCode, MioSubscriptionsView, MioUser,
} from '@deepseek-ai/dsh-mio-account/types'
import MioAccountController from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

const USER: MioUser = {
  userId: 'account' as MioUser['userId'],
  maskedPhone: '138****0000',
  nickname: 'Tester',
  accountStatus: 'READY',
  credentialStatus: 'READY',
}
const state: MioAccountView = { status: 'signed-in', user: USER, expiresAt: 1_800_000_000_000 }
const sms: MioSmsCode = { smsRequestId: 'sms-1', retryAfterSeconds: 60, expiresIn: 300 }
const status: MioAccountStatusView = {
  status: 'READY', stage: 'done', credentialStatus: 'READY', retryable: false, retryAfterSeconds: 0,
}
const catalog: MioModelCatalogView = { items: [], fetchedAt: '2026-10-20T00:00:00Z', stale: false }
const quota: MioQuotaView = { remainingQuota: 10, usedQuota: 5, unit: 'USD', fetchedAt: '2026-10-20T00:00:00Z' }
const agreements: readonly MioAgreement[] = [{ agreementType: 'USER', content: 'text' }]
const plans: readonly MioPlan[] = [{
  planId: 1, planName: 'Monthly', planType: 'MONTHLY', planContent: 'Everyday use', quota: 1000,
  maxPurchasePerUser: 1, price: 19, currency: 'CNY', durationUnit: 'MONTH', durationValue: 1,
  customSeconds: 0, quotaResetPeriod: 'MONTHLY', quotaResetCustomSeconds: 0,
}]
const purchase: MioPurchaseResult = {
  orderNo: 'ord-1', paymentStatus: 'PENDING', paymentChannel: 'WECHAT', paymentScene: 'NATIVE',
  codeUrl: 'weixin://wxpay/bizpayurl?pr=test', expireTime: '2026-10-21 12:00:00', grantStatus: 'PENDING',
  subscriptionId: null,
}
const order: MioOrderStatus = { ...purchase, subscriptionId: 7 }
const subscriptions: MioSubscriptionsView = { items: [], realtime: true }

function fixture() {
  const ctx = new Context()
  roots.push(ctx)
  const provider = {
    getState: vi.fn<MioAccount['getState']>().mockResolvedValue(state),
    watch: vi.fn<MioAccount['watch']>(),
    sendSmsCode: vi.fn<MioAccount['sendSmsCode']>().mockResolvedValue(sms),
    register: vi.fn<MioAccount['register']>().mockResolvedValue(state),
    loginWithPassword: vi.fn<MioAccount['loginWithPassword']>().mockResolvedValue(state),
    loginWithSms: vi.fn<MioAccount['loginWithSms']>().mockResolvedValue(state),
    resetPassword: vi.fn<MioAccount['resetPassword']>().mockResolvedValue(undefined),
    logout: vi.fn<MioAccount['logout']>().mockResolvedValue({ status: 'signed-out', user: null, expiresAt: null }),
    getProfile: vi.fn<MioAccount['getProfile']>().mockResolvedValue(USER),
    getAccountStatus: vi.fn<MioAccount['getAccountStatus']>().mockResolvedValue(status),
    retryAccount: vi.fn<MioAccount['retryAccount']>().mockResolvedValue(status),
    getModels: vi.fn<MioAccount['getModels']>().mockResolvedValue(catalog),
    getModelAccess: vi.fn<MioAccount['getModelAccess']>(),
    invalidateModelAccess: vi.fn<MioAccount['invalidateModelAccess']>(),
    getQuota: vi.fn<MioAccount['getQuota']>().mockResolvedValue(quota),
    getAgreements: vi.fn<MioAccount['getAgreements']>().mockResolvedValue(agreements),
    getPlans: vi.fn<MioAccount['getPlans']>().mockResolvedValue(plans),
    purchasePlan: vi.fn<MioAccount['purchasePlan']>().mockResolvedValue(purchase),
    getOrder: vi.fn<MioAccount['getOrder']>().mockResolvedValue(order),
    getSubscriptions: vi.fn<MioAccount['getSubscriptions']>().mockResolvedValue(subscriptions),
  }
  ctx.provide('mioAccount', provider as never)
  return { ctx, provider, controller: new MioAccountController(ctx) }
}

it('delegates every account operation without altering its result', async () => {
  const { provider, controller } = fixture()
  const smsRequest = { countryCode: '+86', mobile: '13800000000', scene: 'REGISTER' } as const
  const registerRequest = { countryCode: '+86', mobile: '13800000000', password: 'secret123', nickname: 'Tester' }
  const passwordRequest = { countryCode: '+86', mobile: '13800000000', password: 'secret123' }
  const smsLoginRequest = { countryCode: '+86', mobile: '13800000000', smsRequestId: 'sms-1', smsCode: '123456' }
  const resetRequest = {
    countryCode: '+86', mobile: '13800000000', smsRequestId: 'sms-reset', smsCode: '654321', newPassword: 'newsecret123',
  }
  const purchaseRequest = { planId: 1, requestId: 'req-1', paymentChannel: 'WECHAT' }

  expect(await controller.getState()).toBe(state)
  expect(await controller.getProfile()).toBe(USER)
  expect(await controller.sendSmsCode(smsRequest)).toBe(sms)
  expect(await controller.register(registerRequest)).toBe(state)
  expect(await controller.loginWithPassword(passwordRequest)).toBe(state)
  expect(await controller.loginWithSms(smsLoginRequest)).toBe(state)
  await expect(controller.resetPassword(resetRequest)).resolves.toBeUndefined()
  expect(await controller.logout()).toEqual({ status: 'signed-out', user: null, expiresAt: null })
  expect(await controller.getAccountStatus()).toBe(status)
  expect(await controller.retryAccount()).toBe(status)
  expect(await controller.getModels()).toBe(catalog)
  expect(await controller.getQuota()).toBe(quota)
  expect(await controller.getAgreements()).toBe(agreements)
  expect(await controller.getPlans()).toBe(plans)
  expect(await controller.purchasePlan(purchaseRequest)).toBe(purchase)
  expect(await controller.getOrder('ord-1')).toBe(order)
  expect(await controller.getSubscriptions()).toBe(subscriptions)

  expect(provider.sendSmsCode).toHaveBeenCalledExactlyOnceWith(smsRequest)
  expect(provider.register).toHaveBeenCalledExactlyOnceWith(registerRequest)
  expect(provider.loginWithPassword).toHaveBeenCalledExactlyOnceWith(passwordRequest)
  expect(provider.loginWithSms).toHaveBeenCalledExactlyOnceWith(smsLoginRequest)
  expect(provider.resetPassword).toHaveBeenCalledExactlyOnceWith(resetRequest)
  expect(provider.getProfile).toHaveBeenCalledExactlyOnceWith()
  expect(provider.getAccountStatus).toHaveBeenCalledExactlyOnceWith()
  expect(provider.retryAccount).toHaveBeenCalledExactlyOnceWith()
  expect(provider.getModels).toHaveBeenCalledExactlyOnceWith()
  expect(provider.getQuota).toHaveBeenCalledExactlyOnceWith()
  expect(provider.getAgreements).toHaveBeenCalledExactlyOnceWith()
  expect(provider.getPlans).toHaveBeenCalledExactlyOnceWith()
  expect(provider.purchasePlan).toHaveBeenCalledExactlyOnceWith(purchaseRequest)
  expect(provider.getOrder).toHaveBeenCalledExactlyOnceWith('ord-1')
  expect(provider.getSubscriptions).toHaveBeenCalledExactlyOnceWith()
})

it('preserves provider failures', async () => {
  const { provider, controller } = fixture()
  const failure = new Error('storage unavailable')
  provider.getQuota.mockRejectedValueOnce(failure)
  await expect(controller.getQuota()).rejects.toBe(failure)
})

it('carries the stable business code and trace id across the Remote wire', async () => {
  const { provider, controller } = fixture()
  provider.getQuota.mockRejectedValueOnce(new MioAccountError('TOO_MANY_REQUESTS', 'slow down', {
    httpStatus: 429,
    traceId: 'trace-1',
  }))
  await expect(controller.getQuota()).rejects.toMatchObject({
    code: 'mio-account/failure',
    message: 'slow down',
    details: { code: 'TOO_MANY_REQUESTS', httpStatus: 429, traceId: 'trace-1' },
  })
  provider.loginWithSms.mockRejectedValueOnce(new MioAccountError('SMS_CODE_INVALID', 'code expired'))
  await expect(controller.loginWithSms({
    countryCode: '+86', mobile: '13800000000', smsRequestId: 'sms-1', smsCode: '000000',
  })).rejects.toMatchObject({ details: { code: 'SMS_CODE_INVALID' } })
})

it('returns the account state stream unchanged', async () => {
  const { provider, controller } = fixture()
  const lifetime = new AbortController()
  const stream: AsyncIterable<MioAccountView> = { async *[Symbol.asyncIterator]() { yield state } }
  provider.watch.mockReturnValue(stream)
  expect(controller.watch(lifetime.signal)).toBe(stream)
  expect(provider.watch).toHaveBeenCalledExactlyOnceWith(lifetime.signal)
})

it('delivers expiry to current subscribers and never replays it on reconnect', async () => {
  const { ctx, controller } = fixture()
  const lifetime = new AbortController()
  const iterator = controller.watchExpiry(lifetime.signal)[Symbol.asyncIterator]()
  const first = iterator.next()
  ctx.emit('mio-account/session-expired')
  ctx.emit('mio-account/session-expired')
  expect(await first).toEqual({ done: false, value: 'session-expired' })
  expect(await iterator.next()).toEqual({ done: false, value: 'session-expired' })
  const waiting = iterator.next()
  lifetime.abort()
  expect(await waiting).toEqual({ done: true, value: undefined })

  const reconnect = new AbortController()
  const reopened = controller.watchExpiry(reconnect.signal)[Symbol.asyncIterator]().next()
  reconnect.abort()
  expect(await reopened).toEqual({ done: true, value: undefined })
})
