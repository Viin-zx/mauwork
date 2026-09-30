import { BrowserWindow } from 'electron'
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
  authGetAgreementsRoute
} from '@shared/contracts/routes'
import {
  createRouteMap,
  requireRendererCaller,
  type DeepchatRouteMap
} from '@/routes/routeRegistry'
import { AuthService, MioApiError } from './authService'

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof MioApiError) {
    return error.msg || fallback
  }
  console.error('[AuthRoute] Unexpected error:', error)
  return fallback
}

/** 透传后端稳定错误码（供渲染层做业务分支），非 MioApiError 时返回 null */
function toErrorCode(error: unknown): string | null {
  if (error instanceof MioApiError) {
    return error.errorCode ?? null
  }
  return null
}

/** 退出登录后重载其他窗口，使其回到登录页（调用方窗口由渲染层自行关闭） */
function reloadOtherWindows(excludeWebContentsId: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) {
        continue
      }
      if (win.webContents.id === excludeWebContentsId) {
        continue
      }
      win.webContents.reload()
    } catch (error) {
      console.warn('[AuthRoute] Failed to reload window after logout:', error)
    }
  }
}

export function createAuthRoutes(
  auth: AuthService,
  /** 登录 / 注册成功后触发的回调（用于同步 zr provider 等） */
  onLoggedIn?: () => void | Promise<void>,
  /** 套餐开通成功（订单 PAID + ACTIVE）后触发的回调，用于强制刷新模型网关凭据 */
  onPurchaseGranted?: () => void | Promise<void>
): DeepchatRouteMap {
  const fireLoggedIn = () => {
    if (onLoggedIn) {
      void Promise.resolve(onLoggedIn()).catch((e) => {
        console.warn('[AuthRoute] onLoggedIn callback failed:', e)
      })
    }
  }
  // 同一订单仅触发一次开通同步，避免轮询重复刷新
  let lastGrantedOrderNo: string | null = null
  const firePurchaseGranted = (orderNo: string) => {
    if (onPurchaseGranted && lastGrantedOrderNo !== orderNo) {
      lastGrantedOrderNo = orderNo
      void Promise.resolve(onPurchaseGranted()).catch((e) => {
        console.warn('[AuthRoute] onPurchaseGranted callback failed:', e)
      })
    }
  }

  return createRouteMap([
    [
      authGetStatusRoute.name,
      async (rawInput) => {
        authGetStatusRoute.input.parse(rawInput)
        return authGetStatusRoute.output.parse({
          authenticated: auth.isAuthenticated(),
          user: auth.getCurrentUser()
        })
      }
    ],
    [
      authGetMeRoute.name,
      async (rawInput) => {
        authGetMeRoute.input.parse(rawInput)
        const user = await auth.fetchCurrentUser()
        return authGetMeRoute.output.parse({ user })
      }
    ],
    [
      authSendCodeRoute.name,
      async (rawInput) => {
        const input = authSendCodeRoute.input.parse(rawInput)
        try {
          const result = await auth.sendSmsCode(
            input.mobile ?? '',
            input.scene,
            input.authenticated ?? false
          )
          return authSendCodeRoute.output.parse({ ok: true, ...result })
        } catch (error) {
          return authSendCodeRoute.output.parse({
            ok: false,
            msg: toErrorMessage(error, '验证码发送失败')
          })
        }
      }
    ],
    [
      authLoginRoute.name,
      async (rawInput) => {
        const input = authLoginRoute.input.parse(rawInput)
        try {
          await auth.loginByPassword(input.mobile, input.password)
          fireLoggedIn()
          return authLoginRoute.output.parse({ ok: true })
        } catch (error) {
          return authLoginRoute.output.parse({
            ok: false,
            msg: toErrorMessage(error, '登录失败，请重试')
          })
        }
      }
    ],
    [
      authLoginByCodeRoute.name,
      async (rawInput) => {
        const input = authLoginByCodeRoute.input.parse(rawInput)
        try {
          await auth.loginBySms(input.mobile, input.smsRequestId, input.smsCode)
          fireLoggedIn()
          return authLoginByCodeRoute.output.parse({ ok: true })
        } catch (error) {
          return authLoginByCodeRoute.output.parse({
            ok: false,
            msg: toErrorMessage(error, '登录失败，请重试')
          })
        }
      }
    ],
    [
      authResetPasswordRoute.name,
      async (rawInput) => {
        const input = authResetPasswordRoute.input.parse(rawInput)
        try {
          await auth.resetPassword({
            mobile: input.mobile ?? '',
            smsRequestId: input.smsRequestId,
            smsCode: input.smsCode,
            newPassword: input.newPassword,
            authenticated: input.authenticated ?? false
          })
          return authResetPasswordRoute.output.parse({ ok: true })
        } catch (error) {
          return authResetPasswordRoute.output.parse({
            ok: false,
            errorCode: toErrorCode(error),
            msg: toErrorMessage(error, '重置密码失败，请重试')
          })
        }
      }
    ],
    [
      authLogoutRoute.name,
      async (rawInput, context) => {
        authLogoutRoute.input.parse(rawInput)
        await auth.logout()
        try {
          const caller = requireRendererCaller(context)
          reloadOtherWindows(caller.webContentsId)
        } catch {
          // 非 renderer 调用时重载所有窗口
          reloadOtherWindows(-1)
        }
        return authLogoutRoute.output.parse({ ok: true })
      }
    ],
    [
      authGetPlansRoute.name,
      async (rawInput) => {
        authGetPlansRoute.input.parse(rawInput)
        try {
          const plans = await auth.getPlans()
          return authGetPlansRoute.output.parse({ ok: true, plans })
        } catch (error) {
          return authGetPlansRoute.output.parse({
            ok: false,
            msg: toErrorMessage(error, '获取套餐失败')
          })
        }
      }
    ],
    [
      authPurchasePlanRoute.name,
      async (rawInput) => {
        const input = authPurchasePlanRoute.input.parse(rawInput)
        try {
          const result = await auth.purchasePlan(
            input.planId,
            input.requestId,
            input.paymentChannel
          )
          return authPurchasePlanRoute.output.parse({
            ok: true,
            orderNo: result.orderNo,
            paymentStatus: result.paymentStatus,
            paymentChannel: result.paymentChannel,
            paymentScene: result.paymentScene,
            codeUrl: result.codeUrl,
            expireTime: result.expireTime,
            grantStatus: result.grantStatus,
            subscriptionId: result.subscriptionId
          })
        } catch (error) {
          return authPurchasePlanRoute.output.parse({
            ok: false,
            errorCode: toErrorCode(error),
            msg: toErrorMessage(error, '购买失败，请重试')
          })
        }
      }
    ],
    [
      authGetOrderRoute.name,
      async (rawInput) => {
        const input = authGetOrderRoute.input.parse(rawInput)
        try {
          const result = await auth.getOrderStatus(input.orderNo)
          if (result.paymentStatus === 'PAID' && result.grantStatus === 'ACTIVE') {
            firePurchaseGranted(input.orderNo)
          }
          return authGetOrderRoute.output.parse({
            ok: true,
            orderNo: result.orderNo,
            paymentStatus: result.paymentStatus,
            paymentChannel: result.paymentChannel,
            paymentScene: result.paymentScene,
            codeUrl: result.codeUrl,
            expireTime: result.expireTime,
            grantStatus: result.grantStatus,
            subscriptionId: result.subscriptionId
          })
        } catch (error) {
          return authGetOrderRoute.output.parse({
            ok: false,
            errorCode: toErrorCode(error),
            msg: toErrorMessage(error, '查询订单失败')
          })
        }
      }
    ],
    [
      authGetSubscriptionsRoute.name,
      async (rawInput) => {
        authGetSubscriptionsRoute.input.parse(rawInput)
        try {
          const result = await auth.getSubscriptions()
          return authGetSubscriptionsRoute.output.parse({
            ok: true,
            items: result.items,
            realtime: result.realtime
          })
        } catch (error) {
          return authGetSubscriptionsRoute.output.parse({
            ok: false,
            msg: toErrorMessage(error, '查询订阅失败')
          })
        }
      }
    ],
    [
      authGetQuotaRoute.name,
      async (rawInput) => {
        authGetQuotaRoute.input.parse(rawInput)
        try {
          const quota = await auth.getQuota()
          return authGetQuotaRoute.output.parse({ ok: true, quota })
        } catch (error) {
          return authGetQuotaRoute.output.parse({
            ok: false,
            msg: toErrorMessage(error, '查询额度失败')
          })
        }
      }
    ],
    [
      authGetAgreementsRoute.name,
      async (rawInput) => {
        authGetAgreementsRoute.input.parse(rawInput)
        try {
          const agreements = await auth.getAgreements()
          return authGetAgreementsRoute.output.parse({ ok: true, agreements })
        } catch (error) {
          return authGetAgreementsRoute.output.parse({
            ok: false,
            msg: toErrorMessage(error, '获取协议失败')
          })
        }
      }
    ]
  ])
}
