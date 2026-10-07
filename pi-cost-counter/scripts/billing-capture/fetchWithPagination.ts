import { type ZodType } from 'zod'
import type { FetchPage, RawResponse } from './fetchInPage'

export type StopReason = 'exhausted' | 'cutoff' | 'page-cap' | 'end-of-pages'

/**
 * Method syntax keeps these signatures bivariant, so the entries of a
 * heterogeneous route table widen to a common `Route` when the table is
 * iterated.
 */
export type PaginationSpec<TPage, TItem> = {
  items(page: TPage): TItem[]
  itemDateMs(item: TItem): number
  cursor(page: TPage): string | null | undefined
  nextUrl(params: { url: string; cursor: string }): string
  /** Follow-up page statuses that mean "past the last page", in addition to
   * 200, which continues the loop. Anthropic invoices answer 422 once the page
   * number passes the total. */
  endOfPagesStatuses?: number[]
}

export type Route<TBody extends object, TItem> = {
  path: string
  file: string
  schema: ZodType<TBody>
  /** Body decoder for non-JSON routes (HTML → validated TBody). Absent
   * means the body is JSON, parsed and validated as before. The schema
   * stays on the route: loadCapture re-validates the published file. */
  parse?: (body: string) => Promise<TBody>
  paginate?: PaginationSpec<TBody, TItem>
}

/** A route that paginates: `paginate` is required, so paginated and
 * single-shot table entries can be told apart by type. */
export type PaginatedRoute<TBody extends object, TItem> = {
  path: string
  file: string
  schema: ZodType<TBody>
  parse?: (body: string) => Promise<TBody>
  paginate: PaginationSpec<TBody, TItem>
}

/** Identity factory: infers `TBody` from the schema and `TItem` from the
 * pagination spec — the overloads keep `paginate` required in the returned
 * type when a spec is given. */
export function defineRoute<TBody extends object, TItem>(
  params: PaginatedRoute<TBody, TItem>
): PaginatedRoute<TBody, TItem>
export function defineRoute<TBody extends object>(
  params: Route<TBody, unknown>
): Route<TBody, unknown>
export function defineRoute(
  params: Route<object, unknown>
): Route<object, unknown> {
  return params
}

const LOOKBACK_MS = 45 * 86_400_000
const DEFAULT_MAX_PAGES = 10

export async function fetchWithPagination<TBody extends object, TItem>(params: {
  page: FetchPage
  url: string
  headers?: Record<string, string>
  schema: ZodType<TBody>
  spec: PaginationSpec<TBody, TItem>
  cutoffMs?: number
  maxPages?: number
}): Promise<{
  pages: RawResponse[]
  stopReason: StopReason
}> {
  const cutoffMs = params.cutoffMs ?? Date.now() - LOOKBACK_MS
  const maxPages = params.maxPages ?? DEFAULT_MAX_PAGES
  const pages: RawResponse[] = []
  let url = params.url
  let first = true
  for (;;) {
    const response = await params.page.fetch({ url, headers: params.headers })
    if (response.status !== 200) {
      if (
        !first &&
        (params.spec.endOfPagesStatuses ?? []).includes(response.status)
      ) {
        return { pages, stopReason: 'end-of-pages' }
      }
      throw new Error(`route ${url} answered ${response.status}`)
    }
    const page = validatePage({
      url,
      body: response.body,
      schema: params.schema,
    })
    pages.push(response)
    if (oldestItemMs({ page, spec: params.spec }) < cutoffMs) {
      return { pages, stopReason: 'cutoff' }
    }
    const cursor = params.spec.cursor(page)
    if (!cursor) {
      return { pages, stopReason: 'exhausted' }
    }
    if (pages.length >= maxPages) {
      return { pages, stopReason: 'page-cap' }
    }
    // nextUrl implementations append, so follow-ups build from the original
    // route URL — reusing the previous page's URL would stack cursors
    url = params.spec.nextUrl({ url: params.url, cursor })
    first = false
  }
}

function validatePage<TBody extends object>(params: {
  url: string
  body: string
  schema: ZodType<TBody>
}): TBody {
  let raw: unknown
  try {
    raw = JSON.parse(params.body)
  } catch (error) {
    throw new Error(`page from ${params.url} is not JSON`, { cause: error })
  }
  const parsed = params.schema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(
      `page from ${params.url} failed schema validation: ${parsed.error.message}`
    )
  }
  return parsed.data
}

function oldestItemMs<TBody extends object, TItem>(params: {
  page: TBody
  spec: PaginationSpec<TBody, TItem>
}): number {
  let oldest = Number.POSITIVE_INFINITY
  for (const item of params.spec.items(params.page)) {
    oldest = Math.min(oldest, params.spec.itemDateMs(item))
  }
  return oldest
}
