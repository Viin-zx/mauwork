import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MioAccountView, MioAgreement, MioSmsCode } from '@deepseek-ai/dsh-mio-account/types'
import { resolveDesktopLocale } from '../src/locale.ts'
import type { WelcomeOperations } from '../src/welcome-api.ts'
import { needsWelcome, WELCOME_IPC } from '../src/welcome-api.ts'

const electron = vi.hoisted(() => ({
  create: vi.fn<(options: unknown) => ReturnType<typeof createWindow>>(),
  root: '/desktop-app',
  handlers: new Map<string, (event: unknown, value?: unknown, attributes?: unknown) => Promise<unknown>>(),
}))
vi.mock('electron', () => ({
  app: { getAppPath: () => electron.root },
  BrowserWindow: vi.fn(function (options: unknown) { return electron.create(options) }),
  ipcMain: {
    handle: (name: string, handler: (event: unknown, value?: unknown, attributes?: unknown) => Promise<unknown>) => {
      if (electron.handlers.has(name)) throw new Error(`duplicate IPC handler: ${name}`)
      electron.handlers.set(name, handler)
    },
    removeHandler: (name: string) => electron.handlers.delete(name),
  },
}))

const { openWelcomeWindow, welcomeWindowOptions } = await import('../src/welcome-window.ts')

function createWindow() {
  return {
    webContents: {
      mainFrame: {},
      setWindowOpenHandler: vi.fn<(handler: () => { action: string }) => void>(),
      on: vi.fn<(name: string, handler: (event: { preventDefault(): void }) => void) => void>(),
    },
    loadFile: vi.fn<(path: string) => Promise<undefined>>().mockResolvedValue(undefined),
    isDestroyed: vi.fn().mockReturnValue(false),
    destroy: vi.fn(),
    show: vi.fn(),
    once: vi.fn<(name: string, callback: () => void) => void>(),
  }
}

beforeEach(() => { electron.create.mockReset(); electron.handlers.clear() })

const operations: WelcomeOperations = {
  analyticsEnabled: async () => true,
  getState: async (): Promise<MioAccountView> => ({ status: 'signed-out', user: null, expiresAt: null }),
  sendSmsCode: async (): Promise<MioSmsCode> => ({ smsRequestId: 'sms-1', retryAfterSeconds: 60, expiresIn: 300 }),
  loginWithSms: async (): Promise<MioAccountView> => ({ status: 'signed-in', user: null, expiresAt: null }),
  loginWithPassword: async (): Promise<MioAccountView> => ({ status: 'signed-in', user: null, expiresAt: null }),
  resetPassword: async () => {},
  getAgreements: async (): Promise<readonly MioAgreement[]> => [],
  skip: () => Promise.resolve(),
}

describe('desktop welcome window', () => {
  it.each(['darwin', 'win32', 'linux'] as const)('keeps the %s preview fixed-size and sandboxed', (platform) => {
    const options = welcomeWindowOptions(platform, resolveDesktopLocale('zh-CN'))
    expect(options).toMatchObject({
      width: 600, height: 700, useContentSize: true, center: true, show: false,
      resizable: false, maximizable: false, fullscreenable: false,
      webPreferences: {
        nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
        additionalArguments: ['--dsh-welcome-locale=zh-CN'],
      },
    })
    expect(options.webPreferences?.preload).toMatch(/preload-welcome\.cjs$/u)
    if (platform === 'darwin') {
      expect(options.vibrancy).toBe('menu')
      expect(options.visualEffectState).toBe('active')
      expect(options.trafficLightPosition).toEqual({ x: 21, y: 21 })
    } else if (platform === 'win32') {
      expect(options.backgroundMaterial).toBe('acrylic')
      expect(options.titleBarOverlay).toMatchObject({ height: 42 })
    } else {
      expect(options.backgroundColor).toBe('#FFFFFF')
      expect(options.vibrancy).toBeUndefined()
      expect(options.backgroundMaterial).toBeUndefined()
    }
  })

  it('waits for its local document and blocks renderer navigation', async () => {
    const window = createWindow()
    const loaded = Promise.withResolvers<undefined>()
    window.loadFile.mockReturnValue(loaded.promise)
    electron.create.mockReturnValue(window)
    const opening = openWelcomeWindow(resolveDesktopLocale('en'), operations)
    expect(window.show).not.toHaveBeenCalled()
    expect(window.loadFile).toHaveBeenCalledWith(join(electron.root, 'renderer', 'welcome.html'))
    expect(window.webContents.setWindowOpenHandler.mock.calls[0]![0]()).toEqual({ action: 'deny' })
    const event = { preventDefault: vi.fn() }
    window.webContents.on.mock.calls[0]![1](event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    loaded.resolve(undefined)
    expect(await opening).toBe(window)
    expect(window.show).toHaveBeenCalledOnce()
  })

  it('destroys a window whose document fails to load', async () => {
    const window = createWindow()
    window.loadFile.mockRejectedValue(new Error('missing welcome document'))
    electron.create.mockReturnValue(window)
    await expect(openWelcomeWindow(resolveDesktopLocale('en'), operations)).rejects.toThrow('missing welcome document')
    expect(window.destroy).toHaveBeenCalledOnce()
    expect(electron.handlers.size).toBe(0)
    expect(window.show).not.toHaveBeenCalled()
  })

  it('does not show a window closed while its document was loading', async () => {
    const window = createWindow()
    window.isDestroyed.mockReturnValue(true)
    electron.create.mockReturnValue(window)
    await openWelcomeWindow(resolveDesktopLocale('en'), operations)
    expect(window.show).not.toHaveBeenCalled()
    expect(window.destroy).not.toHaveBeenCalled()
  })

  it('accepts actions only from its own top frame and removes handlers on close', async () => {
    const window = createWindow()
    electron.create.mockReturnValue(window)
    const getState = vi.fn(operations.getState)
    const sendSmsCode = vi.fn(operations.sendSmsCode)
    const loginWithSms = vi.fn(operations.loginWithSms)
    const loginWithPassword = vi.fn(operations.loginWithPassword)
    const resetPassword = vi.fn(operations.resetPassword)
    const getAgreements = vi.fn(operations.getAgreements)
    const skip = vi.fn(operations.skip)
    await openWelcomeWindow(resolveDesktopLocale('en'), {
      ...operations, getState, sendSmsCode, loginWithSms, loginWithPassword, resetPassword, getAgreements, skip,
    })
    const own = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    const state = electron.handlers.get(WELCOME_IPC.getState)!
    await expect(state({ ...own, senderFrame: {} })).rejects.toThrow('unowned frame')
    expect(getState).not.toHaveBeenCalled()
    expect(await state(own)).toEqual({ status: 'signed-out', user: null, expiresAt: null })
    expect(getState).toHaveBeenCalledOnce()
    const code = electron.handlers.get(WELCOME_IPC.sendSmsCode)!
    await expect(code({ ...own, senderFrame: {} }, {})).rejects.toThrow('unowned frame')
    const smsRequest = { countryCode: '+86', mobile: '13800138000', scene: 'LOGIN' as const }
    expect(await code(own, smsRequest)).toEqual({ smsRequestId: 'sms-1', retryAfterSeconds: 60, expiresIn: 300 })
    expect(sendSmsCode).toHaveBeenCalledExactlyOnceWith(smsRequest)
    const sms = electron.handlers.get(WELCOME_IPC.loginWithSms)!
    await expect(sms({ ...own, senderFrame: {} }, {})).rejects.toThrow('unowned frame')
    const smsLogin = { countryCode: '+86', mobile: '13800138000', smsRequestId: 'sms-1', smsCode: '123456' }
    await sms(own, smsLogin)
    expect(loginWithSms).toHaveBeenCalledExactlyOnceWith(smsLogin)
    const password = electron.handlers.get(WELCOME_IPC.loginWithPassword)!
    const passwordLogin = { countryCode: '+86', mobile: '13800138000', password: 'secret123' }
    await password(own, passwordLogin)
    expect(loginWithPassword).toHaveBeenCalledExactlyOnceWith(passwordLogin)
    const reset = electron.handlers.get(WELCOME_IPC.resetPassword)!
    const resetRequest = {
      countryCode: '+86', mobile: '13800138000', smsRequestId: 'sms-1', smsCode: '123456', newPassword: 'newsecret',
    }
    await reset(own, resetRequest)
    expect(resetPassword).toHaveBeenCalledExactlyOnceWith(resetRequest)
    await electron.handlers.get(WELCOME_IPC.getAgreements)!(own)
    expect(getAgreements).toHaveBeenCalledOnce()
    await electron.handlers.get(WELCOME_IPC.skip)!(own)
    expect(skip).toHaveBeenCalledOnce()
    window.once.mock.calls[0]![1]()
    expect(electron.handlers.size).toBe(0)
  })

  it('does not show a superseded window when its delayed document finishes loading', async () => {
    const previous = createWindow()
    const current = createWindow()
    const loaded = Promise.withResolvers<undefined>()
    previous.loadFile.mockReturnValue(loaded.promise)
    electron.create.mockReturnValueOnce(previous).mockReturnValueOnce(current)
    const opening = openWelcomeWindow(resolveDesktopLocale('en'), operations)
    await openWelcomeWindow(resolveDesktopLocale('en'), operations)
    loaded.resolve(undefined)
    await opening
    expect(previous.show).not.toHaveBeenCalled()
    expect(current.show).toHaveBeenCalledOnce()
    previous.once.mock.calls[0]![1]()
    current.once.mock.calls[0]![1]()
  })

  it('replaces handlers before the previous native window emits closed', async () => {
    const previous = createWindow()
    const current = createWindow()
    electron.create.mockReturnValueOnce(previous).mockReturnValueOnce(current)
    const previousLogin = vi.fn(operations.loginWithSms)
    const currentLogin = vi.fn(operations.loginWithSms)
    await openWelcomeWindow(resolveDesktopLocale('en'), { ...operations, loginWithSms: previousLogin })
    const previousHandler = electron.handlers.get(WELCOME_IPC.loginWithSms)!
    const previousSender = { sender: previous.webContents, senderFrame: previous.webContents.mainFrame }
    await openWelcomeWindow(resolveDesktopLocale('en'), { ...operations, loginWithSms: currentLogin })
    const currentHandler = electron.handlers.get(WELCOME_IPC.loginWithSms)!
    await expect(previousHandler(previousSender)).rejects.toThrow('unowned frame')
    await expect(currentHandler(previousSender)).rejects.toThrow('unowned frame')
    previous.once.mock.calls[0]![1]()
    expect(electron.handlers.get(WELCOME_IPC.loginWithSms)).toBe(currentHandler)
    await currentHandler({ sender: current.webContents, senderFrame: current.webContents.mainFrame })
    expect(currentLogin).toHaveBeenCalledOnce()
    expect(previousLogin).not.toHaveBeenCalled()
    current.once.mock.calls[0]![1]()
    expect(electron.handlers.size).toBe(0)
  })

  it('shows the entry only while the account is signed out', () => {
    expect(needsWelcome({ loggedIn: true })).toBe(false)
    expect(needsWelcome({ loggedIn: false })).toBe(true)
  })
})

it('accepts only permitted event fields and reads the current policy over IPC', async () => {
  const window = createWindow()
  electron.create.mockReturnValue(window)
  const analytics = vi.fn(async () => {})
  let enabled = true
  await openWelcomeWindow(resolveDesktopLocale('en'), { ...operations, analytics, analyticsEnabled: async () => enabled })
  const own = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
  const policy = electron.handlers.get(WELCOME_IPC.analyticsEnabled)!
  expect(await policy(own)).toBe(true)
  enabled = false
  expect(await policy(own)).toBe(false)
  const report = electron.handlers.get(WELCOME_IPC.analytics)!
  await report(own, 'auth_page_click', { button_name: 'sign_in' })
  expect(analytics).toHaveBeenLastCalledWith('auth_page_click', { button_name: 'sign_in' })
  await expect(report(own, 'auth_page_click', { button_name: 'api-key' })).rejects.toThrow('invalid analytics')
  await expect(report(own, 'auth_page_click', { button_name: 'sign_in', token: 'private' })).rejects.toThrow('invalid analytics')
  await expect(report(own, 'desktop_app_launch', {})).rejects.toThrow('invalid analytics')
  await expect(report(own, 'auth_page_view', null)).rejects.toThrow('invalid analytics')
  await report(own, 'auth_page_view', {})
  expect(analytics).toHaveBeenLastCalledWith('auth_page_view', {})
})
