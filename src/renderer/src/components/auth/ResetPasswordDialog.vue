<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent class="max-w-sm">
      <DialogHeader>
        <DialogTitle>{{ titleText }}</DialogTitle>
        <DialogDescription>{{ descriptionText }}</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="handleSubmit">
        <!-- 手机号 -->
        <div class="flex flex-col gap-2">
          <Label for="reset-phone" class="text-xs text-muted-foreground">
            {{ t('resetPassword.phone') }}
          </Label>
          <!-- change 模式：只读展示脱敏号 -->
          <Input
            v-if="mode === 'change'"
            id="reset-phone"
            :model-value="maskedPhone || initialPhone || ''"
            type="tel"
            disabled
            data-testid="reset-password-phone"
          />
          <!-- forgot 模式：可编辑 -->
          <Input
            v-else
            id="reset-phone"
            v-model="phone"
            type="tel"
            maxlength="11"
            :placeholder="t('resetPassword.phonePlaceholder')"
            data-testid="reset-password-phone"
            required
          />
        </div>

        <!-- 验证码 -->
        <div class="flex flex-col gap-2">
          <Label for="reset-code" class="text-xs text-muted-foreground">
            {{ t('resetPassword.code') }}
          </Label>
          <div class="flex gap-2">
            <Input
              id="reset-code"
              v-model="code"
              maxlength="6"
              :placeholder="t('resetPassword.codePlaceholder')"
              class="flex-1"
              data-testid="reset-password-code"
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
              {{ countdown > 0 ? `${countdown}s` : t('resetPassword.getCode') }}
            </Button>
          </div>
        </div>

        <!-- 新密码 -->
        <div class="flex flex-col gap-2">
          <Label for="reset-new-password" class="text-xs text-muted-foreground">
            {{ t('resetPassword.newPassword') }}
          </Label>
          <Input
            id="reset-new-password"
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            :placeholder="t('resetPassword.newPasswordPlaceholder')"
            data-testid="reset-password-new"
            required
          />
        </div>

        <!-- 确认密码 -->
        <div class="flex flex-col gap-2">
          <Label for="reset-confirm" class="text-xs text-muted-foreground">
            {{ t('resetPassword.confirmPassword') }}
          </Label>
          <Input
            id="reset-confirm"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            :placeholder="t('resetPassword.confirmPlaceholder')"
            data-testid="reset-password-confirm"
            required
          />
        </div>

        <p v-if="errorMessage" data-testid="reset-password-error" class="text-xs text-destructive">
          {{ errorMessage }}
        </p>

        <p
          v-if="successMessage"
          data-testid="reset-password-success"
          class="text-xs text-green-600"
        >
          {{ successMessage }}
        </p>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            :disabled="submitting"
            @click="$emit('update:open', false)"
          >
            {{ t('resetPassword.cancel') }}
          </Button>
          <Button type="submit" :disabled="submitting" data-testid="reset-password-submit">
            <Spinner v-if="submitting" class="h-4 w-4" />
            <span>{{ submitting ? t('resetPassword.submitting') : submitButtonText }}</span>
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Spinner } from '@shadcn/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { createAuthClient } from '@api/AuthClient'

const props = withDefaults(
  defineProps<{
    open: boolean
    /** forgot = 找回密码（未登录）；change = 修改密码（已登录，携带 Token） */
    mode?: 'forgot' | 'change'
    /** change 模式下展示的完整手机号（后端有则传） */
    initialPhone?: string
    /** change 模式下展示的脱敏手机号 */
    maskedPhone?: string
  }>(),
  { mode: 'forgot', initialPhone: '', maskedPhone: '' }
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  success: []
}>()

const { t } = useI18n()
const authClient = createAuthClient()

const phone = ref('')
const code = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const smsRequestId = ref('')
const submitting = ref(false)
const sendingCode = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const countdown = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

const titleText = computed(() =>
  props.mode === 'change' ? t('resetPassword.changeTitle') : t('resetPassword.forgotTitle')
)

const descriptionText = computed(() =>
  props.mode === 'change'
    ? t('resetPassword.changeDescription')
    : t('resetPassword.forgotDescription')
)

const submitButtonText = computed(() =>
  props.mode === 'change' ? t('resetPassword.changeSubmit') : t('resetPassword.forgotSubmit')
)

const isChangeMode = computed(() => props.mode === 'change')

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      phone.value = ''
      code.value = ''
      newPassword.value = ''
      confirmPassword.value = ''
      smsRequestId.value = ''
      errorMessage.value = ''
      successMessage.value = ''
      countdown.value = 0
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }
)

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

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
  if (!isChangeMode.value && !/^1[3-9]\d{9}$/.test(phone.value)) {
    errorMessage.value = t('resetPassword.errorPhone')
    return
  }
  sendingCode.value = true
  errorMessage.value = ''
  try {
    const result = await authClient.sendCode(
      isChangeMode.value ? '' : phone.value,
      'RESET_PASSWORD',
      isChangeMode.value
    )
    if (result.ok) {
      smsRequestId.value = result.smsRequestId ?? ''
      startCountdown(result.retryAfterSeconds ?? 60)
    } else {
      errorMessage.value = result.msg || t('resetPassword.errorCodeSent')
    }
  } catch {
    errorMessage.value = t('resetPassword.errorCodeSent')
  } finally {
    sendingCode.value = false
  }
}

async function handleSubmit() {
  if (submitting.value) return
  if (!isChangeMode.value && !/^1[3-9]\d{9}$/.test(phone.value)) {
    errorMessage.value = t('resetPassword.errorPhone')
    return
  }
  if (newPassword.value.length < 8) {
    errorMessage.value = t('resetPassword.errorPasswordTooShort')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    errorMessage.value = t('resetPassword.errorPasswordMismatch')
    return
  }
  if (!code.value) {
    errorMessage.value = t('resetPassword.errorCodeRequired')
    return
  }
  submitting.value = true
  errorMessage.value = ''
  successMessage.value = ''
  try {
    const result = await authClient.resetPassword({
      mobile: isChangeMode.value ? undefined : phone.value,
      smsRequestId: smsRequestId.value,
      smsCode: code.value,
      newPassword: newPassword.value,
      authenticated: isChangeMode.value
    })
    if (result.ok) {
      successMessage.value = t('resetPassword.success')
      emit('success')
      setTimeout(() => emit('update:open', false), 1500)
    } else {
      errorMessage.value = result.msg || t('resetPassword.error')
      if (result.errorCode === 'SMS_CODE_INVALID') {
        smsRequestId.value = ''
      }
    }
  } catch {
    errorMessage.value = t('resetPassword.error')
  } finally {
    submitting.value = false
  }
}
</script>
