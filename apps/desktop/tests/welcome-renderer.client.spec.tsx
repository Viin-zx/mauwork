// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Welcome } from '../src/client/WelcomePage.tsx'
import { resolveDesktopLocale } from '../src/locale.ts'
import type { MioAccountView, MioAgreement, MioSmsCode, MioUserId } from '@deepseek-ai/dsh-mio-account/types'

const html = readFileSync(join(import.meta.dirname, '../renderer/welcome.html'), 'utf8')
afterEach(cleanup)

const signedOut: MioAccountView = { status: 'signed-out', user: null, expiresAt: null }
const signedIn: MioAccountView = {
  status: 'signed-in',
  user: {
    userId: 'user-1' as MioUserId, maskedPhone: '138****0000', nickname: 'tester',
    accountStatus: 'READY', credentialStatus: 'READY',
  },
  expiresAt: Date.now() + 60_000,
}
const agreements: readonly MioAgreement[] = [
  { agreementType: 'USER', content: '<p>user agreement body</p>' },
  { agreementType: 'PRIVACY', content: '<p>privacy body</p>' },
]

async function mount(
  language = 'zh-CN',
  options: {
    getState?: () => Promise<MioAccountView>
    getAgreements?: () => Promise<readonly MioAgreement[]>
  } = {},
) {
  cleanup()
  const api = {
    ...resolveDesktopLocale(language),
    analytics: vi.fn(async (_event: string, _attributes: object) => {}),
    analyticsEnabled: vi.fn(async () => true),
    getState: vi.fn(options.getState ?? (async () => signedOut)),
    sendSmsCode: vi.fn(async (): Promise<MioSmsCode> => ({ smsRequestId: 'sms-1', retryAfterSeconds: 60, expiresIn: 300 })),
    loginWithSms: vi.fn(async () => signedIn),
    loginWithPassword: vi.fn(async () => signedIn),
    resetPassword: vi.fn(async () => {}),
    getAgreements: vi.fn(options.getAgreements ?? (async () => agreements)),
    skip: vi.fn(async () => {}),
  }
  render(<Welcome api={api} />)
  return api
}

describe('desktop welcome login presentation', () => {
  it.each(['zh-CN', 'en'])('renders the %s login with the product mark', async (language) => {
    const api = await mount(language)
    await screen.findByTestId('mio-login-form')
    expect(document.documentElement.lang).toBe(language)
    expect(document.title).toBe(api.messages.welcomeTitle)
    expect(document.querySelector('img')!.getAttribute('src')).toBe('assets/favicon.png')
    expect(document.querySelector('h1')!.textContent).toBe(api.messages.title)
    expect(screen.getByTestId('mio-login-phone').getAttribute('placeholder')).toBe(api.messages.phonePlaceholder)
    expect(screen.getByTestId('mio-login-submit').textContent).toBe(api.messages.submitSms)
    expect(document.body.textContent).toContain(api.messages.tabSms)
    expect(document.body.textContent).toContain(api.messages.tabPassword)
    expect(document.body.textContent).toContain(api.messages.agreementPrefix)
    expect(document.body.textContent).toContain(api.messages.userAgreement)
  })

  it('waits for the account snapshot before showing the form', async () => {
    const pending = Promise.withResolvers<MioAccountView>()
    const api = await mount('en', { getState: () => pending.promise })
    expect(screen.queryByTestId('mio-login-form')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain(api.messages.loading)
    await act(async () => { pending.resolve(signedOut) })
    expect(screen.getByTestId('mio-login-form')).not.toBeNull()
  })

  it('keeps an already signed-in renderer on the loading surface', async () => {
    const api = await mount('en', { getState: async () => signedIn })
    await act(async () => {})
    expect(screen.queryByTestId('mio-login-form')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain(api.messages.loading)
  })

  it('requests one SMS code and submits the SMS login', async () => {
    const api = await mount()
    await screen.findByTestId('mio-login-form')
    const phone = screen.getByTestId('mio-login-phone')
    fireEvent.change(phone, { target: { value: '13800138000' } })
    fireEvent.click(screen.getByTestId('mio-login-code-send'))
    await waitFor(() => {
      expect(api.sendSmsCode).toHaveBeenCalledExactlyOnceWith({ countryCode: '+86', mobile: '13800138000', scene: 'LOGIN' })
    })
    await waitFor(() => { expect(screen.getByTestId('mio-login-code-send').textContent).toBe('60s') })
    expect(screen.getByTestId<HTMLButtonElement>('mio-login-code-send').disabled).toBe(true)
    fireEvent.change(screen.getByTestId('mio-login-code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByTestId('mio-login-agree'))
    fireEvent.submit(screen.getByTestId('mio-login-form'))
    await waitFor(() => {
      expect(api.loginWithSms).toHaveBeenCalledExactlyOnceWith({
        countryCode: '+86', mobile: '13800138000', smsRequestId: 'sms-1', smsCode: '123456',
      })
    })
    expect(document.body.textContent).not.toContain('123456')
  })

  it('rejects an invalid phone before requesting a code', async () => {
    const api = await mount()
    await screen.findByTestId('mio-login-form')
    fireEvent.change(screen.getByTestId('mio-login-phone'), { target: { value: '12345' } })
    fireEvent.click(screen.getByTestId('mio-login-code-send'))
    await waitFor(() => { expect(screen.getByTestId('mio-login-error').textContent).toBe(api.messages.invalidPhone) })
    expect(api.sendSmsCode).not.toHaveBeenCalled()
  })

  it('requires the agreement before submitting a login', async () => {
    const api = await mount()
    await screen.findByTestId('mio-login-form')
    fireEvent.change(screen.getByTestId('mio-login-phone'), { target: { value: '13800138000' } })
    fireEvent.change(screen.getByTestId('mio-login-code'), { target: { value: '123456' } })
    fireEvent.submit(screen.getByTestId('mio-login-form'))
    await waitFor(() => { expect(screen.getByTestId('mio-login-error').textContent).toBe(api.messages.errorNotAgreed) })
    expect(api.loginWithSms).not.toHaveBeenCalled()
  })

  it('signs in with a password and exposes password recovery', async () => {
    const api = await mount()
    await screen.findByTestId('mio-login-form')
    fireEvent.click(screen.getByRole('tab', { name: api.messages.tabPassword }))
    expect(screen.getByTestId('mio-login-submit').textContent).toBe(api.messages.submitPassword)
    expect(screen.getByTestId('mio-login-forgot').textContent).toBe(api.messages.forgotPassword)
    fireEvent.change(screen.getByTestId('mio-login-phone'), { target: { value: '13800138000' } })
    fireEvent.change(screen.getByTestId('mio-login-password'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByTestId('mio-login-agree'))
    fireEvent.submit(screen.getByTestId('mio-login-form'))
    await waitFor(() => {
      expect(api.loginWithPassword).toHaveBeenCalledExactlyOnceWith({
        countryCode: '+86', mobile: '13800138000', password: 'secret123',
      })
    })
    expect(api.loginWithSms).not.toHaveBeenCalled()
  })

  it('rejects an empty password before submitting', async () => {
    const api = await mount()
    await screen.findByTestId('mio-login-form')
    fireEvent.click(screen.getByRole('tab', { name: api.messages.tabPassword }))
    fireEvent.change(screen.getByTestId('mio-login-phone'), { target: { value: '13800138000' } })
    fireEvent.click(screen.getByTestId('mio-login-agree'))
    fireEvent.submit(screen.getByTestId('mio-login-form'))
    await waitFor(() => { expect(screen.getByTestId('mio-login-error').textContent).toBe(api.messages.errorPasswordRequired) })
    expect(api.loginWithPassword).not.toHaveBeenCalled()
  })

  it('resets the password through a RESET_PASSWORD code and returns to password login', async () => {
    const api = await mount()
    await screen.findByTestId('mio-login-form')
    fireEvent.click(screen.getByRole('tab', { name: api.messages.tabPassword }))
    fireEvent.click(screen.getByTestId('mio-login-forgot'))
    await screen.findByRole('heading', { name: api.messages.resetPassword })
    fireEvent.change(document.querySelector('#reset-phone')!, { target: { value: '13800138000' } })
    fireEvent.click(screen.getByRole('button', { name: api.messages.getCode }))
    await waitFor(() => {
      expect(api.sendSmsCode).toHaveBeenCalledExactlyOnceWith({ countryCode: '+86', mobile: '13800138000', scene: 'RESET_PASSWORD' })
    })
    fireEvent.change(document.querySelector('#reset-code')!, { target: { value: '654321' } })
    fireEvent.change(document.querySelector('#reset-password')!, { target: { value: 'newsecret' } })
    fireEvent.submit(document.querySelector('#reset-password')!.closest('form')!)
    await waitFor(() => {
      expect(api.resetPassword).toHaveBeenCalledExactlyOnceWith({
        countryCode: '+86', mobile: '13800138000', smsRequestId: 'sms-1', smsCode: '654321', newPassword: 'newsecret',
      })
    })
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(api.messages.resetSuccess) })
    expect(screen.getByTestId('mio-login-submit').textContent).toBe(api.messages.submitPassword)
  })

  it('shows the backend message without the IPC wrapper when a login fails', async () => {
    const api = await mount()
    api.loginWithSms.mockRejectedValueOnce(new Error(
      "Error invoking remote method 'dsh-welcome:login-sms': Error: 验证码错误",
    ))
    await screen.findByTestId('mio-login-form')
    fireEvent.change(screen.getByTestId('mio-login-phone'), { target: { value: '13800138000' } })
    fireEvent.change(screen.getByTestId('mio-login-code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByTestId('mio-login-agree'))
    fireEvent.submit(screen.getByTestId('mio-login-form'))
    await waitFor(() => { expect(screen.getByTestId('mio-login-error').textContent).toBe('验证码错误') })
  })

  it('shows the selected agreement content and closes it again', async () => {
    const api = await mount()
    await screen.findByTestId('mio-login-form')
    fireEvent.click(screen.getByRole('button', { name: api.messages.userAgreement }))
    expect(await screen.findByText('user agreement body')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: api.messages.close }))
    expect(screen.queryByText('user agreement body')).toBeNull()
  })

  it('shows a configured agreement as unavailable when the list omits it', async () => {
    const api = await mount('zh-CN', {
      getAgreements: async () => [{ agreementType: 'USER', content: '<p>user agreement body</p>' }],
    })
    await screen.findByTestId('mio-login-form')
    fireEvent.click(screen.getByRole('button', { name: api.messages.privacyAgreement }))
    expect(await screen.findByText(api.messages.agreementUnavailable)).not.toBeNull()
  })

  it('disables the submit button while a login is in flight', async () => {
    const pending = Promise.withResolvers<MioAccountView>()
    const api = await mount()
    await screen.findByTestId('mio-login-form')
    api.loginWithSms.mockReturnValueOnce(pending.promise)
    fireEvent.change(screen.getByTestId('mio-login-phone'), { target: { value: '13800138000' } })
    fireEvent.change(screen.getByTestId('mio-login-code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByTestId('mio-login-agree'))
    fireEvent.submit(screen.getByTestId('mio-login-form'))
    await waitFor(() => { expect(screen.getByTestId<HTMLButtonElement>('mio-login-submit').disabled).toBe(true) })
    expect(screen.getByTestId('mio-login-submit').textContent).toBe(api.messages.submitting)
    await act(async () => { pending.resolve(signedIn) })
  })

  it('keeps visible copy in the shell dictionaries and denies network access', () => {
    expect([...html.matchAll(/>([^<]*\p{L}[^<]*)</gu)]).toEqual([])
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("form-action 'none'")
  })
})
