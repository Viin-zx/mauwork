/** The red dot the Plugins page draws on the market tab while a plugin has an update. */

import { useEffect } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { hasUpdates, type MioMarketFace } from './market-store.ts'
import css from './MarketUpdateDot.module.css'

/** Props assembled by the Plugins page tab-badge renderer. */
export type MarketUpdateDotProps =
  & PropsLocale<'mioPluginMarket'>
  & InjectFace<MioMarketFace>

/**
 * Mark the market tab while an installed catalog plugin has a newer version.
 * Mounting here also starts the catalog read, so the marker exists before the
 * tab itself is opened.
 * @param props - catalog state, its first read, and localized copy.
 * @returns the dot, or nothing while every installed plugin is current.
 */
export function MarketUpdateDot({ useMarket, ensure, t }: MarketUpdateDotProps) {
  const updates = useMarket(hasUpdates)
  useEffect(() => { ensure() }, [ensure])
  return updates ? <span className={css.dot} role="img" aria-label={t('updateAvailableDot')} /> : null
}
