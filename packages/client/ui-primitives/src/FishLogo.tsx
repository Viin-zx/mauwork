import type { IconProps } from './icons/props.ts'

/**
 * Render the product mark.
 * @param props.size - edge length in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns the mark image (aria-hidden; pair with a wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <img
      src="/favicon.png"
      width={size}
      height={size}
      className={className}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}
