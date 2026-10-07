import { z } from 'zod'
import { fetchJson } from '../fetchJson'
import { resolveBearerHeaders } from '../providerAuth'

const quotaTimestamp = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: 'quota period does not parse to a date',
  })

export const quotaBody = z.object({
  subscription: z
    .object({
      current_period_start: quotaTimestamp,
      current_period_end: quotaTimestamp,
      kwh_included: z.number(),
      // charged energy — what draws down the allowance, not physical consumption
      kwh_used: z.number(),
      in_overage: z.boolean(),
    })
    .nullable(),
})

export async function fetchQuota() {
  const headers = await resolveBearerHeaders({
    providerId: 'neuralwatt',
    envVar: 'NEURALWATT_API_KEY',
  })
  return quotaBody.parse(
    await fetchJson({ url: 'https://api.neuralwatt.com/v1/quota', headers })
  )
}
