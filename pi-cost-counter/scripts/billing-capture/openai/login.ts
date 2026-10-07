import { z } from 'zod'
import type { FetchPage, RawResponse } from '../fetchInPage'

const sessionBody = z.object({
  accessToken: z.string().optional(),
  account: z.object({ id: z.string() }).optional(),
})

/** Probes the authenticated session. The body carries the bearer token. */
export async function probeChatGptLogin(params: {
  page: FetchPage
}): Promise<{ response: RawResponse; isAuthenticated: boolean }> {
  const response = await params.page.fetch({ url: '/api/auth/session' })
  return { response, isAuthenticated: sessionAuthenticated(response) }
}

function sessionAuthenticated(response: RawResponse): boolean {
  return (
    response.status === 200 &&
    chatGptAccessToken({ body: response.body }) !== undefined &&
    chatgptAccountId({ body: response.body }) !== undefined
  )
}

export function chatGptAccessToken(params: {
  body: string
}): string | undefined {
  return parsedSession(params.body)?.accessToken
}

export function chatgptAccountId(params: { body: string }): string | undefined {
  return parsedSession(params.body)?.account?.id
}

function parsedSession(body: string) {
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    return undefined
  }
  const parsed = sessionBody.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}
