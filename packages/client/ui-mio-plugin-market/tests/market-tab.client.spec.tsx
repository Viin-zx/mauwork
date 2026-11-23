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

/** English copy with every `{param}` replaced, for tests that read rendered sentences. */
function enText(key: MioPluginMarketKey, params?: Record<string, unknown>): string {
  let text: string = en[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}

function props(
  state: Partial<MioMarketState>,
  overrides: Partial<MioMarketTabProps> = {},
  translate: (key: MioPluginMarketKey, params?: Record<string, unknown>) => string = key => key,
  pinned: readonly string[] = [],
): MioMarketTabProps {
  const full: MioMarketState = {
    status: 'ready', items: [], installed: [], installedVersions: {}, latestVersions: {},
    updating: null, updateError: '', error: '',
    updatingAll: null, updateAllError: null, updateAllRestart: 0,
    ...state,
  }
  return {
    install: vi.fn(),
    openPackage: vi.fn(),
    update: vi.fn(),
    updateAll: vi.fn(),
    togglePin: vi.fn(),
    useMarket: (selector: (value: MioMarketState) => unknown) => selector(full),
    usePinned: (selector: (value: readonly string[]) => unknown) => selector(pinned),
    ensure: vi.fn(),
    reload: vi.fn(),
    t: translate,
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
    expect(screen.queryByRole('button', { name: 'updateAll' })).toBeNull()

    cleanup()
    render(<MioMarketTab {...props({
      items: [ITEM], installed: [PACKAGE],
      installedVersions: { [PACKAGE]: '1.0.0' }, latestVersions: { [PACKAGE]: '2.0.0' },
    })} />)
    expect(screen.getByRole('button', { name: 'update' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'updateAll' })).toBeDefined()
  })

  it('updates every newer plugin at once after listing the replacements', () => {
    const second = { ...ITEM, pluginName: 'Video', packageName: '@scope/video' }
    const updateAll = vi.fn()
    const { container } = render(<MioMarketTab {...props({
      items: [ITEM, second], installed: [PACKAGE, second.packageName],
      installedVersions: { [PACKAGE]: '1.0.0', [second.packageName]: '2.0.0' },
      latestVersions: { [PACKAGE]: '2.0.0', [second.packageName]: '3.0.0' },
    }, { updateAll }, enText)} />)

    const header = container.querySelector('header') as HTMLElement
    expect(within(header).getAllByRole('button').map(button => button.textContent))
      .toEqual(['Update all (2)', 'Refresh'])
    fireEvent.click(screen.getByRole('button', { name: 'Update all (2)' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('AI 生图')).toBeDefined()
    expect(within(dialog).getByText('1.0.0 → 2.0.0')).toBeDefined()
    expect(within(dialog).getByText('Video')).toBeDefined()
    expect(within(dialog).getByText('2.0.0 → 3.0.0')).toBeDefined()

    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Cancel' }).at(-1) as HTMLElement)
    expect(updateAll).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Update all (2)' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Update all' }))
    expect(updateAll).toHaveBeenCalledTimes(1)
  })

  it('shows update-all progress, the restart notice, and the reason a run stopped', () => {
    const { rerender } = render(<MioMarketTab {...props({
      items: [ITEM], installed: [PACKAGE],
      installedVersions: { [PACKAGE]: '1.0.0' }, latestVersions: { [PACKAGE]: '2.0.0' },
      updatingAll: { done: 0, total: 2, packageName: PACKAGE, pluginName: 'AI 生图' },
    })} />)
    expect(screen.getByRole('status').textContent).toBe('updatingAll')
    expect(screen.getByRole('button', { name: 'updating' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'updateAll' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'refresh' }).hasAttribute('disabled')).toBe(true)

    rerender(<MioMarketTab {...props({ updateAllRestart: 2 })} />)
    expect(screen.getByRole('status').textContent).toBe('updateAllRestartNotice')

    const stopped = { packageName: PACKAGE, pluginName: 'AI 生图', reason: '' }
    rerender(<MioMarketTab {...props({ updateAllError: { ...stopped, kind: 'restart-required' } }, {}, enText)} />)
    expect(screen.getByRole('alert').textContent)
      .toBe(enText('updateAllRestartRequired', { name: 'AI 生图' }))

    rerender(<MioMarketTab {...props({
      updateAllError: { ...stopped, kind: 'build-approval', reason: 'approve esbuild' },
    }, {}, enText)} />)
    expect(screen.getByRole('alert').textContent).toBe(enText('updateAllNeedsApproval', { name: 'AI 生图' }))

    rerender(<MioMarketTab {...props({ updateAllError: { ...stopped, kind: 'failed', reason: 'offline' } }, {}, enText)} />)
    expect(screen.getByRole('alert').textContent).toBe(`${enText('updateAllFailed', { name: 'AI 生图' })} offline`)

    rerender(<MioMarketTab {...props({ updateAllError: { ...stopped, kind: 'failed', reason: '' } }, {}, enText)} />)
    expect(screen.getByRole('alert').textContent).toBe(enText('updateAllFailed', { name: 'AI 生图' }))
  })

  it('confirms the update before handing the latest version to the page', () => {
    const update = vi.fn()
    const install = vi.fn()
    render(<MioMarketTab {...props({
      items: [ITEM], installed: [PACKAGE],
      installedVersions: { [PACKAGE]: '1.0.0' }, latestVersions: { [PACKAGE]: '2.0.0' },
    }, { update, install }, enText)} />)

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

  it('toggles the pin of the entry it belongs to', () => {
    const togglePin = vi.fn()
    const { rerender } = render(<MioMarketTab {...props({ items: [ITEM] }, { togglePin })} />)
    const pin = screen.getByRole('button', { name: 'pin' })
    expect(pin.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(pin)
    expect(togglePin).toHaveBeenCalledExactlyOnceWith(PACKAGE)

    rerender(<MioMarketTab {...props({ items: [ITEM] }, { togglePin }, undefined, [PACKAGE])} />)
    const unpin = screen.getByRole('button', { name: 'unpin' })
    expect(unpin.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(unpin)
    expect(togglePin).toHaveBeenLastCalledWith(PACKAGE)
  })

  it('renders pinned entries first in pin order', () => {
    const second = { ...ITEM, pluginName: 'Video', packageName: '@scope/video' }
    const third = { ...ITEM, pluginName: 'Audio', packageName: '@scope/audio' }
    render(<MioMarketTab {...props(
      { items: [ITEM, second, third] }, {}, undefined, [third.packageName, PACKAGE],
    )} />)
    const names = screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)
    expect(names).toEqual(['Audio', 'AI 生图', 'Video'])
  })
})
