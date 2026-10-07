import { z } from 'zod'
import { fetchJson } from '../fetchJson'
import { resolveBearerHeaders } from '../providerAuth'

const creditUsageEventsBody = z.object({
  data: z.array(
    z.object({
      date: z.string(),
      credit_amount: z.number(),
    })
  ),
})

export async function fetchCreditUsageEvents() {
  const headers = await resolveBearerHeaders({ providerId: 'openai-codex' })
  return creditUsageEventsBody.parse(
    await fetchJson({
      url: 'https://chatgpt.com/backend-api/wham/usage/credit-usage-events',
      headers,
    })
  )
}
