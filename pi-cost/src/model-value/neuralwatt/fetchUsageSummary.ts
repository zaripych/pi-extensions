import { z } from 'zod'
import { fetchJson } from '../fetchJson'
import { resolveBearerHeaders } from '../providerAuth'

const usageSummaryBody = z.object({
  // echo of the window actually used — malformed date filters silently
  // fall back to a default window
  period: z.object({ start: z.string(), end: z.string() }),
  totals: z.object({
    total_cost_usd: z.number(),
    energy_kwh_charged: z.number(),
  }),
})

export async function fetchUsageSummary(params: {
  startDate: string
  endDate: string
}) {
  const headers = await resolveBearerHeaders({
    providerId: 'neuralwatt',
    envVar: 'NEURALWATT_API_KEY',
  })
  const url =
    `https://api.neuralwatt.com/v1/usage/summary` +
    `?start_date=${params.startDate}&end_date=${params.endDate}`
  return usageSummaryBody.parse(await fetchJson({ url, headers }))
}
