// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ResetPasswordDialog, type ResetPasswordDialogProps } from '../src/client/ResetPasswordDialog.tsx'
import { MioAccountClientError } from '../src/client/operations.ts'
import type { MioResetPasswordRequest, MioSmsCode } from '@deepseek-ai/dsh-mio-account/types'
import { SMS, translate } from './harness.client.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function mount(overrides: Partial<ResetPasswordDialogProps> = {}): ResetPasswordDialogProps {
  const props: ResetPasswordDialogProps = {
    open: true,
    onClose: vi.fn(),
    sendSmsCode: vi.fn(async () => SMS),
    resetPassword: vi.fn(async () => undefined),
    t: translate,
    ...overrides,
  }
  render(<ResetPasswordDialog {...props} />)
  return props
}

function fillPhone(value = '13800000000'): void {
  fireEvent.change(screen.getByRole('textbox', { name: 'phone' }), { target: { value } })
}

function fillFields(values: { code?: string; password?: string; confirm?: string } = {}): void {
  fireEvent.change(screen.getByRole('textbox', { name: 'code' }), { target: { value: values.code ?? '654321' } })
  fireEvent.change(screen.getByLabelText('newPassword'), { target: { value: values.password ?? 'newsecret123' } })
  fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: values.confirm ?? values.password ?? 'newsecret123' } })
}

function submit(): void {
  fireEvent.submit(screen.getByTestId('mio-reset-form'))
}

describe('password reset dialog', () => {
  it('clears its fields whenever it reopens', () => {
    const props: ResetPasswordDialogProps = {
      open: true,
      onClose: vi.fn(),
      sendSmsCode: vi.fn(async () => SMS),
      resetPassword: vi.fn(async () => undefined),
      t: translate,
    }
    const { rerender } = render(<ResetPasswordDialog {...props} />)
    fillPhone('13900000000')
    rerender(<ResetPasswordDialog {...props} open={false} />)
    rerender(<ResetPasswordDialog {...props} open />)
    expect(screen.getByRole('textbox', { name: 'phone' })).toHaveProperty('value', '')
  })

  it('requires a valid phone before requesting a reset code', async () => {
    const sendSmsCode = vi.fn(async () => SMS)
    mount({ sendSmsCode })
    fireEvent.click(screen.getByRole('button', { name: 'getCode' }))
    expect(screen.getByRole('alert').textContent).toBe('invalidPhone')
    expect(sendSmsCode).not.toHaveBeenCalled()

    fillPhone()
    fireEvent.click(screen.getByRole('button', { name: 'getCode' }))
    await act(async () => {})
    expect(sendSmsCode).toHaveBeenCalledExactlyOnceWith({
      countryCode: '+86', mobile: '13800000000', scene: 'RESET_PASSWORD',
    })
    expect(screen.getByRole('button', { name: '60s' })).toHaveProperty('disabled', true)
  })

  it('counts down from the backend delay and falls back to one minute', async () => {
    vi.useFakeTimers()
    mount({ sendSmsCode: vi.fn(async (): Promise<MioSmsCode> => ({ ...SMS, retryAfterSeconds: 0 })) })
    fillPhone()
    fireEvent.click(screen.getByRole('button', { name: 'getCode' }))
    await act(async () => {})
    expect(screen.getByRole('button', { name: '60s' })).toBeDefined()
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('button', { name: '59s' })).toBeDefined()
  })

  it('shows the backend message when a reset code request fails', async () => {
    mount({ sendSmsCode: vi.fn(async () => { throw new Error('sms unavailable') }) })
    fillPhone()
    fireEvent.click(screen.getByRole('button', { name: 'getCode' }))
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe('sms unavailable')
  })

  it('falls back to localized copy for a message-less code failure', async () => {
    mount({ sendSmsCode: vi.fn(async () => { throw new Error('') }) })
    fillPhone()
    fireEvent.click(screen.getByRole('button', { name: 'getCode' }))
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe('errorCodeSent')
  })

  it('validates the phone, code, and replacement password', async () => {
    mount()
    submit()
    expect(screen.getByRole('alert').textContent).toBe('invalidPhone')

    fillPhone()
    submit()
    expect(screen.getByRole('alert').textContent).toBe('errorCodeRequired')

    fillFields({ password: 'short', confirm: 'short' })
    submit()
    expect(screen.getByRole('alert').textContent).toBe('errorPasswordShort')

    fillFields({ password: 'newsecret123', confirm: 'othersecret' })
    submit()
    expect(screen.getByRole('alert').textContent).toBe('errorPasswordMismatch')
  })

  it('submits the new password and closes itself after the success notice', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const resetPassword = vi.fn(async () => undefined)
    mount({ onClose, resetPassword })
    fillPhone()
    fillFields()
    submit()
    await act(async () => {})
    expect(resetPassword).toHaveBeenCalledExactlyOnceWith({
      countryCode: '+86',
      mobile: '13800000000',
      smsRequestId: '',
      smsCode: '654321',
      newPassword: 'newsecret123',
    } satisfies MioResetPasswordRequest)
    expect(screen.getByText('resetSuccess')).toBeDefined()
    expect(screen.getByRole('button', { name: 'resetSubmit' })).toHaveProperty('disabled', true)
    submit()
    expect(resetPassword).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('drops the SMS request id after an invalid-code failure', async () => {
    const resetPassword = vi.fn()
      .mockRejectedValueOnce(new MioAccountClientError('SMS_CODE_INVALID', 'code expired'))
      .mockResolvedValueOnce(undefined)
    mount({ resetPassword })
    fillPhone()
    fireEvent.click(screen.getByRole('button', { name: 'getCode' }))
    await act(async () => {})
    fillFields()
    submit()
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe('code expired')

    submit()
    await act(async () => {})
    expect(resetPassword).toHaveBeenLastCalledWith(expect.objectContaining({ smsRequestId: '' }))
  })

  it('falls back to localized copy for a message-less reset failure', async () => {
    mount({ resetPassword: vi.fn(async () => { throw new Error('') }) })
    fillPhone()
    fillFields()
    submit()
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe('errorReset')
  })

  it('closes through the cancel action', () => {
    const onClose = vi.fn()
    mount({ onClose })
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the bound phone read-only and uses the authenticated reset flow', async () => {
    const sendSmsCode = vi.fn(async () => SMS)
    const resetPassword = vi.fn(async () => undefined)
    mount({ mode: 'change', maskedPhone: '138****0000', sendSmsCode, resetPassword })

    const phone = screen.getByRole('textbox', { name: 'phone' })
    expect(phone).toHaveProperty('value', '138****0000')
    expect(phone).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: 'getCode' }))
    await act(async () => {})
    expect(sendSmsCode).toHaveBeenCalledExactlyOnceWith({
      countryCode: '+86', mobile: '', scene: 'RESET_PASSWORD', authenticated: true,
    })

    fillFields()
    submit()
    await act(async () => {})
    expect(resetPassword).toHaveBeenCalledExactlyOnceWith({
      countryCode: '+86',
      mobile: '',
      smsRequestId: 'sms-1',
      smsCode: '654321',
      newPassword: 'newsecret123',
      authenticated: true,
    } satisfies MioResetPasswordRequest)
  })
})
