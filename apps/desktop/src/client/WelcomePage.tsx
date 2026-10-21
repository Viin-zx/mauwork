/** Desktop welcome presentation using mioagent SMS/password login. */
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { IconLoadingOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  MioAccountView, MioAgreement, MioPasswordLoginRequest, MioResetPasswordRequest, MioSmsCode,
  MioSmsCodeRequest, MioSmsLoginRequest,
} from '@deepseek-ai/dsh-mio-account/types'
import type { WelcomeApi } from '../welcome-api.ts'
import css from './WelcomePage.module.css'

const COUNTRY_CODE = '+86'
const PHONE_PATTERN = /^1[3-9]\d{9}$/
const DEFAULT_COUNTDOWN_SECONDS = 60
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/u
type LoginMode = 'sms' | 'password'
type AgreementType = 'USER' | 'PRIVACY'

function failureMessage(failure: unknown, fallback: string): string {
  if (!(failure instanceof Error)) return fallback
  const message = failure.message.replace(IPC_ERROR_PREFIX, '')
  return message === '' ? fallback : message
}

/**
 * Render the standalone welcome flow using mioagent login.
 * @param props.api - isolated preload API with mioagent operations.
 * @returns welcome page with SMS/password login form.
 */
export function Welcome({ api }: { api: WelcomeApi }) {
  const { messages: m } = api
  const [state, setState] = useState<MioAccountView | undefined>(undefined)
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
  const [resetSuccess, setResetSuccess] = useState(false)

  useEffect(() => {
    document.documentElement.lang = api.id
    document.title = m.welcomeTitle
    void api.getState().then(setState).catch(() => undefined)
    void api.getAgreements().then(setAgreements).catch(() => undefined)
  }, [api, m.welcomeTitle])

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
      setError(m.invalidPhone ?? 'Please enter a valid phone number')
      return
    }
    setSending(true)
    setError('')
    try {
      const request: MioSmsCodeRequest = { countryCode: COUNTRY_CODE, mobile: phone, scene: 'LOGIN' }
      const issued: MioSmsCode = await api.sendSmsCode(request)
      setSmsRequestId(issued.smsRequestId)
      setCountdown(issued.retryAfterSeconds > 0 ? issued.retryAfterSeconds : DEFAULT_COUNTDOWN_SECONDS)
    } catch (failure) {
      setError(failureMessage(failure, m.error))
    } finally {
      setSending(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    if (!PHONE_PATTERN.test(phone)) {
      setError(m.invalidPhone ?? 'Please enter a valid phone number')
      return
    }
    if (!agreed) {
      setError(m.errorNotAgreed ?? 'Please agree to the terms')
      return
    }
    if (mode === 'sms' && code === '') {
      setError(m.errorCodeRequire ?? 'Please enter the verification code')
      return
    }
    if (mode === 'password' && password === '') {
      setError(m.errorPasswordRequired ?? 'Please enter your password')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      if (mode === 'sms') {
        const request: MioSmsLoginRequest = {
          countryCode: COUNTRY_CODE,
          mobile: phone,
          smsRequestId,
          smsCode: code,
        }
        await api.loginWithSms(request)
      } else {
        const request: MioPasswordLoginRequest = { countryCode: COUNTRY_CODE, mobile: phone, password }
        await api.loginWithPassword(request)
      }
    } catch (failure) {
      setError(failureMessage(failure, m.error))
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    if (!resetSuccess) return
    const timer = setTimeout(() => { setResetSuccess(false) }, 3000)
    return () => { clearTimeout(timer) }
  }, [resetSuccess])

  const handleResetPassword = async (request: MioResetPasswordRequest): Promise<void> => {
    await api.resetPassword(request)
    setResetOpen(false)
    setResetSuccess(true)
    setMode('password')
    setPassword('')
  }

  const agreement = agreementType === null
    ? undefined
    : agreements.find(item => item.agreementType === agreementType)

  if (state?.status === 'signed-in') {
    return <div className={css.loading} role="status">
      <IconLoadingOutlineRegular size={20} className={css.spinner} />
      <span>{m.loading}</span>
    </div>
  }

  return <>
    <div className={css.drag} aria-hidden="true" />
    <main className={css.root}>
      <div className={css.page}>
        <img src="assets/favicon.png" width={64} height={64} className={css.logo}
          alt="" aria-hidden="true" draggable={false} />
        <h1 className={css.title}>{m.title}</h1>
        {state === undefined
          ? <div className={css.loading} role="status">
            <IconLoadingOutlineRegular size={20} className={css.spinner} />
            <span>{m.loading}</span>
          </div>
          : <form className={css.card} data-testid="mio-login-form" onSubmit={(event) => { void submit(event) }} noValidate>
            {resetSuccess && <p className={css.success} role="status">{m.resetSuccess}</p>}
            <div className={css.tabs} role="tablist" aria-label={m.title}>
              <button type="button" role="tab" aria-selected={mode === 'sms'} data-active={mode === 'sms'}
                className={css.tab} onClick={() => { switchMode('sms') }}>{m.tabSms}</button>
              <button type="button" role="tab" aria-selected={mode === 'password'} data-active={mode === 'password'}
                className={css.tab} onClick={() => { switchMode('password') }}>{m.tabPassword}</button>
            </div>
            <div className={css.field}>
              <label className={css.label} htmlFor="mio-login-phone">{m.phone}</label>
              <input id="mio-login-phone" data-testid="mio-login-phone" type="tel" inputMode="numeric"
                autoComplete="tel" maxLength={11} placeholder={m.phonePlaceholder} value={phone}
                onChange={(event) => { setPhone(event.target.value) }} />
            </div>
            {mode === 'sms' ? <div className={css.field}>
              <label className={css.label} htmlFor="mio-login-code">{m.code}</label>
              <div className={css.codeRow}>
                <input id="mio-login-code" data-testid="mio-login-code" inputMode="numeric"
                  autoComplete="one-time-code" maxLength={6} placeholder={m.codePlaceholder} value={code}
                  onChange={(event) => { setCode(event.target.value) }} />
                <button type="button" className={css.codeButton} data-testid="mio-login-code-send"
                  disabled={countdown > 0 || sending} onClick={() => { void requestCode() }}>
                  {countdown > 0 ? `${countdown}s` : m.getCode}
                </button>
              </div>
            </div> : <div className={css.field}>
              <label className={css.label} htmlFor="mio-login-password">{m.password}</label>
              <input id="mio-login-password" data-testid="mio-login-password" type="password"
                autoComplete="current-password" placeholder={m.passwordPlaceholder} value={password}
                onChange={(event) => { setPassword(event.target.value) }} />
              <div className={css.fieldAction}>
                <button type="button" className={css.link} data-testid="mio-login-forgot"
                  onClick={() => { setResetOpen(true) }}>{m.forgotPassword}</button>
              </div>
            </div>}
            {error !== '' && <p className={css.error} role="alert" data-testid="mio-login-error">{error}</p>}
            <button type="submit" className={css.submit} data-testid="mio-login-submit" disabled={submitting}>
              {submitting ? m.submitting : mode === 'sms' ? m.submitSms : m.submitPassword}
            </button>
            <div className={css.agreement}>
              <input id="mio-login-agree" data-testid="mio-login-agree" type="checkbox" checked={agreed}
                onChange={(event) => { setAgreed(event.target.checked) }} />
              <label htmlFor="mio-login-agree">
                {m.agreementPrefix}{' '}
                <button type="button" className={css.link}
                  onClick={() => { setAgreementType('USER') }}>{m.userAgreement}</button>
                {' '}{m.and}{' '}
                <button type="button" className={css.link}
                  onClick={() => { setAgreementType('PRIVACY') }}>{m.privacyAgreement}</button>
              </label>
            </div>
          </form>}
      </div>
    </main>
    {resetOpen && <ResetPasswordDialog open={resetOpen} onClose={() => { setResetOpen(false) }}
      onReset={handleResetPassword} sendSmsCode={req => api.sendSmsCode(req)} t={m} />}
    {agreementType !== null && <div className={css.modal} onClick={() => { setAgreementType(null) }}>
      <div className={css.modalContent} onClick={(e) => { e.stopPropagation() }}>
        <h2>{agreementType === 'PRIVACY' ? m.privacyAgreement : m.userAgreement}</h2>
        {agreement === undefined
          ? <p>{m.agreementUnavailable}</p>
          : <div className={css.agreementBody} dangerouslySetInnerHTML={{ __html: agreement.content }} />}
        <button type="button" className={css.modalClose} onClick={() => { setAgreementType(null) }}>{m.close}</button>
      </div>
    </div>}
  </>
}

function ResetPasswordDialog({ open, onClose, onReset, sendSmsCode, t }: {
  open: boolean
  onClose: () => void
  onReset: (request: MioResetPasswordRequest) => Promise<void>
  sendSmsCode: (request: MioSmsCodeRequest) => Promise<MioSmsCode>
  t: Record<string, string>
}) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [smsRequestId, setSmsRequestId] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => { setCountdown(value => value - 1) }, 1000)
    return () => { clearTimeout(timer) }
  }, [countdown])

  const requestCode = async (): Promise<void> => {
    if (!PHONE_PATTERN.test(phone)) {
      setError(t.invalidPhone ?? 'Please enter a valid phone number')
      return
    }
    setSending(true)
    setError('')
    try {
      const issued = await sendSmsCode({ countryCode: COUNTRY_CODE, mobile: phone, scene: 'RESET_PASSWORD' })
      setSmsRequestId(issued.smsRequestId)
      setCountdown(issued.retryAfterSeconds > 0 ? issued.retryAfterSeconds : DEFAULT_COUNTDOWN_SECONDS)
    } catch (failure) {
      setError(failureMessage(failure, t.error ?? 'An error occurred'))
    } finally {
      setSending(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    if (!PHONE_PATTERN.test(phone)) {
      setError(t.invalidPhone ?? 'Please enter a valid phone number')
      return
    }
    if (code === '') {
      setError(t.errorCodeRequire ?? 'Please enter the verification code')
      return
    }
    if (password === '') {
      setError(t.errorPasswordRequired ?? 'Please enter your password')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await onReset({
        countryCode: COUNTRY_CODE,
        mobile: phone,
        smsRequestId,
        smsCode: code,
        newPassword: password,
      })
      onClose()
    } catch (failure) {
      setError(failureMessage(failure, t.error ?? 'An error occurred'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null
  return <div className={css.modal} onClick={onClose}>
    <div className={css.modalContent} onClick={(e) => { e.stopPropagation() }}>
      <h2>{t.resetPassword}</h2>
      <form className={css.form} onSubmit={(event) => { void submit(event) }} noValidate>
        <div className={css.field}>
          <label className={css.label} htmlFor="reset-phone">{t.phone}</label>
          <input id="reset-phone" type="tel" inputMode="numeric" maxLength={11}
            placeholder={t.phonePlaceholder} value={phone} onChange={(e) => { setPhone(e.target.value) }} />
        </div>
        <div className={css.field}>
          <label className={css.label} htmlFor="reset-code">{t.code}</label>
          <div className={css.codeRow}>
            <input id="reset-code" inputMode="numeric" maxLength={6}
              placeholder={t.codePlaceholder} value={code} onChange={(e) => { setCode(e.target.value) }} />
            <button type="button" className={css.codeButton} disabled={countdown > 0 || sending}
              onClick={() => { void requestCode() }}>
              {countdown > 0 ? `${countdown}s` : t.getCode}
            </button>
          </div>
        </div>
        <div className={css.field}>
          <label className={css.label} htmlFor="reset-password">{t.newPassword}</label>
          <input id="reset-password" type="password" placeholder={t.newPasswordPlaceholder}
            value={password} onChange={(e) => { setPassword(e.target.value) }} />
        </div>
        {error !== '' && <p className={css.error} role="alert">{error}</p>}
        <div className={css.actions}>
          <button type="button" className={css.secondary} onClick={onClose}>{t.cancel}</button>
          <button type="submit" className={css.primary} disabled={submitting}>
            {submitting ? t.submitting : t.resetPassword}
          </button>
        </div>
      </form>
    </div>
  </div>
}
