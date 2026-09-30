<template>
  <SettingsPageShell
    :title="t('routes.settings-account')"
    :eyebrow="t('settings.controlCenter.groups.overview')"
    data-testid="settings-account-page"
  >
    <div v-if="loading" class="flex items-center gap-2 py-16 text-sm text-muted-foreground">
      <Spinner class="size-4" />
      {{ t('account.loading') }}
    </div>

    <div v-else class="flex w-full flex-col gap-4">
      <!-- 账号信息卡片 -->
      <div
        class="rounded-xl border border-border/80 bg-card/70 p-5 shadow-sm"
        data-testid="settings-account-card"
      >
        <div class="flex items-center gap-4">
          <Avatar class="size-14 border border-border/60">
            <AvatarFallback class="bg-primary/10 text-lg font-semibold text-primary">
              {{ avatarInitial }}
            </AvatarFallback>
          </Avatar>
          <div class="min-w-0 flex-1">
            <div class="truncate text-base font-semibold">
              {{ displayName }}
            </div>
            <div class="truncate text-sm text-muted-foreground">
              {{ user?.maskedPhone || t('account.notSet') }}
            </div>
          </div>
          <Badge v-if="accountActive" variant="secondary" class="shrink-0">
            {{ t('account.statusActive') }}
          </Badge>
        </div>

        <Separator class="my-4" />

        <div class="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 text-sm">
          <span class="text-muted-foreground">{{ t('account.nickname') }}</span>
          <span class="min-w-0 truncate">{{ user?.nickname || t('account.notSet') }}</span>
          <span class="text-muted-foreground">{{ t('account.phone') }}</span>
          <span class="min-w-0 truncate">{{ displayPhone }}</span>
          <span class="text-muted-foreground">{{ t('account.freeQuota') }}</span>
          <span class="min-w-0 truncate">{{ quotaRemainingText }}</span>
          <span class="text-muted-foreground">{{ t('account.totalUsage') }}</span>
          <span class="min-w-0 truncate">{{ quotaUsedText }}</span>
        </div>

        <div class="mt-5 flex justify-end gap-2">
          <DcButton
            variant="outline"
            size="sm"
            data-testid="settings-account-change-password"
            @click="showChangePasswordDialog = true"
          >
            <Icon icon="lucide:key-round" class="mr-1 size-3.5" data-icon="inline-start" />
            {{ t('account.changePassword') }}
          </DcButton>
          <DcButton
            variant="outline"
            size="sm"
            class="text-red-600 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300"
            :disabled="loggingOut"
            data-testid="settings-account-logout"
            @click="confirmAction = 'logout'"
          >
            <Icon icon="lucide:log-out" class="mr-1 size-3.5" data-icon="inline-start" />
            {{ t('account.logout') }}
          </DcButton>
        </div>
      </div>

      <!-- 当前套餐卡片 -->
      <div
        class="rounded-xl border border-border/80 bg-card/70 p-5 shadow-sm"
        data-testid="settings-account-plan"
      >
        <div class="flex items-center gap-2">
          <Icon icon="lucide:gem" class="size-4 text-primary" />
          <span class="text-sm font-semibold">{{ t('account.planSection') }}</span>
          <Badge v-if="sortedSubscriptions.length > 0" variant="outline" class="ml-1">
            {{ sortedSubscriptions.length }}
          </Badge>
          <DcButton
            size="sm"
            class="ml-auto"
            data-testid="settings-account-upgrade"
            @click="openSubscription"
          >
            <Icon icon="lucide:plus" class="mr-1 size-3.5" data-icon="inline-start" />
            {{ t('account.upgradeButton') }}
          </DcButton>
        </div>

        <!-- 有订阅：展示全部订阅（一行多个，自动换行） -->
        <div v-if="sortedSubscriptions.length > 0" class="mt-4">
          <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            <div
              v-for="sub in sortedSubscriptions"
              :key="sub.subscriptionId"
              :class="[
                'rounded-lg border border-border/60 p-4',
                sub.status === 'active' ? 'bg-background/40' : 'bg-gray-200 dark:bg-gray-800'
              ]"
            >
              <div class="flex items-center gap-2">
                <span class="truncate text-sm font-medium">{{ sub.planName }}</span>
                <span
                  :class="[
                    'inline-block size-1.5 shrink-0 rounded-full',
                    sub.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground'
                  ]"
                />
                <span class="shrink-0 text-xs text-muted-foreground">{{
                  subscriptionStatusLabel(sub.status)
                }}</span>
                <span class="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                  #{{ sub.subscriptionId }}
                </span>
              </div>
              <div :class="sub.status === 'active' ? '' : 'opacity-60'">
                <div class="mt-3 flex items-baseline gap-2">
                  <span class="text-xs text-muted-foreground">{{ t('account.subRemaining') }}</span>
                  <span class="text-xl font-semibold text-primary">
                    {{ formatQuota(sub.amountTotal - sub.amountUsed) }}
                  </span>
                  <span class="ml-auto text-xs text-muted-foreground">
                    / {{ formatQuota(sub.amountTotal, true) }}
                  </span>
                </div>
                <div class="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{{ t('account.subQuotaUsed') }} {{ formatQuota(sub.amountUsed) }}</span>
                  <span
                    >{{ formatShortDate(sub.startTime) }} ~ {{ formatShortDate(sub.endTime) }}</span
                  >
                </div>
              </div>
            </div>
          </div>
          <p v-if="!subscriptionsRealtime" class="mt-2 text-xs text-muted-foreground">
            {{ t('account.subDataDelayed') }}
          </p>
        </div>

        <!-- 无订阅 -->
        <p v-else class="mt-3 text-sm text-muted-foreground">
          {{ t('account.planNoSubscription') }}
        </p>
      </div>
    </div>

    <!-- 退出登录确认 -->
    <AlertDialog
      :open="confirmAction !== null"
      @update:open="(open: boolean) => !open && (confirmAction = null)"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('account.logoutConfirmTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>{{
            t('account.logoutConfirmDescription')
          }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('account.cancel') }}</AlertDialogCancel>
          <AlertDialogAsyncAction variant="destructive" :disabled="loggingOut" @click="doLogout">
            <Spinner v-if="loggingOut" class="mr-1 size-3" />
            {{ t('account.confirmLogout') }}
          </AlertDialogAsyncAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- 订阅/升级套餐弹窗 -->
    <Dialog :open="showSubscription" @update:open="showSubscription = $event">
      <DialogContent class="flex max-h-[90vh] max-w-[90vw] flex-col sm:max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>
            {{
              paymentPhase === 'qr_ready' || paymentPhase === 'paid_pending'
                ? qrPayTitle
                : t('account.subscriptionTitle')
            }}
          </DialogTitle>
          <DialogDescription>
            {{
              paymentPhase === 'qr_ready' || paymentPhase === 'paid_pending'
                ? qrPayDescription
                : t('account.subscriptionDescription')
            }}
          </DialogDescription>
        </DialogHeader>

        <!-- 套餐列表（支付流程中隐藏） -->
        <div
          v-if="paymentPhase === 'idle' || paymentPhase === 'failed' || paymentPhase === 'expired'"
          class="min-h-0 flex-1 overflow-y-auto"
        >
          <div
            v-if="plansLoading"
            class="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
          >
            <Spinner class="size-4" />
            {{ t('account.plansLoading') }}
          </div>

          <div
            v-else-if="plans.length === 0"
            class="py-8 text-center text-sm text-muted-foreground"
          >
            {{ t('account.plansEmpty') }}
          </div>

          <div v-else class="flex flex-col gap-3">
            <!-- 套餐卡片（全部套餐，单行排列，不换行，超出横向滚动） -->
            <div class="flex gap-3 overflow-x-auto pb-1">
              <div
                v-for="plan in plans"
                :key="plan.planId"
                role="button"
                tabindex="0"
                :class="[
                  'flex min-w-64 flex-1 cursor-pointer flex-col rounded-xl border p-4 transition-colors',
                  selectedPlanId === plan.planId
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:border-primary/40'
                ]"
                @click="selectedPlanId = plan.planId"
                @keydown.enter="selectedPlanId = plan.planId"
              >
                <div class="flex items-center gap-2">
                  <span class="truncate text-sm font-semibold">{{ plan.planName }}</span>
                  <Icon
                    v-if="selectedPlanId === plan.planId"
                    icon="lucide:check-circle-2"
                    class="ml-auto size-4 shrink-0 text-primary"
                  />
                </div>

                <!-- 大字价格 -->
                <div class="mt-2 flex items-baseline gap-1">
                  <span class="text-2xl font-bold leading-none">￥{{ plan.price }}</span>
                  <span class="text-xs text-muted-foreground">{{ plan.currency }}</span>
                  <span class="ml-auto text-xs text-muted-foreground">
                    / {{ formatPlanDuration(plan) }}
                  </span>
                </div>

                <!-- 权益特性列表（planContent 富文本，按编辑器 HTML 展示） -->
                <div v-if="plan.planContent" class="mt-2 border-t border-border/60 pt-2">
                  <p class="text-xs font-medium text-foreground/80">
                    {{ t('account.planIncludes') }}
                  </p>
                  <div
                    class="plan-content mt-0.5 text-xs leading-relaxed text-muted-foreground"
                    v-html="plan.planContent"
                  />
                </div>

                <!-- 每月额度 / 限购（固定卡片底部，与权益分隔） -->
                <div
                  class="mt-auto flex flex-wrap gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground"
                >
                  <span>{{ t('account.planQuota') }}: {{ formatQuota(plan.quota, true) }}</span>
                  <span>{{ t('account.planPurchaseLimit') }}: {{ formatPurchaseLimit(plan) }}</span>
                </div>
              </div>
            </div>

            <!-- 支付渠道选择 -->
            <div class="mt-2 flex items-center gap-2">
              <span class="text-sm font-bold text-foreground">
                {{ t('account.paymentChannel') }}
              </span>
              <button
                v-for="ch in paymentChannels"
                :key="ch.value"
                type="button"
                :class="[
                  'rounded-lg border px-3 py-2 text-sm transition-colors',
                  selectedPaymentChannel === ch.value
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40'
                ]"
                @click="selectedPaymentChannel = ch.value"
              >
                <div class="flex items-center justify-center gap-1.5">
                  <Icon :icon="ch.icon" class="size-4" />
                  {{ ch.label }}
                </div>
              </button>
            </div>
          </div>
        </div>

        <!-- 购买结果 / 二维码支付 -->
        <div v-if="purchaseResult" class="space-y-3">
          <!-- 购买失败 -->
          <div v-if="!purchaseResult.ok" class="rounded-lg border border-border/60 p-4">
            <p class="text-base text-destructive">
              {{ purchaseResult.msg || purchaseErrorHint || t('account.purchaseFailed') }}
            </p>
          </div>

          <!-- 二维码支付区 -->
          <div
            v-else-if="purchaseResult.codeUrl && paymentPhase !== 'active'"
            class="rounded-lg border border-border/60 p-4"
          >
            <div class="flex flex-col items-center gap-3">
              <p class="text-sm font-medium">{{ qrPayTitle }}</p>
              <div class="relative">
                <img
                  v-if="qrCodeDataUrl"
                  :src="qrCodeDataUrl"
                  :alt="qrPayTitle"
                  class="size-48 rounded-lg border border-border/40"
                />
                <!-- 未勾选订阅协议：玻璃蒙住二维码 -->
                <div
                  v-if="paymentPhase === 'qr_ready' && !agreeSubscription"
                  class="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg border border-border/40 bg-foreground/10 backdrop-blur-md"
                >
                  <Icon icon="lucide:lock" class="size-8 text-muted-foreground" />
                  <span class="px-4 text-center text-xs text-muted-foreground">
                    {{ t('account.qrPayAgreeHint') }}
                  </span>
                </div>
                <!-- 过期遮罩 -->
                <div
                  v-if="paymentPhase === 'expired'"
                  class="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-background/90"
                >
                  <Icon icon="lucide:clock" class="size-8 text-muted-foreground" />
                  <span class="text-xs text-muted-foreground">{{ t('account.qrPayExpired') }}</span>
                </div>
                <!-- 处理中遮罩 -->
                <div
                  v-else-if="paymentPhase === 'paid_pending'"
                  class="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-background/80"
                >
                  <Spinner class="size-6" />
                  <span class="text-xs text-muted-foreground">{{ t('account.qrPayPaid') }}</span>
                </div>
              </div>

              <!-- 订阅协议勾选（勾选后才展示二维码） -->
              <label
                v-if="paymentPhase === 'qr_ready'"
                class="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground"
              >
                <Checkbox v-model:checked="agreeSubscription" class="mt-0.5" />
                <span class="leading-relaxed">
                  {{ t('account.qrPayAgreePrefix') }}
                  <button
                    type="button"
                    class="text-primary hover:underline"
                    @click.prevent.stop="showSubscriptionAgreement = true"
                  >
                    {{ subscriptionAgreementTitle }}
                  </button>
                </span>
              </label>

              <!-- 状态文案 -->
              <div class="text-center">
                <p v-if="paymentPhase === 'qr_ready'" class="text-sm text-muted-foreground">
                  {{ t('account.qrPayWaiting') }}
                </p>
                <p v-else-if="paymentPhase === 'paid_pending'" class="text-sm text-primary">
                  {{ t('account.qrPayPaid') }}
                </p>
                <p v-else-if="paymentPhase === 'expired'" class="text-sm text-muted-foreground">
                  {{ t('account.qrPayExpired') }}
                </p>
              </div>

              <!-- 倒计时 -->
              <div
                v-if="paymentPhase === 'qr_ready' && countdownSeconds > 0"
                class="text-xs text-muted-foreground"
              >
                {{ t('account.qrPayExpiresIn') }}: {{ formatCountdown(countdownSeconds) }}
              </div>

              <!-- 订单号 -->
              <div v-if="purchaseResult.orderNo" class="text-xs text-muted-foreground">
                {{ t('account.qrPayOrderNo') }}:
                <span class="font-mono">{{ purchaseResult.orderNo }}</span>
              </div>
            </div>
          </div>

          <!-- 购买成功 -->
          <div
            v-else-if="paymentPhase === 'active'"
            class="rounded-lg border border-green-500/30 bg-green-500/5 p-4"
          >
            <p class="flex items-center gap-1 text-sm text-green-600">
              <Icon icon="lucide:check-circle" class="inline size-4" />
              {{ t('account.qrPayActive') }}
            </p>
            <p v-if="purchaseResult.orderNo" class="mt-1 font-mono text-xs text-muted-foreground">
              {{ purchaseResult.orderNo }}
            </p>
          </div>
        </div>

        <DialogFooter>
          <!-- 有活跃订单时显示取消/重新购买 -->
          <template v-if="paymentPhase === 'qr_ready' || paymentPhase === 'paid_pending'">
            <DcButton variant="outline" class="w-full" @click="cancelPaymentIntent">
              {{ t('account.qrPayCancel') }}
            </DcButton>
          </template>
          <template v-else-if="paymentPhase === 'active'">
            <DcButton class="w-full" @click="closeSubscription">
              {{ t('common.confirm') }}
            </DcButton>
          </template>
          <template v-else-if="paymentPhase === 'expired' || paymentPhase === 'failed'">
            <DcButton
              class="w-full"
              :disabled="selectedPlanId === null || purchasing"
              @click="handlePurchase"
            >
              <Spinner v-if="purchasing" class="mr-1 size-3" />
              {{ t('account.qrPayRetry') }}
            </DcButton>
          </template>
          <template v-else>
            <DcButton
              class="w-full"
              :disabled="selectedPlanId === null || purchasing"
              @click="handlePurchase"
            >
              <Spinner v-if="purchasing" class="mr-1 size-3" />
              {{ purchasing ? t('account.purchasing') : t('account.upgradeNow') }}
            </DcButton>
          </template>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 订阅协议弹窗（title 固定，只滚动内容） -->
    <Dialog v-model:open="showSubscriptionAgreement">
      <DialogContent class="max-w-2xl gap-0 p-0">
        <DialogHeader class="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>{{ subscriptionAgreementTitle }}</DialogTitle>
        </DialogHeader>
        <div class="max-h-[70vh] overflow-y-auto px-6 py-4">
          <div
            class="prose prose-sm max-w-none text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline"
            v-html="subscriptionAgreementContent"
          />
        </div>
      </DialogContent>
    </Dialog>

    <!-- 修改密码弹窗 -->
    <ResetPasswordDialog
      v-model:open="showChangePasswordDialog"
      mode="change"
      :initial-phone="user?.mobile || ''"
      :masked-phone="user?.maskedPhone || ''"
      @success="handlePasswordChanged"
    />
  </SettingsPageShell>
</template>

<script setup lang="ts">
import {
  createAuthClient,
  type Agreement,
  type AuthUser,
  type Plan,
  type Quota,
  type Subscription
} from '@api/AuthClient'
import { createWindowClient } from '@api/WindowClient'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import * as QRCode from 'qrcode'
import { DcButton } from '@dc-ui/components/button'
import { Icon } from '@iconify/vue'
import { Avatar, AvatarFallback } from '@shadcn/components/ui/avatar'
import { Badge } from '@shadcn/components/ui/badge'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import {
  AlertDialog,
  AlertDialogAsyncAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@shadcn/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Separator } from '@shadcn/components/ui/separator'
import { Spinner } from '@shadcn/components/ui/spinner'
import SettingsPageShell from './control-center/SettingsPageShell.vue'
import ResetPasswordDialog from '@/components/auth/ResetPasswordDialog.vue'

const { t } = useI18n()
const authClient = createAuthClient()
const windowClient = createWindowClient()

const loading = ref(true)
const loggingOut = ref(false)
const user = ref<AuthUser | null>(null)
const confirmAction = ref<'logout' | null>(null)
const quota = ref<Quota | null>(null)
const showChangePasswordDialog = ref(false)

// 订阅状态
const subscriptions = ref<Subscription[]>([])
const subscriptionsRealtime = ref(true)
const showSubscription = ref(false)
const plans = ref<Plan[]>([])
const plansLoading = ref(false)
const selectedPlanId = ref<number | null>(null)
const purchasing = ref(false)

// 支付渠道选择
type PaymentChannel = 'ALIPAY' | 'WECHAT'
const selectedPaymentChannel = ref<PaymentChannel>('WECHAT')

const paymentChannels: { value: PaymentChannel; label: string; icon: string }[] = [
  { value: 'ALIPAY', label: t('account.paymentAlipay'), icon: 'lucide:wallet' },
  { value: 'WECHAT', label: t('account.paymentWechat'), icon: 'lucide:message-circle' }
]

/** 二维码区标题：优先用本次下单选中的渠道，其次用返回结果中的渠道 */
const qrPayTitle = computed(() => {
  const channel = purchaseResult.value?.paymentChannel ?? selectedPaymentChannel.value
  return channel === 'WECHAT' ? t('account.qrPayWechatTitle') : t('account.qrPayAlipayTitle')
})

/** 二维码区描述：按渠道区分，支付宝/微信分别提示对应扫码方式 */
const qrPayDescription = computed(() => {
  const channel = purchaseResult.value?.paymentChannel ?? selectedPaymentChannel.value
  return channel === 'WECHAT' ? t('account.qrPayDescription') : t('account.qrPayAlipayDescription')
})

const purchaseResult = ref<{
  ok: boolean
  msg?: string | null
  orderNo?: string | null
  codeUrl?: string | null
  expireTime?: string | null
  paymentStatus?: string | null
  paymentChannel?: string | null
  grantStatus?: string | null
  subscriptionId?: number | null
  errorCode?: string | null
} | null>(null)

// 二维码支付流程
type PaymentPhase = 'idle' | 'qr_ready' | 'paid_pending' | 'active' | 'expired' | 'failed'
const paymentPhase = ref<PaymentPhase>('idle')
const qrCodeDataUrl = ref('')
const countdownSeconds = ref(0)
let pollTimer: ReturnType<typeof setInterval> | null = null
let countdownTimer: ReturnType<typeof setInterval> | null = null

// ---- 订阅协议勾选 ----
/** 订阅协议（SUBSCRIPTION 类型） */
const subscriptionAgreement = ref<Agreement | null>(null)
/** 是否已勾选订阅协议（勾选后才展示二维码） */
const agreeSubscription = ref(false)
/** 订阅协议弹窗开关 */
const showSubscriptionAgreement = ref(false)

/** 订阅协议标题：优先用接口返回，兜底 i18n */
const subscriptionAgreementTitle = computed(
  () => subscriptionAgreement.value?.title || t('account.qrPaySubscriptionAgreement')
)
/** 订阅协议正文（接口返回 HTML） */
const subscriptionAgreementContent = computed(() => subscriptionAgreement.value?.content ?? '')

/** 加载订阅协议（GET /agreements 中的 SUBSCRIPTION 类型） */
async function loadSubscriptionAgreement(): Promise<void> {
  try {
    const result = await authClient.getAgreements()
    if (result.ok && result.agreements) {
      subscriptionAgreement.value =
        result.agreements.find((a) => a.agreementType === 'SUBSCRIPTION') ?? null
    }
  } catch {
    subscriptionAgreement.value = null
  }
}

/** 发起购买前重置协议勾选 */
function resetAgreementState(): void {
  agreeSubscription.value = false
}

/** 订阅状态文案映射：服务端返回英文状态码，界面展示本地化文案 */
function subscriptionStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return t('account.subStatusActive')
    case 'expired':
      return t('account.subStatusExpired')
    case 'cancelled':
      return t('account.subStatusCancelled')
    default:
      return status
  }
}

/** 全部订阅：生效中的优先，其次按到期时间倒序 */
const sortedSubscriptions = computed(() =>
  [...subscriptions.value].sort((a, b) => {
    const activeDiff = (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)
    if (activeDiff !== 0) return activeDiff
    return new Date(b.endTime).getTime() - new Date(a.endTime).getTime()
  })
)

const accountActive = computed(
  () => !user.value?.accountStatus || user.value.accountStatus === 'ACTIVE'
)
const displayName = computed(
  () => user.value?.nickname || user.value?.maskedPhone || t('account.notSet')
)
const displayPhone = computed(
  () => user.value?.mobile || user.value?.maskedPhone || t('account.notSet')
)
const avatarInitial = computed(() => {
  const name = displayName.value.trim()
  return name ? name.slice(0, 1).toUpperCase() : '?'
})

/** 账户剩余额度（GET /quota） */
const quotaRemainingText = computed(() =>
  quota.value?.remainingQuota != null
    ? formatQuota(quota.value.remainingQuota)
    : t('account.notSet')
)

/** 账户已用额度（GET /quota） */
const quotaUsedText = computed(() =>
  quota.value?.usedQuota != null ? formatQuota(quota.value.usedQuota) : t('account.notSet')
)

/** NewAPI 原始额度换算系数：展示额度 = 原始值 / 500000（元） */
const NEWAPI_QUOTA_SCALE = 500000

/**
 * 额度展示：原始额度除以 NEWAPI_QUOTA_SCALE 折算为人民币金额；
 * zeroAsUnlimited 为 true 时 0 表示无限额度（仅套餐/订阅总额度适用，已使用/剩余额度显示 0）
 */
function formatQuota(n: number, zeroAsUnlimited = false): string {
  if (zeroAsUnlimited && n === 0) return t('account.quotaUnlimited')
  return `￥${(n / NEWAPI_QUOTA_SCALE).toLocaleString('en-US', { maximumFractionDigits: 4 })}`
}

/** 套餐时长单位映射：服务端返回英文单位，界面展示中文 */
const PLAN_DURATION_UNIT_LABELS: Record<string, string> = {
  month: '个月',
  day: '天',
  week: '周',
  quarter: '季度',
  year: '年'
}

/** 按 planType 归一化后的时长单位：MONTHLY→个月、QUARTERLY→季度、YEARLY→年 */
const PLAN_TYPE_DURATION_LABELS: Record<string, string> = {
  MONTHLY: '个月',
  QUARTERLY: '季度',
  YEARLY: '年'
}

/** 套餐有效期展示：优先按套餐类型归一化（1个月/1季度/1年）；兜底用 durationUnit */
function formatPlanDuration(plan: Plan): string {
  const typeUnit = PLAN_TYPE_DURATION_LABELS[plan.planType.trim().toUpperCase()]
  if (typeUnit) {
    return `1${typeUnit}`
  }
  const unit = PLAN_DURATION_UNIT_LABELS[plan.durationUnit] ?? plan.durationUnit
  return `${plan.durationValue || 1}${unit}`
}

// 套餐列表变化后，确保选中项仍属于当前列表
watch(plans, (list) => {
  if (list.length > 0 && !list.some((plan) => plan.planId === selectedPlanId.value)) {
    selectedPlanId.value = list[0]!.planId
  }
})

/** 限购展示：0 表示不限 */
function formatPurchaseLimit(plan: Plan): string {
  if (plan.maxPurchasePerUser <= 0) {
    return t('account.planPurchaseLimitUnlimited')
  }
  return t('account.planPurchaseLimitCount', { count: plan.maxPurchasePerUser })
}

/** 错误码 → 补充提示文案键 */
const PURCHASE_ERROR_HINT_KEYS: Record<string, string> = {
  TOKEN_INVALID: 'account.errTokenInvalid',
  ACCOUNT_NOT_READY: 'account.errAccountNotReady',
  PLAN_NOT_FOUND: 'account.errPlanNotFound',
  PLAN_NOT_AVAILABLE: 'account.errPlanNotAvailable',
  PLAN_PURCHASE_LIMIT_REACHED: 'account.errPlanPurchaseLimitReached',
  PLAN_PURCHASE_IN_PROGRESS: 'account.errPlanPurchaseInProgress',
  PURCHASE_REQUEST_CONFLICT: 'account.errPurchaseRequestConflict',
  PAYMENT_ORDER_EXPIRED: 'account.errPaymentOrderExpired',
  PAYMENT_ORDER_NOT_FOUND: 'account.errPaymentOrderNotFound',
  WECHAT_PAY_UNAVAILABLE: 'account.errPaymentChannelUnavailable',
  ALIPAY_PAY_UNAVAILABLE: 'account.errPaymentChannelUnavailable',
  SUBSCRIPTION_CREATE_FAILED: 'account.errSubscriptionCreateFailed',
  NEWAPI_UNAVAILABLE: 'account.errNewapiUnavailable',
  INVALID_ARGUMENT: 'account.errInvalidArgument',
  NETWORK_ERROR: 'account.errNetwork'
}

/** 购买失败时的补充提示（面向用户，主文案仍展示后端 msg） */
const purchaseErrorHint = computed(() => {
  const code = purchaseResult.value?.errorCode
  const key = code ? PURCHASE_ERROR_HINT_KEYS[code] : undefined
  return key ? t(key) : ''
})

/** 紧凑日期：YYYY-MM-DD */
function formatShortDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

/** 生成二维码 data URL */
async function generateQrCode(codeUrl: string): Promise<string> {
  return QRCode.toDataURL(codeUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 256
  })
}

/** 停止订单轮询 */
function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/** 停止倒计时 */
function stopCountdown(): void {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

/** 停止所有支付相关定时器 */
function stopTimers(): void {
  stopPolling()
  stopCountdown()
}

/** 启动倒计时 */
function startCountdown(expireTime: string): void {
  stopCountdown()
  const expireMs = new Date(expireTime).getTime()
  const update = () => {
    const remaining = Math.max(0, Math.floor((expireMs - Date.now()) / 1000))
    countdownSeconds.value = remaining
    if (remaining <= 0 && paymentPhase.value === 'qr_ready') {
      paymentPhase.value = 'expired'
      stopTimers()
      // 二维码过期：本次购买意图结束，下次购买生成新 requestId
      clearPurchaseIntent()
    }
  }
  update()
  countdownTimer = setInterval(update, 1000)
}

/** 是否存在进行中的订单（待扫码或已支付待开通） */
function hasPendingOrder(): boolean {
  return (
    !!purchaseResult.value?.orderNo &&
    (paymentPhase.value === 'qr_ready' || paymentPhase.value === 'paid_pending')
  )
}

/** 轮询订单状态（成功返回 true，表示已终态） */
async function pollOrderStatus(orderNo: string): Promise<boolean> {
  try {
    const result = await authClient.getOrder(orderNo)
    console.info('[Pay] order status:', orderNo, result)
    // 订单已过期：停止展示旧二维码，购买意图结束，重新购买时生成新 requestId
    if (result.errorCode === 'PAYMENT_ORDER_EXPIRED') {
      paymentPhase.value = 'expired'
      stopTimers()
      clearPurchaseIntent()
      return true
    }
    if (!result.ok || !result.paymentStatus) {
      console.warn('[Pay] order query returned no status:', result)
      return false
    }
    // 已支付 + 已开通 → 成功
    if (result.paymentStatus === 'PAID' && result.grantStatus === 'ACTIVE') {
      paymentPhase.value = 'active'
      stopTimers()
      clearPurchaseIntent()
      await loadSubscriptions()
      await loadQuota()
      return true
    }
    // 已支付但开通中/失败 → 展示处理中，继续查询
    if (result.paymentStatus === 'PAID') {
      paymentPhase.value = 'paid_pending'
      return false
    }
    // 仍待支付 → 恢复二维码状态
    if (paymentPhase.value === 'paid_pending') {
      paymentPhase.value = 'qr_ready'
    }
    return false
  } catch (error) {
    console.warn('[Pay] poll order failed:', error)
    return false
  }
}

/** 启动轮询 */
function startPolling(orderNo: string): void {
  stopPolling()
  // 首次立即查询
  void pollOrderStatus(orderNo)
  pollTimer = setInterval(() => {
    void pollOrderStatus(orderNo)
  }, 4000)
}

/** 窗口重新可见时立即查询一次，补偿后台定时器节流 */
function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') {
    const orderNo = purchaseResult.value?.orderNo
    if (orderNo && (paymentPhase.value === 'qr_ready' || paymentPhase.value === 'paid_pending')) {
      void pollOrderStatus(orderNo)
    }
  }
}

/** 取消支付，回到选择套餐状态 */
function cancelPayment(): void {
  stopTimers()
  paymentPhase.value = 'idle'
  purchaseResult.value = null
  qrCodeDataUrl.value = ''
  countdownSeconds.value = 0
}

// ---- requestId 幂等（按文档：超时/重试复用原值，购买意图结束时清除，换套餐/渠道生成新值） ----

interface StoredPurchaseIntent {
  requestId: string
  planId: number
  paymentChannel: PaymentChannel
}

const PURCHASE_INTENT_KEY = 'mio.purchase.intent'

function loadPurchaseIntent(): StoredPurchaseIntent | null {
  try {
    const raw = localStorage.getItem(PURCHASE_INTENT_KEY)
    return raw ? (JSON.parse(raw) as StoredPurchaseIntent) : null
  } catch {
    return null
  }
}

function savePurchaseIntent(intent: StoredPurchaseIntent): void {
  try {
    localStorage.setItem(PURCHASE_INTENT_KEY, JSON.stringify(intent))
  } catch {
    // 忽略：持久化失败不影响下单
  }
}

function clearPurchaseIntent(): void {
  try {
    localStorage.removeItem(PURCHASE_INTENT_KEY)
  } catch {
    // 忽略
  }
}

/** 获取本次购买意图的 requestId：同一套餐+渠道复用原值（超时重试），否则生成新值 */
function getOrCreateRequestId(planId: number, channel: PaymentChannel): string {
  const intent = loadPurchaseIntent()
  if (intent && intent.planId === planId && intent.paymentChannel === channel) {
    return intent.requestId
  }
  const requestId = `purchase_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  savePurchaseIntent({ requestId, planId, paymentChannel: channel })
  return requestId
}

/** 用户主动取消支付：明确结束本次购买意图，下次购买生成新 requestId */
function cancelPaymentIntent(): void {
  clearPurchaseIntent()
  cancelPayment()
}

/** 支付成功后关闭弹窗 */
function closeSubscription(): void {
  showSubscription.value = false
  cancelPayment()
}

async function openSubscription() {
  showSubscription.value = true
  // 已有进行中的订单时保留其状态（二维码与轮询），避免丢失支付结果
  if (!hasPendingOrder()) {
    cancelPayment()
  }
  await loadPlans()
  await loadSubscriptionAgreement()
}

async function loadPlans() {
  plansLoading.value = true
  try {
    const result = await authClient.getPlans()
    if (result.ok && result.plans) {
      plans.value = result.plans
      if (plans.value.length > 0 && selectedPlanId.value === null) {
        selectedPlanId.value = plans.value[0]!.planId
      }
    } else {
      plans.value = []
    }
  } catch {
    plans.value = []
  } finally {
    plansLoading.value = false
  }
}

async function loadSubscriptions() {
  try {
    const result = await authClient.getSubscriptions()
    if (result.ok && result.items) {
      subscriptions.value = result.items
      subscriptionsRealtime.value = result.realtime ?? true
    }
  } catch {
    // 静默失败，保留旧数据
  }
}

/** 加载账户额度（GET /quota） */
async function loadQuota() {
  try {
    const result = await authClient.getQuota()
    if (result.ok && result.quota) {
      quota.value = result.quota
    }
  } catch {
    // 静默失败，保留旧数据
  }
}

/** 发起购买：校验选中套餐并走支付流程 */
async function handlePurchase() {
  if (selectedPlanId.value === null || purchasing.value) return
  purchasing.value = true
  stopTimers()
  purchaseResult.value = null
  qrCodeDataUrl.value = ''
  countdownSeconds.value = 0
  paymentPhase.value = 'idle'
  resetAgreementState()
  const planId = selectedPlanId.value
  const channel = selectedPaymentChannel.value
  const requestId = getOrCreateRequestId(planId, channel)
  try {
    const result = await authClient.purchasePlan(planId, requestId, channel)
    purchaseResult.value = result
    if (!result.ok) {
      paymentPhase.value = 'failed'
      // 订单过期 / requestId 冲突：本次购买意图已失效，下次购买生成新值
      if (
        result.errorCode === 'PAYMENT_ORDER_EXPIRED' ||
        result.errorCode === 'PURCHASE_REQUEST_CONFLICT'
      ) {
        clearPurchaseIntent()
      }
    } else if (result.paymentStatus === 'PAID' && result.grantStatus === 'ACTIVE') {
      // 直接购买成功（无需扫码）
      paymentPhase.value = 'active'
      clearPurchaseIntent()
      await loadSubscriptions()
      await loadQuota()
    } else if (result.codeUrl && result.expireTime) {
      // 需要扫码支付
      paymentPhase.value = 'qr_ready'
      qrCodeDataUrl.value = await generateQrCode(result.codeUrl)
      startCountdown(result.expireTime)
      if (result.orderNo) {
        startPolling(result.orderNo)
      }
    } else {
      // 无 codeUrl 但仍在处理中
      paymentPhase.value = 'paid_pending'
      if (result.orderNo) {
        startPolling(result.orderNo)
      }
    }
  } catch (error) {
    purchaseResult.value = { ok: false, msg: String(error) }
    paymentPhase.value = 'failed'
  } finally {
    purchasing.value = false
  }
}

async function doLogout() {
  if (loggingOut.value) return
  loggingOut.value = true
  try {
    await authClient.logout()
    await windowClient.closeSettings()
  } catch (error) {
    console.error('[AccountSettings] Logout failed:', error)
    loggingOut.value = false
    confirmAction.value = null
  }
}

/** 修改密码成功后，服务端已吊销全部会话，退出设置并回到登录页 */
async function handlePasswordChanged() {
  try {
    await authClient.logout()
  } catch {
    // 忽略：服务端已吊销会话，本地登出只是清理
  }
  await windowClient.closeSettings()
}

// 弹窗关闭时：没有进行中的订单才停掉定时器；
// 有订单则保留轮询和倒计时，用户关闭二维码后再完成支付时账号页也能自动刷新套餐
watch(showSubscription, (open) => {
  if (!open && !hasPendingOrder()) {
    stopTimers()
  }
})

onMounted(async () => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
  try {
    const result = await authClient.getAccount()
    user.value = result.authenticated ? result.user : null
  } catch (error) {
    console.error('[AccountSettings] Failed to load account info:', error)
  } finally {
    loading.value = false
  }
  // 后台刷新最新资料（GET /users/me），失败时保留本地缓存
  try {
    const fresh = await authClient.getMe()
    if (fresh) {
      user.value = fresh
    }
  } catch {
    // 忽略
  }
  // 加载订阅信息
  await loadSubscriptions()
  // 加载账户额度
  await loadQuota()
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  stopTimers()
})
</script>

<style scoped>
/* 套餐描述为富文本编辑器输出的 HTML，约束子元素样式保持卡片内紧凑展示 */
.plan-content :deep(p) {
  margin: 0.25rem 0;
}

.plan-content :deep(ul),
.plan-content :deep(ol) {
  margin: 0.25rem 0;
  padding-left: 1.25rem;
}

.plan-content :deep(ul) {
  list-style: disc;
}

.plan-content :deep(ol) {
  list-style: decimal;
}

.plan-content :deep(h1),
.plan-content :deep(h2),
.plan-content :deep(h3) {
  margin: 0.25rem 0;
  font-size: inherit;
  font-weight: 600;
}

.plan-content :deep(img) {
  max-width: 100%;
}
</style>
