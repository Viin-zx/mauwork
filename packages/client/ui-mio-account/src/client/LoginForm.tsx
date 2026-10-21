/** SMS and password login form with agreements and password recovery. */
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  MioAccountView, MioAgreement, MioPasswordLoginRequest, MioResetPasswordRequest, MioSmsCode,
  MioSmsCodeRequest, MioSmsLoginRequest,
} from '@deepseek-ai/dsh-mio-account/types'
import { accountMessage, MioAccountClientError } from './operations.ts'
import type { MioAccountKey } from './locales.ts'
import { ResetPasswordDialog } from './ResetPasswordDialog.tsx'
import css from './LoginGate.module.css'

const COUNTRY_CODE = '+86'
const PHONE_PATTERN = /^1[3-9]\d{9}$/
const DEFAULT_COUNTDOWN_SECONDS = 60
type LoginMode = 'sms' | 'password'
type AgreementType = 'USER' | 'PRIVACY'

/** Account actions and copy the login form renders. */
export interface LoginFormProps {
  /** True when the Host rejected or expired the previous session. */
  expired: boolean
  readonly sendSmsCode: (request: MioSmsCodeRequest) => Promise<MioSmsCode>
  readonly loginWithSms: (request: MioSmsLoginRequest) => Promise<MioAccountView>
  readonly loginWithPassword: (request: MioPasswordLoginRequest) => Promise<MioAccountView>
  readonly resetPassword: (request: MioResetPasswordRequest) => Promise<void>
  readonly getAgreements: () => Promise<readonly MioAgreement[]>
  t: (key: MioAccountKey) => string
}

/**
 * Render the login card.
 * @param props - account actions, expiry notice, and localized copy.
 * @returns the two-mode login form.
 */
export function LoginForm({
  expired, sendSmsCode, loginWithSms, loginWithPassword, resetPassword, getAgreements, t,
}: LoginFormProps) {
  const [mode, setMode] = useState<LoginMode>('sms')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [smsRequestId, setSmsRequestId] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [agreements, setAgreements] = useState<readonly MioAgreement[]>([])
  const [agreementType, setAgreementType] = useState<AgreementType | null>(null)
  const [resetOpen, setResetOpen] = useState(false)

  useEffect(() => {
    let active = true
    void getAgreements().then((items) => {
      if (active) setAgreements(items)
    }).catch(() => undefined)
    return () => { active = false }
  }, [getAgreements])

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => { setCountdown(value => value - 1) }, 1000)
    return () => { clearTimeout(timer) }
  }, [countdown])

  const switchMode = (next: LoginMode): void => {
    if (mode === next) return
    setMode(next)
    setCode('')
    setPassword('')
    setSmsRequestId('')
    setError('')
  }

  const requestCode = async (): Promise<void> => {
    if (!PHONE_PATTERN.test(phone)) {
      setError(t('invalidPhone'))
      return
    }
    setSending(true)
    setError('')
    try {
      const issued = await sendSmsCode({ countryCode: COUNTRY_CODE, mobile: phone, scene: 'LOGIN' })
      setSmsRequestId(issued.smsRequestId)
      setCountdown(issued.retryAfterSeconds > 0 ? issued.retryAfterSeconds : DEFAULT_COUNTDOWN_SECONDS)
    } catch (failure) {
      setError(accountMessage(failure, t('error')))
    } finally {
      setSending(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    if (!PHONE_PATTERN.test(phone)) {
      setError(t('invalidPhone'))
      return
    }
    if (!agreed) {
      setError(t('errorNotAgreed'))
      return
    }
    if (mode === 'sms' && code === '') {
      setError(t('errorCodeRequired'))
      return
    }
    if (mode === 'password' && password === '') {
      setError(t('errorPasswordRequired'))
      return
    }
    setSubmitting(true)
    setError('')
    try {
      if (mode === 'sms') {
        await loginWithSms({
          countryCode: COUNTRY_CODE,
          mobile: phone,
          smsRequestId,
          smsCode: code,
        })
      } else {
        await loginWithPassword({ countryCode: COUNTRY_CODE, mobile: phone, password })
      }
    } catch (failure) {
      if (failure instanceof MioAccountClientError && failure.code === 'SMS_CODE_INVALID') setSmsRequestId('')
      setError(accountMessage(failure, t('error')))
    } finally {
      setSubmitting(false)
    }
  }

  const agreement = agreementType === null
    ? undefined
    : agreements.find(item => item.agreementType === agreementType)

  return <>
    <form className={css.card} data-testid="mio-login-form" onSubmit={(event) => { void submit(event) }} noValidate>
      {expired && <p className={css.expired} role="status">{t('sessionExpired')}</p>}
      <div className={css.tabs} role="tablist" aria-label={t('title')}>
        <button type="button" role="tab" aria-selected={mode === 'sms'} data-active={mode === 'sms'}
          className={css.tab} onClick={() => { switchMode('sms') }}>{t('tabSms')}</button>
        <button type="button" role="tab" aria-selected={mode === 'password'} data-active={mode === 'password'}
          className={css.tab} onClick={() => { switchMode('password') }}>{t('tabPassword')}</button>
      </div>
      <div className={css.field}>
        <label className={css.label} htmlFor="mio-login-phone">{t('phone')}</label>
        <Input id="mio-login-phone" data-testid="mio-login-phone" type="tel" inputMode="numeric"
          autoComplete="tel" maxLength={11} placeholder={t('phonePlaceholder')} value={phone}
          onChange={(event) => { setPhone(event.target.value) }} />
      </div>
      {mode === 'sms' ? <div className={css.field}>
        <label className={css.label} htmlFor="mio-login-code">{t('code')}</label>
        <div className={css.codeRow}>
          <span className={css.codeInput}>
            <Input id="mio-login-code" data-testid="mio-login-code" inputMode="numeric"
              autoComplete="one-time-code" maxLength={6} placeholder={t('codePlaceholder')} value={code}
              onChange={(event) => { setCode(event.target.value) }} />
          </span>
          <Button type="button" variant="outline" size="sm" disabled={countdown > 0 || sending}
            data-testid="mio-login-code-send" onClick={() => { void requestCode() }}>
            {countdown > 0 ? `${countdown}s` : t('getCode')}
          </Button>
        </div>
      </div> : <div className={css.field}>
        <label className={css.label} htmlFor="mio-login-password">{t('password')}</label>
        <Input id="mio-login-password" data-testid="mio-login-password" type="password"
          autoComplete="current-password" placeholder={t('passwordPlaceholder')} value={password}
          onChange={(event) => { setPassword(event.target.value) }} />
        <div className={css.fieldAction}>
          <button type="button" className={css.link}
            onClick={() => { setResetOpen(true) }}>{t('forgotPassword')}</button>
        </div>
      </div>}
      {error !== '' && <p className={css.error} role="alert" data-testid="mio-login-error">{error}</p>}
      <Button type="submit" variant="primary" className={css.submit} disabled={submitting}
        data-testid="mio-login-submit">
        {submitting ? t('submitting') : mode === 'sms' ? t('submitSms') : t('submitPassword')}
      </Button>
      <div className={css.agreement}>
        <input id="mio-login-agree" type="checkbox" checked={agreed}
          onChange={(event) => { setAgreed(event.target.checked) }} />
        <label htmlFor="mio-login-agree">
          {t('agreementPrefix')}{' '}
          <button type="button" className={css.link}
            onClick={() => { setAgreementType('USER') }}>{t('userAgreement')}</button>
          {' '}{t('and')}{' '}
          <button type="button" className={css.link}
            onClick={() => { setAgreementType('PRIVACY') }}>{t('privacyAgreement')}</button>
        </label>
      </div>
    </form>
    <Modal open={agreementType !== null}
      title={agreementType === 'PRIVACY' ? t('privacyAgreement') : t('userAgreement')}
      closeLabel={t('close')} onClose={() => { setAgreementType(null) }}>
      {agreement === undefined
        ? <p className={css.agreementEmpty}>{t('agreementUnavailable')}</p>
        : <div className={css.agreementBody} dangerouslySetInnerHTML={{ __html: agreement.content }} />}
    </Modal>
    <ResetPasswordDialog open={resetOpen} onClose={() => { setResetOpen(false) }} t={t}
      sendSmsCode={sendSmsCode} resetPassword={resetPassword} />
  </>
}
