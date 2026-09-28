import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'

vi.mock('@renderer-notifications/rendererNotificationPort', () => ({
  notifyRenderer: vi.fn()
}))

const buttonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>'
})

const passthroughStub = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const route = {
  name: 'settings-about'
}

const deviceClientMock = vi.hoisted(() => ({
  getAppVersion: vi.fn()
}))
const windowClientMock = vi.hoisted(() => ({
  startGuidedOnboarding: vi.fn(),
  onSettingsCheckForUpdates: vi.fn().mockImplementation((listener: () => void) => {
    const wrapped = () => listener()
    window.electron?.ipcRenderer?.on('settings:check-for-updates', wrapped)
    return () => window.electron?.ipcRenderer?.removeListener('settings:check-for-updates', wrapped)
  })
}))

const upgradeStoreMock = {
  shouldShowUpdateNotes: true,
  updateInfo: {
    version: '1.0.0-beta.4',
    releaseNotes: '- Added floating window'
  },
  showManualDownloadOptions: true,
  updateError: 'network failed',
  isChecking: false,
  isDownloading: false,
  isRestarting: false,
  updateProgress: null,
  isReadyToInstall: false,
  isMockUpdate: false,
  updateState: 'error',
  refreshStatus: vi.fn().mockResolvedValue('error'),
  checkUpdate: vi.fn().mockResolvedValue('error'),
  handleUpdate: vi.fn().mockResolvedValue(undefined)
}

vi.mock('@api/DeviceClient', () => ({
  createDeviceClient: () => deviceClientMock
}))
vi.mock('@api/WindowClient', () => ({
  createWindowClient: () => windowClientMock
}))

vi.mock('@/stores/upgrade', () => ({
  useUpgradeStore: () => upgradeStoreMock
}))

vi.mock('@/stores/language', () => ({
  useLanguageStore: () => ({
    dir: 'ltr'
  })
}))

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({
    isDark: true
  })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: { version?: string; title?: string; count?: number }) => {
      const messages: Record<string, string> = {
        'about.title': 'DeepChat',
        'about.description': 'DeepChat description',
        'about.website': '访问我们的网站',
        'about.feedbackButton': '意见反馈',
        'about.disclaimerButton': '免责声明',
        'about.checkUpdateButton': '检查更新',
        'about.disclaimerTitle': '免责声明',
        'update.versionAvailable': `${params?.version ?? ''} 可用`,
        'update.autoUpdateFailed': '自动更新可能不稳定，请手动下载更新',
        'update.githubDownload': 'GitHub 下载',
        'update.officialDownload': '官网下载',
        'update.installNow': '立即安装',
        'update.installUpdate': '安装更新',
        'update.downloading': '下载中',
        'settings.about.checking': '检查中',
        'common.close': '关闭',
        searchDisclaimer: 'disclaimer'
      }

      return messages[key] ?? key
    }
  })
}))

vi.mock('vue-router', () => ({
  useRoute: () => route
}))

describe('AboutUsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deviceClientMock.getAppVersion.mockReset()
    upgradeStoreMock.refreshStatus.mockReset()
    upgradeStoreMock.checkUpdate.mockReset()
    upgradeStoreMock.handleUpdate.mockReset()
    deviceClientMock.getAppVersion.mockResolvedValue('1.0.0-beta.3')
    upgradeStoreMock.refreshStatus.mockResolvedValue('error')
    upgradeStoreMock.checkUpdate.mockResolvedValue('error')
    upgradeStoreMock.handleUpdate.mockResolvedValue(undefined)
    Object.assign(upgradeStoreMock, {
      shouldShowUpdateNotes: true,
      updateInfo: {
        version: '1.0.0-beta.4',
        releaseNotes: '- Added floating window'
      },
      showManualDownloadOptions: true,
      updateError: 'network failed',
      isChecking: false,
      isDownloading: false,
      isRestarting: false,
      updateProgress: null,
      isReadyToInstall: false,
      isMockUpdate: false,
      updateState: 'error'
    })
    Object.assign(window, {
      electron: {
        ipcRenderer: {
          on: vi.fn(),
          removeListener: vi.fn()
        }
      },
      api: {
        openExternal: vi.fn()
      }
    })
  })

  it('renders fallback download actions in the bottom action row', async () => {
    const { default: AboutUsSettings } =
      await import('../../../src/renderer/settings/components/AboutUsSettings.vue')

    const wrapper = mount(AboutUsSettings, {
      global: {
        stubs: {
          DcButton: buttonStub,
          Icon: true,
          NodeRenderer: passthroughStub('NodeRenderer')
        }
      }
    })

    await flushPromises()

    const buttons = wrapper.findAll('button').map((button) => button.text())
    expect(buttons).toEqual(['GitHub 下载', '官网下载', '检查更新'])

    const officialButton = wrapper.findAll('button').find((button) => button.text() === '官网下载')
    expect(officialButton).toBeTruthy()

    await officialButton!.trigger('click')

    expect(upgradeStoreMock.handleUpdate).toHaveBeenCalledWith('official')
  })

  it('subscribes to tray update checks before initial presenter calls resolve', async () => {
    let resolveAppVersion: ((value: string) => void) | null = null
    deviceClientMock.getAppVersion.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveAppVersion = resolve
      })
    )

    const { default: AboutUsSettings } =
      await import('../../../src/renderer/settings/components/AboutUsSettings.vue')

    const wrapper = mount(AboutUsSettings, {
      global: {
        stubs: {
          DcButton: buttonStub,
          Icon: true,
          NodeRenderer: passthroughStub('NodeRenderer')
        }
      }
    })

    const handler = windowClientMock.onSettingsCheckForUpdates.mock.calls.at(-1)?.[0] as
      | (() => Promise<void>)
      | undefined
    expect(handler).toBeTypeOf('function')

    await handler?.()

    expect(upgradeStoreMock.checkUpdate).toHaveBeenCalledWith(false)

    resolveAppVersion?.('1.0.0-beta.3')
    await flushPromises()
    wrapper.unmount()
  })

  it('does not trigger install flow for external check requests when update is ready to install', async () => {
    upgradeStoreMock.showManualDownloadOptions = false
    upgradeStoreMock.updateError = null
    upgradeStoreMock.isReadyToInstall = true
    upgradeStoreMock.updateState = 'ready_to_install'

    const { default: AboutUsSettings } =
      await import('../../../src/renderer/settings/components/AboutUsSettings.vue')

    const wrapper = mount(AboutUsSettings, {
      global: {
        stubs: {
          DcButton: buttonStub,
          Icon: true,
          NodeRenderer: passthroughStub('NodeRenderer')
        }
      }
    })

    await flushPromises()

    const handler = windowClientMock.onSettingsCheckForUpdates.mock.calls.at(-1)?.[0] as
      | (() => Promise<void>)
      | undefined
    expect(handler).toBeTypeOf('function')

    await handler?.()

    expect(upgradeStoreMock.handleUpdate).not.toHaveBeenCalled()
    expect(upgradeStoreMock.checkUpdate).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('shows a confirmation toast when no update is available', async () => {
    upgradeStoreMock.showManualDownloadOptions = false
    upgradeStoreMock.updateError = null
    upgradeStoreMock.updateState = 'idle'
    upgradeStoreMock.checkUpdate.mockResolvedValueOnce('not-available')

    const { default: AboutUsSettings } =
      await import('../../../src/renderer/settings/components/AboutUsSettings.vue')

    const wrapper = mount(AboutUsSettings, {
      global: {
        stubs: {
          DcButton: buttonStub,
          Icon: true,
          NodeRenderer: passthroughStub('NodeRenderer')
        }
      }
    })

    await flushPromises()
    const checkButton = wrapper.findAll('button').find((button) => button.text() === '检查更新')
    expect(checkButton).toBeTruthy()

    await checkButton!.trigger('click')
    await flushPromises()

    expect(upgradeStoreMock.checkUpdate).toHaveBeenCalledWith(false)
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        code: 'settings.about.alreadyUpToDate',
        title: 'update.alreadyUpToDate'
      })
    )

    wrapper.unmount()
  })

  it('does not render debug mock controls or create their clients', async () => {
    const { default: AboutUsSettings } =
      await import('../../../src/renderer/settings/components/AboutUsSettings.vue')

    const wrapper = mount(AboutUsSettings, {
      global: {
        stubs: {
          DcButton: buttonStub,
          Icon: true,
          NodeRenderer: passthroughStub('NodeRenderer')
        }
      }
    })

    await flushPromises()

    expect(wrapper.text()).not.toContain('模拟已下载更新')
    expect(wrapper.text()).not.toContain('清除模拟更新')
    expect(wrapper.text()).not.toContain('模拟首次进入引导')
    expect(wrapper.text()).not.toContain('创建长会话Mock数据')
    expect(windowClientMock.startGuidedOnboarding).not.toHaveBeenCalled()
  })
})
