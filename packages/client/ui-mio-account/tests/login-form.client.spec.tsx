// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LoginForm, type LoginFormProps } from '../src/client/LoginForm.tsx'
import { MioAccountClientError } from '../src/client/operations.ts'
import type { MioAccountView, MioAgreement, MioSmsCode } from '@deepseek-ai/dsh-mio-account/types'
import { AGREEMENTS, SIGNED_IN, SMS, stubOperations, translate } from './harness.client.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function mount(overrides: Partial<LoginFormProps> = {}): Promise<LoginFormProps> {
  const props: LoginFormProps = { expired: false, ...stubOperations(), t: translate, ...overrides }
  render(<LoginForm {...props} />)
  await act(async () => {})
  return props
}

function fillPhone(value = '13800000000'): void {
  fireEvent.change(screen.getByTestId('mio-login-phone'), { target: { value } })
}

function agree(): void {
  fireEvent.click(screen.getByRole('checkbox'))
}

function submit(): void {
  fireEvent.submit(screen.getByTestId('mio-login-form'))
}

describe('login form', () => {
  it('loads agreements and opens both documents', async () => {
    const getAgreements = vi.fn(async () => AGREEMENTS)
    await mount({ getAgreements })
    expect(getAgreements).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'userAgreement' }))
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByText('user terms')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'privacyAgreement' }))
    expect(screen.getByText('privacy terms')).toBeDefined()
  })

  it('reports an unavailable agreement when the backend returns none', async () => {
    await mount({ getAgreements: vi.fn(async () => []) })
    fireEvent.click(screen.getByRole('button', { name: 'userAgreement' }))
    expect(screen.getByText('agreementUnavailable')).toBeDefined()
  })

  it('keeps the form usable when the agreement read fails', async () => {
    const getAgreements = vi.fn(async (): Promise<readonly MioAgreement[]> => { throw new Error('offline') })
    await mount({ getAgreements })
    expect(screen.getByTestId('mio-login-form')).toBeDefined()
  })

  it('drops an agreement response that lands after unmount', async () => {
    let resolve!: (items: readonly MioAgreement[]) => void
    const getAgreements = vi.fn(() => new Promise<readonly MioAgreement[]>((done) => { resolve = done }))
    render(<LoginForm expired={false} {...stubOperations()} getAgreements={getAgreements} t={translate} />)
    cleanup()
    resolve(AGREEMENTS)
    await act(async () => {})
  })

  it('requires a valid phone before requesting a code and starts the countdown', async () => {
    const sendSmsCode = vi.fn(async () => SMS)
    await mount({ sendSmsCode })
    fireEvent.click(screen.getByRole('button', { name: 'getCode' }))
    expect(screen.getByRole('alert').textContent).toBe('invalidPhone')
    expect(sendSmsCode).not.toHaveBeenCalled()

    fillPhone()
    fireEvent.click(screen.getByRole('button', { name: 'getCode' }))
    await act(async () => {})
    expect(sendSmsCode).toHaveBeenCalledExactlyOnceWith({
      countryCode: '+86', mobile: '13800000000', scene: 'LOGIN',
    })
    expect(screen.getByRole('button', { name: '60s' })).toBeDefined()
    expect(screen.getByRole('button', { name: '60s' })).toHaveProperty('disabled', true)
  })

  it('counts down from the backend delay, falling back to one minute', async () => {
    vi.useFakeTimers()
    const sendSmsCode = vi.fn(async () => ({ ...SMS, retryAfterSeconds: 0 }))
    await mount({ sendSmsCode })
    fillPhone()
    fireEvent.click(screen.getByRole('button', { name: 'getCode' }))
    await act(async () => {})
    expect(screen.getByRole('button', { name: '60s' })).toBeDefined()

    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('button', { name: '59s' })).toBeDefined()
  })

  it('shows the backend message when a code request fails', async () => {
    const sendSmsCode = vi.fn(async () => { throw new Error('backend says no') })
    await mount({ sendSmsCode })
    fillPhone()
    fireEvent.click(screen.getByRole('button', { name: 'getCode' }))
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe('backend says no')
  })

  it('falls back to localized copy for a message-less code failure', async () => {
    const sendSmsCode = vi.fn(async () => { throw new Error('') })
    await mount({ sendSmsCode })
    fillPhone()
    fireEvent.click(screen.getByRole('button', { name: 'getCode' }))
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe('error')
  })

  it('switches modes, clears transient fields, and ignores the active tab', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'getCode' }))
    expect(screen.getByRole('alert').textContent).toBe('invalidPhone')

    fireEvent.click(screen.getByRole('tab', { name: 'tabPassword' }))
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.change(screen.getByTestId('mio-login-password'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('tab', { name: 'tabPassword' }))
    expect(screen.getByTestId('mio-login-password')).toHaveProperty('value', 'secret123')

    fireEvent.click(screen.getByRole('tab', { name: 'tabSms' }))
    fireEvent.click(screen.getByRole('tab', { name: 'tabPassword' }))
    expect(screen.getByTestId('mio-login-password')).toHaveProperty('value', '')
  })

  it('validates the phone, agreement, code, and password before login', async () => {
    const loginWithSms = vi.fn(async () => SIGNED_IN)
    await mount({ loginWithSms })
    submit()
    expect(screen.getByRole('alert').textContent).toBe('invalidPhone')

    fillPhone()
    submit()
    expect(screen.getByRole('alert').textContent).toBe('errorNotAgreed')

    agree()
    submit()
    expect(screen.getByRole('alert').textContent).toBe('errorCodeRequired')

    fireEvent.click(screen.getByRole('tab', { name: 'tabPassword' }))
    submit()
    expect(screen.getByRole('alert').textContent).toBe('errorPasswordRequired')
    expect(loginWithSms).not.toHaveBeenCalled()
  })

  it('submits an SMS login once while the request is pending', async () => {
    let resolveLogin!: (view: MioAccountView) => void
    const loginWithSms = vi.fn(() => new Promise<MioAccountView>((done) => { resolveLogin = done }))
    await mount({ loginWithSms })
    fillPhone()
    fireEvent.click(screen.getByRole('button', { name: 'getCode' }))
    await act(async () => {})
    fireEvent.change(screen.getByTestId('mio-login-code'), { target: { value: '123456' } })
    agree()

    submit()
    expect(screen.getByRole('button', { name: 'submitting' })).toHaveProperty('disabled', true)
    submit()
    expect(loginWithSms).toHaveBeenCalledExactlyOnceWith({
      countryCode: '+86', mobile: '13800000000', smsRequestId: 'sms-1', smsCode: '123456',
    })
    await act(async () => { resolveLogin(SIGNED_IN) })
    expect(screen.getByRole('button', { name: 'submitSms' })).toBeDefined()
  })

  it('drops the SMS request id after an invalid-code failure', async () => {
    const loginWithSms = vi.fn()
      .mockRejectedValueOnce(new MioAccountClientError('SMS_CODE_INVALID', 'code expired'))
      .mockResolvedValueOnce(SIGNED_IN)
    await mount({ loginWithSms })
    fillPhone()
    fireEvent.click(screen.getByRole('button', { name: 'getCode' }))
    await act(async () => {})
    fireEvent.change(screen.getByTestId('mio-login-code'), { target: { value: '123456' } })
    agree()

    submit()
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe('code expired')

    submit()
    await act(async () => {})
    expect(loginWithSms).toHaveBeenLastCalledWith({
      countryCode: '+86', mobile: '13800000000', smsRequestId: '', smsCode: '123456',
    })
  })

  it('falls back to localized copy for a message-less login failure', async () => {
    const loginWithPassword = vi.fn(async () => { throw new Error('') })
    await mount({ loginWithPassword })
    fillPhone()
    agree()
    fireEvent.click(screen.getByRole('tab', { name: 'tabPassword' }))
    fireEvent.change(screen.getByTestId('mio-login-password'), { target: { value: 'secret123' } })
    submit()
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe('error')
  })

  it('submits a password login with the entered credentials', async () => {
    const loginWithPassword = vi.fn(async () => SIGNED_IN)
    await mount({ loginWithPassword })
    fillPhone()
    agree()
    fireEvent.click(screen.getByRole('tab', { name: 'tabPassword' }))
    fireEvent.change(screen.getByTestId('mio-login-password'), { target: { value: 'secret123' } })
    submit()
    await act(async () => {})
    expect(loginWithPassword).toHaveBeenCalledExactlyOnceWith({
      countryCode: '+86', mobile: '13800000000', password: 'secret123',
    })
  })

  it('shows the expiry notice and opens the password reset dialog', async () => {
    await mount({ expired: true })
    expect(screen.getByText('sessionExpired')).toBeDefined()
    fireEvent.click(screen.getByRole('tab', { name: 'tabPassword' }))
    fireEvent.click(screen.getByRole('button', { name: 'forgotPassword' }))
    expect(screen.getByText('resetTitle')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))
    expect(screen.queryByText('resetTitle')).toBeNull()
  })

  it('ignores a code response when retryAfterSeconds is already positive', async () => {
    const sendSmsCode = vi.fn(async (): Promise<MioSmsCode> => ({ ...SMS, retryAfterSeconds: 5 }))
    await mount({ sendSmsCode })
    fillPhone()
    fireEvent.click(screen.getByRole('button', { name: 'getCode' }))
    await act(async () => {})
    expect(screen.getByRole('button', { name: '5s' })).toBeDefined()
  })

  it('keeps the form mounted while agreements are loading', () => {
    render(<LoginForm expired={false} {...stubOperations()} t={translate}
      getAgreements={vi.fn(() => new Promise<readonly MioAgreement[]>(() => {}))} />)
    expect(screen.getByTestId('mio-login-form')).toBeDefined()
    cleanup()
  })
})
