/** Sidebar account launcher with settings and the local sign-out action. */
import { useState } from 'react'
import {
  IconSettingsOutlineMedium, IconUserOutlineMedium, Menu, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MioAccountInjected } from './operations.ts'
import css from './AccountMenu.module.css'

/** Launcher props: sidebar geometry, account operations, and localized copy. */
export type AccountMenuProps = PropsRuntime<'settings.launcher'> & PropsLocale<'mioAccount'> & InjectFace<MioAccountInjected>

/**
 * Render the signed-in account row.
 * @param props - sidebar width state, settings navigation, sign-out, and localized copy.
 * @returns the launcher, or null while signed out or unresolved.
 */
export function AccountMenu({
  wide, settingsShortcut, openSettings, useAccount, logout, t,
}: AccountMenuProps) {
  const state = useAccount(value => value)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failures, setFailures] = useState(0)
  const user = state.view?.status === 'signed-in' ? state.view.user : null
  if (user === null) return null
  const label = user.nickname === '' ? user.maskedPhone : user.nickname
  const signOut = async (): Promise<void> => {
    setBusy(true)
    try {
      await logout()
    } catch (_failure) {
      setFailures(value => value + 1)
    } finally {
      setBusy(false)
    }
  }
  return <div className={css.root}>
    {failures > 0 && <Toast key={failures} text={t('signOutFailed')}
      onDone={() => { setFailures(0) }} />}
    <Menu open={open} side="top" portal autoFocus
      anchor={<button type="button" className={css.trigger} data-collapsed={!wide}
        aria-label={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}>
        <span className={css.avatar}><IconUserOutlineMedium size={14} /></span>
        {wide && <span className={css.label}>{label}</span>}
      </button>}
      items={[
        { id: 'settings', label: t('settings'), icon: <IconSettingsOutlineMedium size={16} />,
          ...(settingsShortcut === undefined ? {} : { shortcut: settingsShortcut }) },
        { id: 'signout', label: t('signOut'), icon: <IconUserOutlineMedium size={16} />, disabled: busy },
      ]}
      onClose={() => { setOpen(false) }}
      onSelect={(id) => {
        setOpen(false)
        if (id === 'settings') { openSettings(); return }
        void signOut()
      }} />
  </div>
}
