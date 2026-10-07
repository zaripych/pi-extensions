import { z } from 'zod'
import { fetchJson } from '../fetchJson'
import { resolveBearerHeaders } from '../providerAuth'

/** `credits` is each model's share of the daily-reset allowance in
 * percentage units (a day caps at 100 and resets to zero when unused) —
 * not purchased-credit units. */
const dailyUsageBreakdownBody = z.object({
  data: z.array(
    z.object({
      date: z.string(),
      models: z
        .array(z.object({ model: z.string(), credits: z.number() }))
        .default([]),
    })
  ),
})

export async function fetchDailyUsageBreakdown(params: {
  startDate: string
  endDate: string
}) {
  const headers = await resolveBearerHeaders({ providerId: 'openai-codex' })
  const url =
    `https://chatgpt.com/backend-api/wham/usage/daily-token-usage-breakdown` +
    `?start_date=${params.startDate}&end_date=${params.endDate}&group_by=day`
  return dailyUsageBreakdownBody.parse(await fetchJson({ url, headers }))
}
