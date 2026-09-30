<template>
  <div class="relative h-full w-full flex flex-col window-drag-region">
    <div class="flex-1 flex flex-col items-center justify-center px-6">
      <!-- Logo -->
      <div class="mb-5">
        <img src="@/assets/logo.png" class="w-16 h-16" loading="lazy" />
      </div>

      <!-- Heading -->
      <h1 class="text-3xl font-semibold text-foreground mb-10">
        {{ t('login.title') }}
      </h1>

      <!-- Login card -->
      <form
        data-testid="login-form"
        class="w-full max-w-sm rounded-2xl border border-border/70 bg-card/50 px-6 py-6 shadow-sm"
        @submit.prevent="handleSubmit"
      >
        <div class="flex flex-col gap-4">
          <!-- 登录方式切换（置于输入框上方） -->
          <div class="flex rounded-lg border border-border/60 p-1">
            <button
              type="button"
              :class="[
                'flex-1 rounded-md px-3 py-1.5 text-sm transition-colors',
                mode === 'code'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              ]"
              @click="switchMode('code')"
            >
              {{ t('login.tabSms') }}
            </button>
            <button
              type="button"
              :class="[
                'flex-1 rounded-md px-3 py-1.5 text-sm transition-colors',
                mode === 'password'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              ]"
              @click="switchMode('password')"
            >
              {{ t('login.tabPassword') }}
            </button>
          </div>

          <!-- 手机号 -->
          <div class="flex flex-col gap-2">
            <Label for="login-phone" class="text-xs text-muted-foreground">
              {{ t('login.phone') }}
            </Label>
            <Input
              id="login-phone"
              v-model="phone"
              type="tel"
              maxlength="11"
              placeholder="请输入手机号"
              data-testid="login-phone-input"
              required
            />
          </div>

          <!-- 验证码（手机号登录模式） -->
          <div v-if="mode === 'code'" class="flex flex-col gap-2">
            <Label for="login-code" class="text-xs text-muted-foreground">
              {{ t('login.code') }}
            </Label>
            <div class="flex gap-2">
              <Input
                id="login-code"
                v-model="code"
                maxlength="6"
                placeholder="请输入验证码"
                data-testid="login-code-input"
                class="flex-1"
                required
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                class="shrink-0"
                :disabled="countdown > 0 || sendingCode"
                @click="handleSendCode"
              >
                {{ countdown > 0 ? `${countdown}s` : t('login.getCode') }}
              </Button>
            </div>
          </div>

          <!-- 密码（账密登录模式） -->
          <div v-else class="flex flex-col gap-2">
            <Label for="login-password" class="text-xs text-muted-foreground">
              {{ t('login.password') }}
            </Label>
            <Input
              id="login-password"
              v-model="password"
              type="password"
              autocomplete="current-password"
              placeholder="请输入密码"
              data-testid="login-password-input"
              required
            />
            <!-- 找回密码入口（仅账密登录模式） -->
            <div class="text-right">
              <button
                type="button"
                class="text-xs text-primary hover:underline"
                @click="showResetDialog = true"
              >
                {{ t('login.forgotPassword') }}
              </button>
            </div>
          </div>

          <p v-if="errorMessage" data-testid="login-error" class="text-xs text-destructive">
            {{ errorMessage }}
          </p>

          <Button type="submit" class="w-full" data-testid="login-submit" :disabled="submitting">
            <Spinner v-if="submitting" class="h-4 w-4" />
            <span>{{ submitting ? t('login.submitting') : submitButtonText }}</span>
          </Button>

          <!-- 协议勾选 -->
          <div class="flex items-start gap-2">
            <Checkbox id="login-agree" v-model:checked="agreed" class="mt-0.5" />
            <label for="login-agree" class="text-xs text-muted-foreground leading-relaxed">
              {{ t('login.agreePrefix') }}
              <button
                type="button"
                class="text-primary hover:underline"
                @click.prevent.stop="openAgreement('USER')"
              >
                {{ t('login.userAgreement') }}
              </button>
              {{ t('login.and') }}
              <button
                type="button"
                class="text-primary hover:underline"
                @click.prevent.stop="openAgreement('PRIVACY')"
              >
                {{ t('login.privacyAgreement') }}
              </button>
            </label>
          </div>
        </div>
      </form>
    </div>

    <!-- 协议弹窗 -->
    <Dialog v-model:open="showAgreement">
      <DialogContent class="max-w-2xl gap-0 p-0">
        <DialogHeader class="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>{{ currentAgreementTitle }}</DialogTitle>
        </DialogHeader>
        <div class="max-h-[70vh] overflow-y-auto px-6 py-4">
          <div
            class="prose prose-sm max-w-none text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline"
            v-html="currentAgreementContent"
          />
        </div>
      </DialogContent>
    </Dialog>

    <!-- 找回密码弹窗 -->
    <ResetPasswordDialog v-model:open="showResetDialog" mode="forgot" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shadcn/components/ui/dialog'
import { createAuthClient } from '@api/AuthClient'
import type { Agreement } from '@api/AuthClient'
import { setAuthState } from '@/router'
import ResetPasswordDialog from '@/components/auth/ResetPasswordDialog.vue'

const emit = defineEmits<{
  authenticated: []
}>()

const { t } = useI18n()
const router = useRouter()
const authClient = createAuthClient()

type LoginMode = 'password' | 'code'
const mode = ref<LoginMode>('code')
const phone = ref('')
const password = ref('')
const code = ref('')
const smsRequestId = ref('')
const submitting = ref(false)
const sendingCode = ref(false)
const errorMessage = ref('')
const countdown = ref(0)
const showResetDialog = ref(false)
const agreed = ref(false)
const agreements = ref<Agreement[]>([])
const showAgreement = ref(false)
const activeAgreementType = ref<'USER' | 'PRIVACY'>('USER')
let timer: ReturnType<typeof setInterval> | null = null

const agreementTitleMap: Record<string, string> = {
  USER: 'login.userAgreement',
  PRIVACY: 'login.privacyAgreement'
}

const currentAgreement = computed(() =>
  agreements.value.find((a) => a.agreementType === activeAgreementType.value)
)

const currentAgreementTitle = computed(() => {
  const key = agreementTitleMap[activeAgreementType.value]
  return key ? t(key) : ''
})

const currentAgreementContent = computed(() => currentAgreement.value?.content ?? '')

const submitButtonText = computed(() =>
  mode.value === 'password' ? t('login.submit') : t('login.submitLoginRegister')
)

function openAgreement(type: 'USER' | 'PRIVACY') {
  activeAgreementType.value = type
  showAgreement.value = true
}

onMounted(() => {
  phone.value = ''
  authClient
    .getAgreements()
    .then((result) => {
      if (result.ok && result.agreements) {
        agreements.value = result.agreements
      }
    })
    .catch((error) => {
      console.error('Failed to load agreements:', error)
    })
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

function switchMode(target: LoginMode) {
  if (mode.value === target) return
  mode.value = target
  errorMessage.value = ''
  code.value = ''
  password.value = ''
  smsRequestId.value = ''
}

function startCountdown(seconds = 60) {
  countdown.value = seconds
  timer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }, 1000)
}

async function handleSendCode() {
  if (!/^1[3-9]\d{9}$/.test(phone.value)) {
    errorMessage.value = '请输入有效的手机号'
    return
  }
  sendingCode.value = true
  errorMessage.value = ''
  try {
    const result = await authClient.sendCode(phone.value, 'LOGIN')
    if (result.ok) {
      smsRequestId.value = result.smsRequestId ?? ''
      startCountdown(result.retryAfterSeconds ?? 60)
    } else {
      errorMessage.value = result.msg || '验证码发送失败'
    }
  } catch {
    errorMessage.value = '验证码发送失败，请重试'
  } finally {
    sendingCode.value = false
  }
}

async function handleSubmit() {
  if (submitting.value) return
  if (!/^1[3-9]\d{9}$/.test(phone.value)) {
    errorMessage.value = '请输入有效的手机号'
    return
  }
  if (!agreed.value) {
    errorMessage.value = t('login.errorNotAgreed')
    return
  }
  submitting.value = true
  errorMessage.value = ''
  try {
    let result: { ok: boolean; msg?: string }
    if (mode.value === 'password') {
      result = await authClient.login(phone.value, password.value)
    } else {
      result = await authClient.loginByCode(phone.value, smsRequestId.value, code.value)
    }
    if (result.ok) {
      setAuthState(true)
      emit('authenticated')
      await router.replace({ name: 'chat' })
    } else {
      errorMessage.value = result.msg || t('login.error')
    }
  } catch {
    errorMessage.value = t('login.error')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.window-drag-region {
  -webkit-app-region: drag;
}

form,
button,
input {
  -webkit-app-region: no-drag;
}
</style>
