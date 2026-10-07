import type { FetchPage, RawResponse } from '../fetchInPage'

const BILLING_MARKER = 'Subscription billing history'

/** Logged out, /dashboard/billing answers 200 with a login page — no
 * tables, no marker. The marker doubles as the extractor's anchor. */
export async function probeNeuralwattLogin(params: {
  page: FetchPage
}): Promise<{ response: RawResponse; isAuthenticated: boolean }> {
  const response = await params.page.fetch({ url: '/dashboard/billing' })
  return {
    response,
    isAuthenticated:
      response.status === 200 && response.body.includes(BILLING_MARKER),
  }
}
