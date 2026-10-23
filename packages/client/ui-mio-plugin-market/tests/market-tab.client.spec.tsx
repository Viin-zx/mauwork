// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MioMarketTab, type MioMarketTabProps } from '../src/client/MioMarketTab.tsx'
import type { MioMarketState } from '../src/client/market-store.ts'
import type { MioPluginMarketKey } from '../src/client/locales.ts'
import { en } from '../src/client/locales.ts'

const PACKAGE = '@q253595422/dsh-imagegen-video'
const ITEM = {
  pluginId: '1', pluginName: 'AI 生图', packageName: PACKAGE, category: 'image',
  description: 'Generate', hasPreset: true,
}

afterEach(cleanup)

function props(state: Partial<MioMarketState>, overrides: Partial<MioMarketTabProps> = {}): MioMarketTabProps {
  const full: MioMarketState = {
    status: 'ready', items: [], installed: [], installedVersions: {}, latestVersions: {},
    updating: null, updateError: '', error: '',
    ...state,
  }
  return {
    install: vi.fn(),
    openPackage: vi.fn(),
    update: vi.fn(),
    useMarket: (selector: (value: MioMarketState) => unknown) => selector(full),
    ensure: vi.fn(),
    reload: vi.fn(),
    t: (key: MioPluginMarketKey) => key,
    ...overrides,
  } as unknown as MioMarketTabProps
}

describe('mio plugin market tab', () => {
  it('lists catalog entries and installs by package name', () => {
    const install = vi.fn()
    render(<MioMarketTab {...props({
      status: 'ready', installed: [], error: '',
      items: [{
        pluginId: '1', pluginName: 'AI 生图', packageName: PACKAGE, category: 'image',
        description: 'Generate', hasPreset: true,
      }],
    }, { install })} />)

    expect(screen.getByText('AI 生图')).toBeDefined()
    expect(screen.getByText(PACKAGE)).toBeDefined()
    expect(screen.getByText('autoConfigured')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'install' }))
    expect(install).toHaveBeenCalledExactlyOnceWith({ spec: PACKAGE, title: 'AI 生图', version: 'latest' })
  })

  it('opens an installed plugin instead of installing it again', () => {
    const install = vi.fn()
    const openPackage = vi.fn()
    render(<MioMarketTab {...props({
      status: 'ready', installed: [PACKAGE], error: '',
      items: [{
        pluginId: '1', pluginName: 'AI 生图', packageName: PACKAGE, category: '',
        description: '', hasPreset: false,
      }],
    }, { install, openPackage })} />)

    fireEvent.click(screen.getByRole('button', { name: 'installed' }))
    expect(openPackage).toHaveBeenCalledExactlyOnceWith(PACKAGE)
    expect(install).not.toHaveBeenCalled()
  })

  it('renders loading, empty, and failure states', () => {
    const { rerender } = render(<MioMarketTab {...props({
      status: 'loading', items: [], installed: [], error: '',
    })} />)
    expect(screen.getByRole('status').textContent).toBe('loading')

    rerender(<MioMarketTab {...props({ status: 'ready', items: [], installed: [], error: '' })} />)
    expect(screen.getByText('empty')).toBeDefined()

    rerender(<MioMarketTab {...props({ status: 'error', items: [], installed: [], error: 'offline' })} />)
    expect(screen.getByRole('alert').textContent).toContain('offline')
  })

  it('asks for the catalog when the tab first renders', () => {
    const ensure = vi.fn()
    render(<MioMarketTab {...props({ status: 'idle', items: [], installed: [], error: '' }, { ensure })} />)
    expect(ensure).toHaveBeenCalledTimes(1)
  })

  it('offers an update only when the registry version is newer', () => {
    const { container } = render(<MioMarketTab {...props({
      items: [ITEM], installed: [PACKAGE],
      installedVersions: { [PACKAGE]: '1.0.0' }, latestVersions: { [PACKAGE]: '1.0.0' },
    })} />)
    expect(container.querySelector('[data-testid="mio-plugin-market"]')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'update' })).toBeNull()

    cleanup()
    render(<MioMarketTab {...props({
      items: [ITEM], installed: [PACKAGE],
      installedVersions: { [PACKAGE]: '1.0.0' }, latestVersions: { [PACKAGE]: '2.0.0' },
    })} />)
    expect(screen.getByRole('button', { name: 'update' })).toBeDefined()
  })

  it('confirms the update before handing the latest version to the page', () => {
    const update = vi.fn()
    const install = vi.fn()
    const translate = (key: MioPluginMarketKey, params?: Record<string, unknown>): string => {
      let text: string = en[key]
      for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
      return text
    }
    render(<MioMarketTab {...props({
      items: [ITEM], installed: [PACKAGE],
      installedVersions: { [PACKAGE]: '1.0.0' }, latestVersions: { [PACKAGE]: '2.0.0' },
    }, { update, install, t: translate })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    const dialog = screen.getByRole('dialog')
    // The confirmation names both versions and the remove-then-reinstall step.
    expect(dialog.textContent).toContain('1.0.0')
    expect(dialog.textContent).toContain('2.0.0')
    expect(dialog.textContent).toContain('uninstalled')
    expect(dialog.textContent).toContain('reinstalled')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }))

    expect(update).toHaveBeenCalledExactlyOnceWith(ITEM, install)
  })

  it('localizes a restart-bound update failure', () => {
    render(<MioMarketTab {...props({ updateError: 'restart-required' })} />)
    expect(screen.getByRole('alert').textContent).toBe('restartToUpdate')
  })
})
