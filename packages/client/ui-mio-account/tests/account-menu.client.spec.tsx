// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AccountMenu, type AccountMenuProps } from '../src/client/AccountMenu.tsx'
import type { MioAccountState } from '../src/client/account-state.ts'
import type { MioAccountOperations } from '../src/client/operations.ts'
import { SIGNED_IN, SIGNED_OUT, USER, staticAccount, stubOperations, translate } from './harness.client.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function props(state: MioAccountState, overrides: Partial<MioAccountOperations> = {}): AccountMenuProps {
  // Framework-standard hooks are absent in a direct component render; the
  // launcher only reads the account face, owner width, and localized copy.
  return {
    wide: true,
    settingsOpen: false,
    openSettings: vi.fn(),
    openOnboarding: vi.fn(),
    useAccount: staticAccount(state),
    t: translate,
    ...stubOperations(overrides),
  } as AccountMenuProps
}

const SIGNED_IN_EMPTY_NAME: MioAccountState = {
  view: { status: 'signed-in', user: { ...USER, nickname: '' } },
  expired: false,
}

describe('account launcher', () => {
  it('renders nothing before the account resolves or while signed out', () => {
    const { container, rerender } = render(<AccountMenu {...props({ view: undefined, expired: false })} />)
    expect(container.firstElementChild).toBeNull()
    rerender(<AccountMenu {...props({ view: SIGNED_OUT, expired: false })} />)
    expect(container.firstElementChild).toBeNull()
  })

  it('shows the nickname and falls back to the masked phone', () => {
    const { rerender } = render(<AccountMenu {...props({ view: SIGNED_IN, expired: false })} />)
    expect(screen.getByRole('button', { name: 'Tester' })).toBeDefined()
    rerender(<AccountMenu {...props(SIGNED_IN_EMPTY_NAME)} />)
    expect(screen.getByRole('button', { name: '138****0000' })).toBeDefined()
  })

  it('hides the visible label in the collapsed rail', () => {
    render(<AccountMenu {...props({ view: SIGNED_IN, expired: false })} wide={false} />)
    expect(screen.getByRole('button', { name: 'Tester' })).toBeDefined()
    expect(screen.queryByText('Tester')).toBeNull()
  })

  it('closes the open menu with Escape', () => {
    render(<AccountMenu {...props({ view: SIGNED_IN, expired: false })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tester' }))
    expect(screen.getByRole('menuitem', { name: 'signOut' })).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menuitem', { name: 'signOut' })).toBeNull()
  })

  it('opens settings from the account menu', () => {
    const openSettings = vi.fn()
    render(<AccountMenu {...props({ view: SIGNED_IN, expired: false })} openSettings={openSettings} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tester' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'settings' }))
    expect(openSettings).toHaveBeenCalledOnce()
  })

  it('signs out from the account menu', async () => {
    const logout = vi.fn(async () => SIGNED_OUT)
    render(<AccountMenu {...props({ view: SIGNED_IN, expired: false }, { logout })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tester' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'signOut' }))
    await act(async () => {})
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('reports a failed sign-out and clears the notice when it finishes', async () => {
    vi.useFakeTimers()
    const logout = vi.fn(async () => { throw new Error('offline') })
    render(<AccountMenu {...props({ view: SIGNED_IN, expired: false }, { logout })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tester' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'signOut' }))
    await act(async () => {})
    expect(screen.getByText('signOutFailed')).toBeDefined()
    await act(async () => { vi.advanceTimersByTime(4000) })
    expect(screen.queryByText('signOutFailed')).toBeNull()
  })
})
