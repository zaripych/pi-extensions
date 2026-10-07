import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { setupFetchWithPagination } from './fetchWithPagination.harness'
import type { RawResponse } from './fetchInPage'
import type { PaginationSpec } from './fetchWithPagination'

const setup = combineHarnesses(setupFetchWithPagination)

const pageSchema = z.object({
  items: z.array(z.object({ at: z.string() })),
  next: z.string().optional(),
})

type PageBody = z.output<typeof pageSchema>
type Item = { at: string }

const pagination: PaginationSpec<PageBody, Item> = {
  items: (page) => page.items,
  itemDateMs: (item) => Date.parse(item.at),
  cursor: (page) => page.next,
  nextUrl: ({ url, cursor }) => `${url}&after=${cursor}`,
}

const recentIso = new Date(Date.now() - 3_600_000).toISOString()
const oldIso = new Date(Date.now() - 90 * 86_400_000).toISOString()

function ok(body: PageBody): RawResponse {
  return { status: 200, body: JSON.stringify(body) }
}

describe('fetchWithPagination', () => {
  it('follows the cursor until it is absent', async () => {
    const routes: Record<string, RawResponse> = {
      'https://example.test/items': ok({
        items: [{ at: recentIso }],
        next: 'cursor-2',
      }),
      'https://example.test/items&after=cursor-2': ok({
        items: [{ at: recentIso }],
      }),
    }
    await using harness = await setup({ fakeFetchWorld: () => ({ routes }) })

    const result = await harness.fetchWithPagination({
      url: 'https://example.test/items',
      schema: pageSchema,
      spec: pagination,
      cutoffMs: 0,
    })

    expect(result.stopReason).toBe('exhausted')
    expect(result.pages).toEqual([
      routes['https://example.test/items'],
      routes['https://example.test/items&after=cursor-2'],
    ])
  })

  it('builds each follow-up URL from the original route URL', async () => {
    const routes: Record<string, RawResponse> = {
      'https://example.test/items': ok({
        items: [{ at: recentIso }],
        next: 'cursor-2',
      }),
      'https://example.test/items&after=cursor-2': ok({
        items: [{ at: recentIso }],
        next: 'cursor-3',
      }),
      'https://example.test/items&after=cursor-3': ok({
        items: [{ at: recentIso }],
      }),
    }
    await using harness = await setup({ fakeFetchWorld: () => ({ routes }) })

    const result = await harness.fetchWithPagination({
      url: 'https://example.test/items',
      schema: pageSchema,
      spec: pagination,
      cutoffMs: 0,
    })

    expect(result.stopReason).toBe('exhausted')
    expect(result.pages).toEqual([
      routes['https://example.test/items'],
      routes['https://example.test/items&after=cursor-2'],
      routes['https://example.test/items&after=cursor-3'],
    ])
  })

  it('stops with cutoff when the oldest item predates the cutoff', async () => {
    const routes: Record<string, RawResponse> = {
      'https://example.test/items': ok({
        items: [{ at: recentIso }, { at: oldIso }],
        next: 'cursor-2',
      }),
    }
    await using harness = await setup({ fakeFetchWorld: () => ({ routes }) })

    const result = await harness.fetchWithPagination({
      url: 'https://example.test/items',
      schema: pageSchema,
      spec: pagination,
      cutoffMs: Date.now() - 86_400_000,
    })

    expect(result.stopReason).toBe('cutoff')
    expect(result.pages).toEqual([routes['https://example.test/items']])
  })

  it('stops with page-cap at maxPages', async () => {
    const routes: Record<string, RawResponse> = {
      'https://example.test/items': ok({
        items: [{ at: recentIso }],
        next: 'more',
      }),
      'https://example.test/items&after=more': ok({
        items: [{ at: recentIso }],
        next: 'more',
      }),
    }
    await using harness = await setup({ fakeFetchWorld: () => ({ routes }) })

    const result = await harness.fetchWithPagination({
      url: 'https://example.test/items',
      schema: pageSchema,
      spec: pagination,
      cutoffMs: 0,
      maxPages: 2,
    })

    expect(result.stopReason).toBe('page-cap')
    expect(result.pages).toHaveLength(2)
  })

  it('stops with end-of-pages on a declared follow-up status', async () => {
    const routes: Record<string, RawResponse> = {
      'https://example.test/items': ok({
        items: [{ at: recentIso }],
        next: '2',
      }),
      'https://example.test/items&after=2': {
        status: 422,
        body: 'past the last page',
      },
    }
    await using harness = await setup({ fakeFetchWorld: () => ({ routes }) })

    const result = await harness.fetchWithPagination({
      url: 'https://example.test/items',
      schema: pageSchema,
      spec: { ...pagination, endOfPagesStatuses: [422] },
      cutoffMs: 0,
    })

    expect(result.stopReason).toBe('end-of-pages')
    expect(result.pages).toEqual([routes['https://example.test/items']])
  })

  it('throws when the first page fails the schema', async () => {
    const routes: Record<string, RawResponse> = {
      'https://example.test/items': {
        status: 200,
        body: JSON.stringify({ wrong: true }),
      },
    }
    await using harness = await setup({ fakeFetchWorld: () => ({ routes }) })

    await expect(
      harness.fetchWithPagination({
        url: 'https://example.test/items',
        schema: pageSchema,
        spec: pagination,
        cutoffMs: 0,
      })
    ).rejects.toThrow('failed schema validation')
  })

  it('throws on a non-200 first page', async () => {
    const routes: Record<string, RawResponse> = {
      'https://example.test/items': { status: 500, body: 'boom' },
    }
    await using harness = await setup({ fakeFetchWorld: () => ({ routes }) })

    await expect(
      harness.fetchWithPagination({
        url: 'https://example.test/items',
        schema: pageSchema,
        spec: pagination,
        cutoffMs: 0,
      })
    ).rejects.toThrow('answered 500')
  })

  it('throws on an undeclared non-200 follow-up page', async () => {
    const routes: Record<string, RawResponse> = {
      'https://example.test/items': ok({
        items: [{ at: recentIso }],
        next: '2',
      }),
      'https://example.test/items&after=2': { status: 500, body: 'boom' },
    }
    await using harness = await setup({ fakeFetchWorld: () => ({ routes }) })

    await expect(
      harness.fetchWithPagination({
        url: 'https://example.test/items',
        schema: pageSchema,
        spec: pagination,
        cutoffMs: 0,
      })
    ).rejects.toThrow('answered 500')
  })
})
