/** Shared USD-to-AUD conversion constant. */
export const USD_TO_AUD = 1.5

export function usdToAud(usd: number): number {
  return usd * USD_TO_AUD
}
