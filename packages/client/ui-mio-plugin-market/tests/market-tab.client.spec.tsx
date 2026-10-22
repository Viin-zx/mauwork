// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MioMarketTab, type MioMarketTabProps } from '../src/client/MioMarketTab.tsx'
import type { MioMarketState } from '../src/client/market-store.ts'
import type { MioPluginMarketKey } from '../src/client/locales.ts'

const PACKAGE = '@q253595422/dsh-imagegen-video'

afterEach(cleanup)

function props(state: MioMarketState, overrides: Partial<MioMarketTabProps> = {}): MioMarketTabProps {
  return {
    install: vi.fn(),
    openPackage: vi.fn(),
    useMarket: (selector: (value: MioMarketState) => unknown) => selector(state),
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
})
