import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './Brand.module.css'

/**
 * Render the product mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the Mauwork product mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <FishLogo size={size} />
}

/**
 * Render the product name beside the independently slotted mark.
 * @returns the localized product wordmark.
 */
export function OfficialBrandName() {
  return <span className={css.name}>Mauwork</span>
}
