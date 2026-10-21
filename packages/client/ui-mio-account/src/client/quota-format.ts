/** Display conversion for backend quota units. */

/** Raw backend quota units that make one displayed yuan. */
const QUOTA_PER_YUAN = 500_000

/**
 * Format a raw backend quota as yuan with two decimals.
 * @param value - quota amount reported by the business backend.
 * @returns display text such as `¥88.00`.
 */
export function formatQuota(value: number): string {
  return `¥${(value / QUOTA_PER_YUAN).toFixed(2)}`
}
