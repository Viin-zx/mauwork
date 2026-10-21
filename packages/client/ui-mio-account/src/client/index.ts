/** Login gate and sidebar account launcher for the mioagent backend. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { createMioAccountState } from './account-state.ts'
import { AccountMenu } from './AccountMenu.tsx'
import { AccountSection } from './AccountSection.tsx'
import { LoginGate } from './LoginGate.tsx'
import { createMioAccountOperations, type MioAccountInjected } from './operations.ts'
import { en, zh } from './locales.ts'

/** Services required by the login surface. */
export const inject = ['slots', 'locale', 'remote', 'remote.mioAccount']

/**
 * Register the full-screen login gate, the signed-in account launcher, and
 * the Account & balance settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('mioAccount', { en, zh }), 'mio-account: dictionaries')
  const state = createMioAccountState(ctx)
  ctx.effect(() => () => { state.dispose() }, 'mio-account: state streams')
  const operations = createMioAccountOperations(ctx)
  const face = (): MioAccountInjected => ({ hooks: { account: state.state }, ...operations })
  const t = ctx.locale.bind('mioAccount')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'mio-account.login', locale: 'mioAccount', inject: face,
  }, LoginGate))
  ctx.slots.inject('settings.launcher', () => ctx.slots.register({
    name: 'settings.launcher', locale: 'mioAccount', inject: face,
  }, AccountMenu))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'account', order: -10, label: () => t('accountNav'),
    locale: 'mioAccount', inject: face,
  }, AccountSection))
}
