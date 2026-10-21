/** Full-screen login gate shown until a mioagent session exists. */
import { useEffect, useRef } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { FishLogo, IconLoadingOutlineRegular, useModalLayer } from '@deepseek-ai/dsh-client-ui-primitives'
import { LoginForm } from './LoginForm.tsx'
import type { MioAccountInjected } from './operations.ts'
import css from './LoginGate.module.css'

/** Gate props: the account business face plus localized copy. */
export type LoginGateProps = PropsRuntime<'shell.overlay'> & PropsLocale<'mioAccount'> & InjectFace<MioAccountInjected>

/**
 * Render the login surface above the whole client until the account signs in.
 * @param props - account state, operations, and localized copy.
 * @returns the full-screen gate, or null while signed in.
 */
export function LoginGate({
  useAccount, sendSmsCode, loginWithSms, loginWithPassword, resetPassword, getAgreements, t,
}: LoginGateProps) {
  const state = useAccount(value => value)
  const open = state.view?.status !== 'signed-in'
  const layer = useRef<HTMLDivElement>(null)
  // The gate owns Escape and Tab while visible; there is nothing to dismiss.
  useModalLayer(layer, open, () => {})
  useEffect(() => {
    if (!open) return
    // The overlay is a child of the frame; make every sibling column inert so
    // the application behind the gate cannot take focus or pointer input.
    const seat = layer.current?.closest('[data-shell-overlay]')
    const frame = seat?.parentElement
    if (seat === null || seat === undefined || frame === null || frame === undefined) return
    const owned = [...frame.children].filter((child): child is HTMLElement =>
      child !== seat && child instanceof HTMLElement)
    const previous = owned.map(child => child.inert)
    for (const child of owned) child.inert = true
    return () => {
      owned.forEach((child, index) => { child.inert = previous[index] ?? false })
    }
  }, [open])
  if (!open) return null
  return <div ref={layer} className={css.root} role="dialog" aria-modal="true" aria-label={t('title')}
    data-testid="mio-login-gate">
    <div className={css.drag} aria-hidden="true" />
    <main className={css.page}>
      <FishLogo size={64} className={css.logo} />
      <h1 className={css.title}>{t('title')}</h1>
      {state.view === undefined
        ? <div className={css.loading} role="status">
          <IconLoadingOutlineRegular size={20} className={css.spinner} />
          <span>{t('loading')}</span>
        </div>
        : <LoginForm expired={state.expired} sendSmsCode={sendSmsCode} loginWithSms={loginWithSms}
          loginWithPassword={loginWithPassword} resetPassword={resetPassword}
          getAgreements={getAgreements} t={t} />}
    </main>
  </div>
}
