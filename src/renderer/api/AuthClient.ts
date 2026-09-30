import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  authGetStatusRoute,
  authGetMeRoute,
  authLoginRoute,
  authLoginByCodeRoute,
  authResetPasswordRoute,
  authSendCodeRoute,
  authLogoutRoute,
  authGetPlansRoute,
  authPurchasePlanRoute,
  authGetOrderRoute,
  authGetSubscriptionsRoute,
  authGetQuotaRoute,
  authGetAgreementsRoute,
  type authUserSchema,
  type planSchema,
  type quotaSchema,
  type subscriptionSchema,
  type agreementSchema
} from '@shared/contracts/routes'
import type { z } from 'zod'
import { getDeepchatBridge } from './core'

/** 短信验证码场景 */
export type SmsScene = 'LOGIN' | 'RESET_PASSWORD'

/** 当前登录用户信息 */
export type AuthUser = z.output<typeof authUserSchema>

/** 可购买套餐 */
export type Plan = z.output<typeof planSchema>

/** 单条订阅 */
export type Subscription = z.output<typeof subscriptionSchema>

/** 账户额度 */
export type Quota = z.output<typeof quotaSchema>

/** 单条协议 */
export type Agreement = z.output<typeof agreementSchema>

export function createAuthClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getStatus(): Promise<boolean> {
    const result = await bridge.invoke(authGetStatusRoute.name, {})
    return result.authenticated
  }

  /** 获取登录状态与当前用户信息 */
  async function getAccount(): Promise<{ authenticated: boolean; user: AuthUser | null }> {
    const result = await bridge.invoke(authGetStatusRoute.name, {})
    return { authenticated: result.authenticated, user: result.user ?? null }
  }

  /** 拉取最新用户资料（GET /users/me），失败时回退本地缓存 */
  async function getMe(): Promise<AuthUser | null> {
    const result = await bridge.invoke(authGetMeRoute.name, {})
    return result.user ?? null
  }

  /** 发送短信验证码，返回 smsRequestId 供短信登录/重置密码使用 */
  async function sendCode(mobile: string, scene: SmsScene, authenticated = false) {
    return await bridge.invoke(authSendCodeRoute.name, { mobile, scene, authenticated })
  }

  /** 手机号 + 密码登录 */
  async function login(mobile: string, password: string) {
    return await bridge.invoke(authLoginRoute.name, { mobile, password })
  }

  /** 手机号 + 短信验证码登录 */
  async function loginByCode(mobile: string, smsRequestId: string, smsCode: string) {
    return await bridge.invoke(authLoginByCodeRoute.name, { mobile, smsRequestId, smsCode })
  }

  /** 短信重置密码（匿名找回 / 登录态修改），返回 ok/errorCode/msg */
  async function resetPassword(input: {
    mobile?: string
    smsRequestId: string
    smsCode: string
    newPassword: string
    authenticated?: boolean
  }) {
    return await bridge.invoke(authResetPasswordRoute.name, input)
  }

  async function logout(): Promise<boolean> {
    const result = await bridge.invoke(authLogoutRoute.name, {})
    return result.ok
  }

  /** 获取可购买套餐 */
  async function getPlans(): Promise<{ ok: boolean; plans?: Plan[]; msg?: string }> {
    return await bridge.invoke(authGetPlansRoute.name, {})
  }

  /** 购买套餐（可选支付渠道，缺省由服务端决定） */
  async function purchasePlan(
    planId: number,
    requestId: string,
    paymentChannel?: string
  ): Promise<{
    ok: boolean
    orderNo?: string | null
    paymentStatus?: string | null
    paymentChannel?: string | null
    paymentScene?: string | null
    codeUrl?: string | null
    expireTime?: string | null
    grantStatus?: string | null
    subscriptionId?: number | null
    errorCode?: string | null
    msg?: string | null
  }> {
    return await bridge.invoke(authPurchasePlanRoute.name, {
      planId,
      requestId,
      paymentChannel
    })
  }

  /** 查询订单状态 */
  async function getOrder(orderNo: string): Promise<{
    ok: boolean
    orderNo?: string | null
    paymentStatus?: string | null
    paymentChannel?: string | null
    paymentScene?: string | null
    codeUrl?: string | null
    expireTime?: string | null
    grantStatus?: string | null
    subscriptionId?: number | null
    errorCode?: string | null
    msg?: string | null
  }> {
    return await bridge.invoke(authGetOrderRoute.name, { orderNo })
  }

  /** 查询当前用户订阅 */
  async function getSubscriptions(): Promise<{
    ok: boolean
    items?: Subscription[]
    realtime?: boolean
    msg?: string
  }> {
    return await bridge.invoke(authGetSubscriptionsRoute.name, {})
  }

  /** 查询当前用户额度（GET /quota） */
  async function getQuota(): Promise<{
    ok: boolean
    quota?: Quota | null
    msg?: string
  }> {
    return await bridge.invoke(authGetQuotaRoute.name, {})
  }

  /** 查询协议列表（匿名接口） */
  async function getAgreements(): Promise<{
    ok: boolean
    agreements?: Agreement[]
    msg?: string
  }> {
    return await bridge.invoke(authGetAgreementsRoute.name, {})
  }

  return {
    getStatus,
    getAccount,
    getMe,
    sendCode,
    login,
    loginByCode,
    resetPassword,
    logout,
    getPlans,
    purchasePlan,
    getOrder,
    getSubscriptions,
    getQuota,
    getAgreements
  }
}

export type AuthClient = ReturnType<typeof createAuthClient>
