import { z } from 'zod'
import { defineRouteContract } from '../common'

/** 短信验证码场景：登录 / 重置密码 */
export const smsSceneSchema = z.enum(['LOGIN', 'RESET_PASSWORD'])

/** 当前登录用户信息（后端缺失字段会返回 null，因此均允许 null） */
export const authUserSchema = z.object({
  userId: z.string().nullable().optional(),
  mobile: z.string().nullable().optional(),
  maskedPhone: z.string().nullable().optional(),
  nickname: z.string().nullable().optional(),
  accountStatus: z.string().nullable().optional(),
  credentialStatus: z.string().nullable().optional()
})

export const authGetStatusRoute = defineRouteContract({
  name: 'auth.getStatus',
  input: z.object({}).default({}),
  output: z.object({
    authenticated: z.boolean(),
    user: authUserSchema.nullable().optional()
  })
})

/** 拉取最新用户资料（GET /users/me），失败时回退本地会话缓存 */
export const authGetMeRoute = defineRouteContract({
  name: 'auth.getMe',
  input: z.object({}).default({}),
  output: z.object({
    user: authUserSchema.nullable()
  })
})

/** 发送短信验证码 */
export const authSendCodeRoute = defineRouteContract({
  name: 'auth.sendCode',
  input: z.object({
    mobile: z.string().optional(),
    scene: smsSceneSchema,
    /** 已登录修改密码时传 true，主进程会携带 Token，服务端用用户库手机号 */
    authenticated: z.boolean().optional()
  }),
  output: z.object({
    ok: z.boolean(),
    smsRequestId: z.string().optional(),
    retryAfterSeconds: z.number().optional(),
    expiresIn: z.number().optional(),
    msg: z.string().optional()
  })
})

/** 手机号 + 密码登录 */
export const authLoginRoute = defineRouteContract({
  name: 'auth.login',
  input: z.object({
    mobile: z.string().min(1),
    password: z.string().min(1)
  }),
  output: z.object({
    ok: z.boolean(),
    msg: z.string().optional()
  })
})

/** 手机号 + 短信验证码登录 */
export const authLoginByCodeRoute = defineRouteContract({
  name: 'auth.loginByCode',
  input: z.object({
    mobile: z.string().min(1),
    smsRequestId: z.string().min(1),
    smsCode: z.string().min(1)
  }),
  output: z.object({
    ok: z.boolean(),
    msg: z.string().optional()
  })
})

/** 短信重置密码（匿名找回密码 / 登录态修改密码） */
export const authResetPasswordRoute = defineRouteContract({
  name: 'auth.resetPassword',
  input: z.object({
    mobile: z.string().optional(),
    smsRequestId: z.string().min(1),
    smsCode: z.string().min(1),
    newPassword: z.string().min(1),
    /** 已登录修改密码时传 true，主进程会携带 Token */
    authenticated: z.boolean().optional()
  }),
  output: z.object({
    ok: z.boolean(),
    errorCode: z.string().nullable().optional(),
    msg: z.string().optional()
  })
})

/** 退出登录 */
export const authLogoutRoute = defineRouteContract({
  name: 'auth.logout',
  input: z.object({}).default({}),
  output: z.object({
    ok: z.boolean()
  })
})

// ---- 订阅相关 ----

/** 可购买套餐（GET /plans 返回的单条 plan） */
export const planSchema = z.object({
  planId: z.number(),
  planName: z.string(),
  /** 本地展示分类：MONTHLY / QUARTERLY / YEARLY；不决定订阅有效期 */
  planType: z.string(),
  /** 本地配置的普通文本套餐内容 */
  planContent: z.string(),
  quota: z.number(),
  /** NewAPI 每用户历史订阅次数上限；0 表示不限 */
  maxPurchasePerUser: z.number(),
  price: z.number(),
  currency: z.string(),
  durationUnit: z.string(),
  durationValue: z.number(),
  customSeconds: z.number(),
  quotaResetPeriod: z.string(),
  quotaResetCustomSeconds: z.number()
})

/** 单条订阅 */
export const subscriptionSchema = z.object({
  subscriptionId: z.number(),
  planId: z.number(),
  planName: z.string(),
  amountTotal: z.number(),
  amountUsed: z.number(),
  startTime: z.string(),
  endTime: z.string(),
  status: z.string(),
  lastResetTime: z.string().nullable().optional(),
  nextResetTime: z.string().nullable().optional(),
  allowWalletOverflow: z.boolean()
})

/** 获取可购买套餐 */
export const authGetPlansRoute = defineRouteContract({
  name: 'auth.getPlans',
  input: z.object({}).default({}),
  output: z.object({
    ok: z.boolean(),
    plans: z.array(planSchema).optional(),
    msg: z.string().optional()
  })
})

/** 购买套餐 */
export const authPurchasePlanRoute = defineRouteContract({
  name: 'auth.purchasePlan',
  input: z.object({
    planId: z.number(),
    requestId: z.string().min(1),
    /** 支付渠道：ALIPAY / WECHAT；缺省由服务端决定（默认 WECHAT） */
    paymentChannel: z.string().optional()
  }),
  output: z.object({
    ok: z.boolean(),
    orderNo: z.string().nullable().optional(),
    paymentStatus: z.string().nullable().optional(),
    paymentChannel: z.string().nullable().optional(),
    paymentScene: z.string().nullable().optional(),
    codeUrl: z.string().nullable().optional(),
    expireTime: z.string().nullable().optional(),
    grantStatus: z.string().nullable().optional(),
    subscriptionId: z.number().nullable().optional(),
    errorCode: z.string().nullable().optional(),
    msg: z.string().nullable().optional()
  })
})

/** 查询订单状态 */
export const authGetOrderRoute = defineRouteContract({
  name: 'auth.getOrder',
  input: z.object({
    orderNo: z.string().min(1)
  }),
  output: z.object({
    ok: z.boolean(),
    orderNo: z.string().nullable().optional(),
    paymentStatus: z.string().nullable().optional(),
    paymentChannel: z.string().nullable().optional(),
    paymentScene: z.string().nullable().optional(),
    codeUrl: z.string().nullable().optional(),
    expireTime: z.string().nullable().optional(),
    grantStatus: z.string().nullable().optional(),
    subscriptionId: z.number().nullable().optional(),
    errorCode: z.string().nullable().optional(),
    msg: z.string().nullable().optional()
  })
})

/** 查询当前用户订阅 */
export const authGetSubscriptionsRoute = defineRouteContract({
  name: 'auth.getSubscriptions',
  input: z.object({}).default({}),
  output: z.object({
    ok: z.boolean(),
    items: z.array(subscriptionSchema).optional(),
    realtime: z.boolean().optional(),
    msg: z.string().optional()
  })
})

/** 账户额度（GET /quota 返回的 data） */
export const quotaSchema = z.object({
  remainingQuota: z.number().nullable().optional(),
  usedQuota: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  fetchedAt: z.string().nullable().optional()
})

/** 查询当前用户额度 */
export const authGetQuotaRoute = defineRouteContract({
  name: 'auth.getQuota',
  input: z.object({}).default({}),
  output: z.object({
    ok: z.boolean(),
    quota: quotaSchema.nullable().optional(),
    msg: z.string().optional()
  })
})

// ---- 协议管理 ----

/** 协议类型：用户协议 / 隐私协议 / 订阅协议 */
export const agreementTypeSchema = z.enum(['USER', 'PRIVACY', 'SUBSCRIPTION'])

/** 单条协议（GET /agreements 返回） */
export const agreementSchema = z.object({
  agreementType: agreementTypeSchema,
  title: z.string(),
  content: z.string(),
  updateTime: z.string().nullable().optional()
})

/** 查询协议列表（匿名接口） */
export const authGetAgreementsRoute = defineRouteContract({
  name: 'auth.getAgreements',
  input: z.object({}).default({}),
  output: z.object({
    ok: z.boolean(),
    agreements: z.array(agreementSchema).optional(),
    msg: z.string().optional()
  })
})
