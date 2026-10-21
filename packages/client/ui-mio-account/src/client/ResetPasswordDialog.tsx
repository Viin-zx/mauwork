/** SMS-authorized password reset dialog. */
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  MioResetPasswordRequest, MioSmsCode, MioSmsCodeRequest,
} from '@deepseek-ai/dsh-mio-account/types'
import { accountMessage, MioAccountClientError } from './operations.ts'
import type { MioAccountKey } from './locales.ts'
import css from './LoginGate.module.css'

const COUNTRY_CODE = '+86'
const PHONE_PATTERN = /^1[3-9]\d{9}$/
const MIN_PASSWORD_LENGTH = 8
const DEFAULT_COUNTDOWN_SECONDS = 60

/** Copy and actions the reset dialog renders. */
export interface ResetPasswordDialogProps {
  /** Whether the dialog is showing. */
  open: boolean
  /** Close the dialog. */
  onClose: () => void
  /** Request a code for the `RESET_PASSWORD` scene. */
  readonly sendSmsCode: (request: MioSmsCodeRequest) => Promise<MioSmsCode>
  /** Replace the forgotten password. */
  readonly resetPassword: (request: MioResetPasswordRequest) => Promise<void>
  /** Localized copy. */
  t: (key: MioAccountKey) => string
  /** `reset` recovers a forgotten password; `change` replaces a known one. */
  mode?: 'reset' | 'change'
  /** Bound phone shown read-only in `change` mode. */
  maskedPhone?: string
  /** Runs after the backend accepts the new password. */
  onSuccess?: () => void
}

/**
 * Render the phone, SMS code, and new-password fields.
 * @param props - visibility, account actions, and localized copy.
 * @returns the reset dialog.
 */
export function ResetPasswordDialog({
  open, onClose, sendSmsCode, resetPassword, t, mode = 'reset', maskedPhone = '', onSuccess,
}: ResetPasswordDialogProps) {
  const changing = mode === 'change'
  const title = changing ? t('changePasswordTitle') : t('resetTitle')
  const description = changing ? t('changePasswordDescription') : t('resetDescription')
  const successCopy = changing ? t('changePasswordSuccess') : t('resetSuccess')
  const submitCopy = changing ? t('changePasswordSubmit') : t('resetSubmit')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [smsRequestId, setSmsRequestId] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (!open) return
    setPhone('')
    setCode('')
    setNewPassword('')
    setConfirmPassword('')
    setSmsRequestId('')
    setCountdown(0)
    setError('')
    setSuccess('')
  }, [open])

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => { setCountdown(value => value - 1) }, 1000)
    return () => { clearTimeout(timer) }
  }, [countdown])

  useEffect(() => {
    if (success === '') return
    const timer = setTimeout(onClose, 1500)
    return () => { clearTimeout(timer) }
  }, [success, onClose])

  const requestCode = async (): Promise<void> => {
    if (!changing && !PHONE_PATTERN.test(phone)) {
      setError(t('invalidPhone'))
      return
    }
    setSending(true)
    setError('')
    try {
      const issued = await sendSmsCode({
        countryCode: COUNTRY_CODE,
        mobile: changing ? '' : phone,
        scene: 'RESET_PASSWORD',
        ...changing ? { authenticated: true } : {},
      })
      setSmsRequestId(issued.smsRequestId)
      setCountdown(issued.retryAfterSeconds > 0 ? issued.retryAfterSeconds : DEFAULT_COUNTDOWN_SECONDS)
    } catch (failure) {
      setError(accountMessage(failure, t('errorCodeSent')))
    } finally {
      setSending(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting || success !== '') return
    if (!changing && !PHONE_PATTERN.test(phone)) {
      setError(t('invalidPhone'))
      return
    }
    if (code === '') {
      setError(t('errorCodeRequired'))
      return
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(t('errorPasswordShort'))
      return
    }
    if (newPassword !== confirmPassword) {
      setError(t('errorPasswordMismatch'))
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await resetPassword({
        countryCode: COUNTRY_CODE,
        mobile: changing ? '' : phone,
        smsRequestId,
        smsCode: code,
        newPassword,
        ...changing ? { authenticated: true } : {},
      })
      setSuccess(successCopy)
      onSuccess?.()
    } catch (failure) {
      if (failure instanceof MioAccountClientError && failure.code === 'SMS_CODE_INVALID') setSmsRequestId('')
      setError(accountMessage(failure, t('errorReset')))
    } finally {
      setSubmitting(false)
    }
  }

  return <Modal open={open} title={title} description={description}
    closeLabel={t('close')} onClose={onClose}>
    <form className={css.form} data-testid="mio-reset-form" onSubmit={(event) => { void submit(event) }} noValidate>
      <div className={css.field}>
        <label className={css.label} htmlFor="mio-reset-phone">{t('phone')}</label>
        <Input id="mio-reset-phone" type="tel" inputMode="numeric" autoComplete="tel" maxLength={11}
          placeholder={changing ? '' : t('phonePlaceholder')}
          value={changing ? maskedPhone : phone} disabled={changing}
          onChange={(event) => { if (!changing) setPhone(event.target.value) }} />
      </div>
      <div className={css.field}>
        <label className={css.label} htmlFor="mio-reset-code">{t('code')}</label>
        <div className={css.codeRow}>
          <span className={css.codeInput}>
            <Input id="mio-reset-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              placeholder={t('codePlaceholder')} value={code}
              onChange={(event) => { setCode(event.target.value) }} />
          </span>
          <Button type="button" variant="outline" size="sm" disabled={countdown > 0 || sending}
            onClick={() => { void requestCode() }}>
            {countdown > 0 ? `${countdown}s` : t('getCode')}
          </Button>
        </div>
      </div>
      <div className={css.field}>
        <label className={css.label} htmlFor="mio-reset-password">{t('newPassword')}</label>
        <Input id="mio-reset-password" type="password" autoComplete="new-password"
          placeholder={t('newPasswordPlaceholder')} value={newPassword}
          onChange={(event) => { setNewPassword(event.target.value) }} />
      </div>
      <div className={css.field}>
        <label className={css.label} htmlFor="mio-reset-confirm">{t('confirmPassword')}</label>
        <Input id="mio-reset-confirm" type="password" autoComplete="new-password"
          placeholder={t('confirmPlaceholder')} value={confirmPassword}
          onChange={(event) => { setConfirmPassword(event.target.value) }} />
      </div>
      {error !== '' && <p className={css.error} role="alert">{error}</p>}
      {success !== '' && <p className={css.success} role="status">{success}</p>}
      <div className={css.actions}>
        <Button variant="outline" disabled={submitting} onClick={onClose}>{t('cancel')}</Button>
        <Button type="submit" variant="primary" disabled={submitting || success !== ''}>
          {submitting ? t('resetSubmitting') : submitCopy}
        </Button>
      </div>
    </form>
  </Modal>
}
