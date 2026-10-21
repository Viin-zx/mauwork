// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { MioOrderStatus, MioSubscription } from '@deepseek-ai/dsh-mio-account/types'
import { AccountSection, type AccountSectionProps } from '../src/client/AccountSection.tsx'
import type { MioAccountOperations } from '../src/client/operations.ts'
import type { MioAccountState } from '../src/client/account-state.ts'
import {
  ORDER, PLAN, PURCHASE, SIGNED_IN, SIGNED_OUT, staticAccount, stubOperations, translate,
} from './harness.client.ts'

vi.mock('qrcode/lib/browser.js', () => ({ toDataURL: vi.fn(async () => 'data:image/png;base64,stub') }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const SUBSCRIPTION: MioSubscription = {
  subscriptionId: 7, planId: 1, planName: 'Monthly', amountTotal: 44_000_000, amountUsed: 500_000,
  startTime: '2026-10-01 00:00:00', endTime: '2026-11-01 00:00:00', status: 'active',
  lastResetTime: null, nextResetTime: null, allowWalletOverflow: false,
}

function props(state: MioAccountState, overrides: Partial<MioAccountOperations> = {}): AccountSectionProps {
  return {
    close: vi.fn(),
    useAccount: staticAccount(state),
    t: translate,
    ...stubOperations(overrides),
  } as AccountSectionProps
}

describe('account settings section', () => {
  it('shows the account projection, quota, and usage', async () => {
    render(<AccountSection {...props({ view: SIGNED_IN, expired: false })} />)

    expect(await screen.findByTestId('mio-account-card')).toBeDefined()
    expect(screen.getAllByText('Tester').length).toBeGreaterThan(0)
    expect(screen.getAllByText('138****0000').length).toBeGreaterThan(0)
    expect(screen.getByText('¥5.00')).toBeDefined()
    expect(screen.getByText('¥2.00')).toBeDefined()
    expect(screen.getByText('noSubscription')).toBeDefined()
  })

  it('renders nothing while signed out', () => {
    const { container } = render(<AccountSection {...props({ view: SIGNED_OUT, expired: false })} />)
    expect(container.firstElementChild).toBeNull()
  })

  it('lists subscriptions with remaining quota and the delayed-data hint', async () => {
    render(<AccountSection {...props({ view: SIGNED_IN, expired: false }, {
      getSubscriptions: vi.fn(async () => ({ items: [SUBSCRIPTION], realtime: false })),
    })} />)

    expect(await screen.findByText('Monthly')).toBeDefined()
    expect(screen.getByText('¥87.00')).toBeDefined()
    expect(screen.getByText('subscriptionActive')).toBeDefined()
    expect(screen.getByText('dataDelayed')).toBeDefined()
  })

  it('reports a failed quota read and keeps the section usable', async () => {
    render(<AccountSection {...props({ view: SIGNED_IN, expired: false }, {
      getQuota: vi.fn(async () => { throw new Error('offline') }),
    })} />)

    expect((await screen.findByRole('alert')).textContent).toBe('offline')
  })

  it('opens the change-password dialog', async () => {
    render(<AccountSection {...props({ view: SIGNED_IN, expired: false })} />)

    fireEvent.click(await screen.findByRole('button', { name: 'changePassword' }))
    expect(await screen.findByText('changePasswordTitle')).toBeDefined()
    expect(screen.getByText('changePasswordDescription')).toBeDefined()
  })

  it('closes settings after a successful password change', async () => {
    const close = vi.fn()
    render(<AccountSection {...props({ view: SIGNED_IN, expired: false })} close={close} />)

    fireEvent.click(await screen.findByRole('button', { name: 'changePassword' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'code' }), { target: { value: '654321' } })
    fireEvent.change(screen.getByLabelText('newPassword'), { target: { value: 'newsecret123' } })
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'newsecret123' } })
    fireEvent.submit(screen.getByTestId('mio-reset-form'))
    await act(async () => {})

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('buys a plan, shows the QR code, and refreshes after payment', async () => {
    const pending = Promise.withResolvers<MioOrderStatus>()
    const getOrder = vi.fn(() => pending.promise)
    const purchasePlan = vi.fn(async () => PURCHASE)
    const getSubscriptions = vi.fn(async () => ({ items: [], realtime: true }))
    render(<AccountSection {...props({ view: SIGNED_IN, expired: false }, {
      getOrder, purchasePlan, getSubscriptions,
    })} />)

    fireEvent.click(await screen.findByRole('button', { name: 'upgradePlan' }))
    expect(await screen.findByText(PLAN.planName)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'purchase' }))

    expect(await screen.findByAltText('payQrTitle')).toBeDefined()
    expect(purchasePlan).toHaveBeenCalledWith({
      planId: PLAN.planId, requestId: expect.stringMatching(/^mio-[0-9a-z]+$/u),
    })
    expect(screen.getByText(/ord-1/u)).toBeDefined()

    await act(async () => { pending.resolve({ ...ORDER, paymentStatus: 'PAID' }) })
    expect(await screen.findByText('paySuccess')).toBeDefined()
    expect(getSubscriptions).toHaveBeenCalledTimes(2)
  })

  it('refuses to purchase before the subscription agreement is accepted', async () => {
    const getAgreements = vi.fn(async () => [
      { agreementType: 'SUBSCRIPTION', title: 'Terms', content: '<p>terms</p>' },
    ])
    const purchasePlan = vi.fn(async () => PURCHASE)
    render(<AccountSection {...props({ view: SIGNED_IN, expired: false }, {
      getAgreements, purchasePlan,
    })} />)

    fireEvent.click(await screen.findByRole('button', { name: 'upgradePlan' }))
    expect(await screen.findByText(PLAN.planName)).toBeDefined()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'purchase' }).disabled).toBe(true)
  })

  it('keeps a failed quote read visible without clearing the subscription list', async () => {
    render(<AccountSection {...props({ view: SIGNED_IN, expired: false }, {
      getSubscriptions: vi.fn(async () => ({ items: [SUBSCRIPTION], realtime: true })),
      getQuota: vi.fn(async () => { throw new Error('quota down') }),
    })} />)

    expect((await screen.findByRole('alert')).textContent).toBe('quota down')
    expect(screen.getByText('Monthly')).toBeDefined()
  })
})
