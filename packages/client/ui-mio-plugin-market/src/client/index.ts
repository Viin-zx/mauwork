/**
 * Mioagent plugin market, browser half: a Plugins page tab over the account's
 * plugin catalog. Installation reuses the page's install dialog; default
 * configuration is applied by the Host after the bundle is installed.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-plugin-manager/types'
import { MioMarketTab } from './MioMarketTab.tsx'
import { MarketUpdateDot } from './MarketUpdateDot.tsx'
import { MioMarketController } from './market-store.ts'
import { en, zh, type MioPluginMarketKey } from './locales.ts'

export type { MioMarketFace, MioMarketState } from './market-store.ts'
export type { MioPluginMarketKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugin market tab copy. */
    mioPluginMarket: MioPluginMarketKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'mioPluginMarket'

/** Services required by the tab and its catalog reads. */
export const inject = ['slots', 'locale', 'remote', 'remote.mioAccount', 'remote.pluginManager']

/**
 * Contribute the account's plugin market to the Plugins page.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-mio-plugin-market: dictionaries')
  const controller = new MioMarketController(ctx)
  ctx.effect(() => () => { controller.dispose() }, 'ui-mio-plugin-market: controller')
  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('plugin-manager/changed', () => { controller.refreshInstalled() }),
      ctx.remote.$on('mio-plugin-preset/applied', (change) => {
        // The plugin's settings page reads once on mount; reload after a forced
        // install so it opens against the newly written catalog preset.
        if (change.reload) globalThis.location.reload()
      }),
      ctx.remote.$on('mio-plugin-preset/defaults-installed', (change) => {
        // Default packages install after the first sign-in; the running page
        // never loaded their client bundles.
        if (change.reload) globalThis.location.reload()
      }),
      ctx.on('connection/reset', () => { controller.reset() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-mio-plugin-market: host invalidations')
  const face = controller.face()
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('plugins.tab', () => ctx.slots.register({
    name: 'plugins.tab', id: 'mio-market', label: () => t('title'), locale: NS, inject: () => face,
  }, MioMarketTab))
  // The dot mounts with the page's tab bar, so it can start the catalog read
  // and mark the tab before the market tab itself has ever been opened.
  ctx.slots.inject('plugins.tab.badge', () => ctx.slots.register({
    name: 'plugins.tab.badge', id: 'mio-market', locale: NS, inject: () => face,
  }, MarketUpdateDot))
}
