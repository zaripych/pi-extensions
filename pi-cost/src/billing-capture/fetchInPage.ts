import { z } from 'zod'
import { type CdpProtocol, type EvaluateResponse } from './cdpProtocol'
import { sleep } from './sleep'

export type RawResponse = { status: number; body: string }

/** A browser page reduced to what billing capture needs: in-page fetching.
 * Relative URLs resolve against the page origin, cookies ride along. */
export type FetchPage = {
  fetch: (params: {
    url: string
    headers?: Record<string, string>
  }) => Promise<RawResponse>
}

const defaultDeps = {
  sleep,
}

// an aborted signal errors the body stream too, so a stalling provider
// fails the route instead of hanging the capture
const FETCH_TIMEOUT_MS = 30_000

const fetchResult = z.object({ status: z.number(), body: z.string() })

export async function fetchInPage(
  params: {
    cdp: Pick<CdpProtocol, 'evaluate'>
    url: string
    headers?: Record<string, string>
  },
  deps = defaultDeps
): Promise<RawResponse> {
  const expression = `fetch(${JSON.stringify(params.url)}, { credentials: 'include', headers: ${JSON.stringify(params.headers ?? {})}, signal: AbortSignal.timeout(${FETCH_TIMEOUT_MS}) }).then(async (r) => ({ status: r.status, body: await r.text() }))`
  const response = await evaluateWithRetry(
    { cdp: params.cdp, expression },
    deps
  )
  if (response.exceptionDetails !== undefined) {
    throw new Error(`in-page fetch failed: ${params.url}`)
  }
  return fetchResult.parse(response.result?.value)
}

fetchInPage.defaultDeps = defaultDeps

async function evaluateWithRetry(
  params: {
    cdp: Pick<CdpProtocol, 'evaluate'>
    expression: string
  },
  deps = defaultDeps
): Promise<EvaluateResponse> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await params.cdp.evaluate({
        expression: params.expression,
        awaitPromise: true,
      })
    } catch (error) {
      if (attempt >= 3) throw error
      await deps.sleep(500)
    }
  }
}
