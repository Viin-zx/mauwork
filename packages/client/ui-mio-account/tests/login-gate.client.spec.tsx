// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LoginGate, type LoginGateProps } from '../src/client/LoginGate.tsx'
import type { MioAccountState } from '../src/client/account-state.ts'
import type { MioAccountOperations } from '../src/client/operations.ts'
import { SIGNED_IN, SIGNED_OUT, staticAccount, stubOperations, translate } from './harness.client.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function props(state: MioAccountState, overrides: Partial<MioAccountOperations> = {}): LoginGateProps {
  // Framework-standard hooks are absent in a direct component render; the gate
  // itself only reads the account face and localized copy.
  return { useAccount: staticAccount(state), t: translate, ...stubOperations(overrides) } as LoginGateProps
}

describe('login gate', () => {
  it('shows only the branded loading surface until the first snapshot', () => {
    render(<LoginGate {...props({ view: undefined, expired: false })} />)
    expect(screen.getByTestId('mio-login-gate')).toBeDefined()
    expect(screen.getByRole('status').textContent).toBe('loading')
    expect(screen.queryByTestId('mio-login-form')).toBeNull()
  })

  it('renders the full-screen form while signed out', async () => {
    const getAgreements = vi.fn(async () => [])
    render(<LoginGate {...props({ view: SIGNED_OUT, expired: false }, { getAgreements })} />)
    expect(screen.getByRole('dialog', { name: 'title' })).toBeDefined()
    expect(screen.getByTestId('mio-login-form')).toBeDefined()
    expect(screen.queryByText('sessionExpired')).toBeNull()
    await vi.waitFor(() => { expect(getAgreements).toHaveBeenCalledTimes(1) })
  })

  it('surfaces the expired-session notice', () => {
    render(<LoginGate {...props({ view: SIGNED_OUT, expired: true })} />)
    expect(screen.getByText('sessionExpired')).toBeDefined()
  })

  it('renders nothing once the account signs in and removes the gate after a transition', () => {
    const { rerender } = render(<LoginGate {...props({ view: SIGNED_OUT, expired: false })} />)
    expect(screen.queryByTestId('mio-login-gate')).toBeDefined()
    rerender(<LoginGate {...props({ view: SIGNED_IN, expired: false })} />)
    expect(screen.queryByTestId('mio-login-gate')).toBeNull()
    expect(screen.queryByTestId('mio-login-form')).toBeNull()
  })

  it('keeps the gate closed for a signed-in account on first render', () => {
    render(<LoginGate {...props({ view: SIGNED_IN, expired: false })} />)
    expect(screen.queryByTestId('mio-login-gate')).toBeNull()
  })

  it('makes the application columns inert until the gate closes', () => {
    const frame = document.createElement('div')
    const seat = document.createElement('section')
    seat.setAttribute('data-shell-overlay', '')
    const background = document.createElement('button')
    frame.append(seat, background)
    document.body.append(frame)
    const host = document.createElement('div')
    seat.append(host)
    const { unmount } = render(<LoginGate {...props({ view: SIGNED_OUT, expired: false })} />, { container: host })
    expect(background.inert).toBe(true)
    expect(seat.inert).not.toBe(true)
    unmount()
    expect(background.inert).not.toBe(true)
    frame.remove()
  })

  it('cannot be dismissed with Escape', () => {
    render(<LoginGate {...props({ view: SIGNED_OUT, expired: false })} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('mio-login-gate')).toBeDefined()
  })
})
