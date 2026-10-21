import type {
  MioAccountView, MioAgreement, MioPasswordLoginRequest, MioResetPasswordRequest, MioSmsCode,
  MioSmsCodeRequest, MioSmsLoginRequest,
} from '@deepseek-ai/dsh-mio-account/types'
/** Localized welcome copy and mioagent login actions. */

import { contextBridge, ipcRenderer } from 'electron'
import { resolveDesktopLocale } from './locale.ts'
import { WELCOME_IPC, type WelcomeApi } from './welcome-api.ts'

const prefix = '--dsh-welcome-locale='
const locale = process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
if (locale === undefined) throw new Error('desktop welcome: missing window locale')
const api: WelcomeApi = {
  ...resolveDesktopLocale(locale),
  analytics: async (eventName, attributes) => {
    if (await api.analyticsEnabled()) await ipcRenderer.invoke(WELCOME_IPC.analytics, eventName, attributes)
  },
  analyticsEnabled: () => ipcRenderer.invoke(WELCOME_IPC.analyticsEnabled) as Promise<boolean>,
  getState: () => ipcRenderer.invoke(WELCOME_IPC.getState) as Promise<MioAccountView>,
  sendSmsCode: (request: MioSmsCodeRequest) => ipcRenderer.invoke(WELCOME_IPC.sendSmsCode, request) as Promise<MioSmsCode>,
  loginWithSms: (request: MioSmsLoginRequest) => ipcRenderer.invoke(WELCOME_IPC.loginWithSms, request) as Promise<MioAccountView>,
  loginWithPassword: (request: MioPasswordLoginRequest) =>
    ipcRenderer.invoke(WELCOME_IPC.loginWithPassword, request) as Promise<MioAccountView>,
  resetPassword: (request: MioResetPasswordRequest) => ipcRenderer.invoke(WELCOME_IPC.resetPassword, request) as Promise<void>,
  getAgreements: () => ipcRenderer.invoke(WELCOME_IPC.getAgreements) as Promise<readonly MioAgreement[]>,
  skip: () => ipcRenderer.invoke(WELCOME_IPC.skip) as Promise<void>,
}
contextBridge.exposeInMainWorld('dshWelcome', api)
