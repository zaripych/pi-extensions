import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { fetchWithPagination } from './fetchWithPagination'
import type { PaginationSpec } from './fetchWithPagination'
import { setupBrowserSession } from './browser.harness'
import type { ZodType } from 'zod'

export const setupFetchWithPagination = configureHarnesses(
  setupBrowserSession,
  async (deps) => {
    const session = await deps.openBrowserSession({ port: deps.port })
    return {
      ...deps,
      fetchWithPagination: <TBody extends object, TItem>(params: {
        url: string
        headers?: Record<string, string>
        schema: ZodType<TBody>
        spec: PaginationSpec<TBody, TItem>
        cutoffMs?: number
        maxPages?: number
      }) =>
        fetchWithPagination<TBody, TItem>({ ...params, page: session.chatgpt }),
      async [Symbol.asyncDispose]() {
        await session.close()
      },
    }
  }
)
