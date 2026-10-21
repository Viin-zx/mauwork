/** Shared fixtures for the mioagent login surface tests. */
import { vi } from 'vitest'
import type {
  MioAccountView, MioAgreement, MioSmsCode, MioUser,
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
    logout: vi.fn(async () => SIGNED_OUT),
    ...overrides,
  }
}
