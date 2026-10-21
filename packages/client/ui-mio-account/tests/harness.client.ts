/** Shared fixtures for the mioagent login surface tests. */
import { vi } from 'vitest'
import type {
  MioAccountView, MioAgreement, MioOrderStatus, MioPlan, MioPurchaseResult, MioQuotaView, MioSmsCode,
  MioSubscriptionsView, MioUser,
} from '@deepseek-ai/dsh-mio-account/types'
import type { MioAccountState } from '../src/client/account-state.ts'
import type { MioAccountOperations } from '../src/client/operations.ts'

/** Display-safe user projection used by signed-in snapshots. */
export const USER: MioUser = {
  userId: 'test-account' as MioUser['userId'],
  maskedPhone: '138****0000',
  nickname: 'Tester',
  accountStatus: 'READY',
  credentialStatus: 'READY',
}

/** Stored signed-in view. */
export const SIGNED_IN: MioAccountView = { status: 'signed-in', user: USER, expiresAt: 1_800_000_000_000 }
/** Stored signed-out view. */
export const SIGNED_OUT: MioAccountView = { status: 'signed-out', user: null, expiresAt: null }

/** Issued SMS code. */
export const SMS: MioSmsCode = { smsRequestId: 'sms-1', retryAfterSeconds: 60, expiresIn: 300 }

/** Account quota used by the account section fixtures. */
export const QUOTA: MioQuotaView = { remainingQuota: 2_500_000, usedQuota: 1_000_000, unit: 'quota', fetchedAt: '2026-10-21 12:00:00' }

/** Empty subscription list that reports a fresh read. */
export const SUBSCRIPTIONS: MioSubscriptionsView = { items: [], realtime: true }

/** One purchasable plan. */
export const PLAN: MioPlan = {
  planId: 1, planName: 'Monthly', planType: 'MONTHLY', planContent: '<p>Everyday use</p>', quota: 44_000_000,
  maxPurchasePerUser: 1, price: 19, currency: 'CNY', durationUnit: 'MONTH', durationValue: 1,
  customSeconds: 0, quotaResetPeriod: 'MONTHLY', quotaResetCustomSeconds: 0,
}

/** Pending WeChat order returned by a purchase. */
export const PURCHASE: MioPurchaseResult = {
  orderNo: 'ord-1', paymentStatus: 'PENDING', paymentChannel: 'WECHAT', paymentScene: 'NATIVE',
  codeUrl: 'weixin://wxpay/bizpayurl?pr=test', expireTime: '2099-01-01 00:00:00',
  grantStatus: 'PENDING', subscriptionId: null,
}

/** Order state while payment is pending. */
export const ORDER: MioOrderStatus = { ...PURCHASE }

/** Agreement documents in the backend's fixed order. */
export const AGREEMENTS: readonly MioAgreement[] = [
  { agreementType: 'USER', title: 'User agreement', content: '<p>user terms</p>' },
  { agreementType: 'PRIVACY', title: 'Privacy policy', content: '<p>privacy terms</p>' },
]

/** Selector hook returning a fixed account snapshot. */
export function staticAccount(state: MioAccountState) {
  return <Selected>(selector: (value: MioAccountState) => Selected): Selected => selector(state)
}

/** @param key - locale key. @returns the key itself, so assertions read keys instead of copy. */
export const translate = (key: string): string => key

/** @param overrides - operations this test asserts or replaces. @returns a complete operation face. */
export function stubOperations(overrides: Partial<MioAccountOperations> = {}): MioAccountOperations {
  return {
    sendSmsCode: vi.fn(async () => SMS),
    loginWithSms: vi.fn(async () => SIGNED_IN),
    loginWithPassword: vi.fn(async () => SIGNED_IN),
    resetPassword: vi.fn(async () => undefined),
    getAgreements: vi.fn(async () => AGREEMENTS),
    getQuota: vi.fn(async () => QUOTA),
    getPlans: vi.fn(async () => [PLAN]),
    purchasePlan: vi.fn(async () => PURCHASE),
    getOrder: vi.fn(async () => ORDER),
    getSubscriptions: vi.fn(async () => SUBSCRIPTIONS),
    logout: vi.fn(async () => SIGNED_OUT),
    ...overrides,
  }
}
