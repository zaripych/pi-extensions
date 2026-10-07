import { z } from 'zod'
import { fetchJson } from '../fetchJson'
import { resolveBearerHeaders } from '../providerAuth'

const usageByModelBody = z.object({
  // echo of the window actually used — malformed date filters silently
  // fall back to a default window
  period: z.object({ start: z.string(), end: z.string() }),
  // grouped by (requested model, served model) pair
  products: z.array(
    z.object({
      requested_model: z.string(),
      total_tokens: z.number(),
      total_cost_usd: z.number(),
    })
  ),
})

export async function fetchUsageByModel(params: {
  startDate: string
  endDate: string
}) {
  const headers = await resolveBearerHeaders({
    providerId: 'neuralwatt',
    envVar: 'NEURALWATT_API_KEY',
  })
  const url =
    `https://api.neuralwatt.com/v1/usage/by-model` +
    `?start_date=${params.startDate}&end_date=${params.endDate}`
  return usageByModelBody.parse(await fetchJson({ url, headers }))
}
