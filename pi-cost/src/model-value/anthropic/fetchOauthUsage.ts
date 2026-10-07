import { z } from 'zod'
import { fetchJson } from '../fetchJson'
import { resolveBearerHeaders } from '../providerAuth'

const oauthUsageBody = z.object({
  // percentages of plan limits used
  seven_day: z.object({ utilization: z.number() }),
})

export async function fetchOauthUsage() {
  const headers = await resolveBearerHeaders({ providerId: 'anthropic' })
  headers['anthropic-beta'] = 'oauth-2025-04-20'
  return oauthUsageBody.parse(
    await fetchJson({
      url: 'https://api.anthropic.com/api/oauth/usage',
      headers,
    })
  )
}
