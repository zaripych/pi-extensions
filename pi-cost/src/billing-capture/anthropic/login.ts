import type { FetchPage, RawResponse } from '../fetchInPage'

/** Probes the authenticated session. Status 200 means logged in; the body
 * lists the organizations. */
export async function probeClaudeLogin(params: {
  page: FetchPage
}): Promise<{ response: RawResponse; isAuthenticated: boolean }> {
  const response = await params.page.fetch({ url: '/api/organizations' })
  return { response, isAuthenticated: response.status === 200 }
}

export function claudeOrgId(params: {
  response: RawResponse
}): string | undefined {
  if (params.response.status !== 200) return undefined
  return UUID_PATTERN.exec(params.response.body)?.[0]
}

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
