// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MarketUpdateDot, type MarketUpdateDotProps } from '../src/client/MarketUpdateDot.tsx'
import type { MioMarketState } from '../src/client/market-store.ts'
import { en, type MioPluginMarketKey } from '../src/client/locales.ts'

const PACKAGE = '@q253595422/dsh-imagegen-video'
const ITEM = {
  pluginId: '1', pluginName: 'AI 生图', packageName: PACKAGE, category: 'image',
  description: 'Generate', hasPreset: true,
}

afterEach(cleanup)

function props(state: Partial<MioMarketState>): MarketUpdateDotProps {
  const full: MioMarketState = {
    status: 'ready', items: [ITEM], installed: [PACKAGE], installedVersions: {}, latestVersions: {},
    updating: null, updateError: '', error: '',
    ...state,
  }
  return {
    useMarket: (selector: (value: MioMarketState) => unknown) => selector(full),
    ensure: vi.fn(),
    reload: vi.fn(),
    update: vi.fn(),
    t: (key: MioPluginMarketKey) => en[key],
  } as unknown as MarketUpdateDotProps
}

describe('market update dot', () => {
  it('draws a named dot while an installed plugin has a newer version', () => {
    render(<MarketUpdateDot {...props({
      installedVersions: { [PACKAGE]: '1.0.0' }, latestVersions: { [PACKAGE]: '2.0.0' },
    })} />)
    expect(screen.getByRole('img', { name: en.updateAvailableDot })).toBeDefined()
  })

  it('draws nothing while every installed plugin is current', () => {
    render(<MarketUpdateDot {...props({
      installedVersions: { [PACKAGE]: '2.0.0' }, latestVersions: { [PACKAGE]: '2.0.0' },
    })} />)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('starts the catalog read when it mounts', () => {
    const ensure = vi.fn()
    render(<MarketUpdateDot {...props({})} ensure={ensure} />)
    expect(ensure).toHaveBeenCalledTimes(1)
  })
})
