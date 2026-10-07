import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ANTHROPIC_ROUTES } from './anthropic/routes'
import { statIfPresent } from './fsIfPresent'
import type {
  PaginatedRoute,
  PaginationSpec,
  Route,
} from './fetchWithPagination'
import type { ZodType } from 'zod'
import { NEURALWATT_ROUTES } from './neuralwatt/routes'
import { CHATGPT_ROUTES } from './openai/routes'

export const DEFAULT_CAPTURE_DIR = join(
  homedir(),
  '.cache',
  'pi-billing',
  'capture'
)

/** The items field of a paginated body: the one field whose value is the
 * spec's items array. */
type ItemsKey<TBody, TItem> = {
  [K in keyof TBody]-?: TBody[K] extends TItem[] ? K : never
}[keyof TBody]

/** Merged view of a paginated route: only the items field, no cursors. */
export type PaginatedView<TBody, TItem> = Pick<TBody, ItemsKey<TBody, TItem>>

export async function loadCapture(params: { dir?: string } = {}) {
  const dir = params.dir ?? DEFAULT_CAPTURE_DIR
  const openai = await loadRoutes({ dir, routes: CHATGPT_ROUTES })
  const anthropic = await loadRoutes({ dir, routes: ANTHROPIC_ROUTES })
  const neuralwatt = await loadRoutes({ dir, routes: NEURALWATT_ROUTES })
  const capturedAt = await newestMtime({ dir })
  return { openai, anthropic, neuralwatt, capturedAt }
}

type LoadedRoute<TRoute> =
  TRoute extends PaginatedRoute<infer TBody, infer TItem>
    ? PaginatedView<TBody, TItem>
    : TRoute extends Route<infer TBody, unknown>
      ? TBody
      : never

export async function loadRoutes<
  TRoutes extends Record<string, Route<object, unknown>>,
>(params: {
  dir: string
  routes: TRoutes
}): Promise<{ [K in keyof TRoutes]: LoadedRoute<TRoutes[K]> }> {
  const entries = await Promise.all(
    Object.entries(params.routes).map(
      async ([key, route]): Promise<[string, unknown]> => [
        key,
        route.paginate
          ? await loadPaginatedFile({ route, dir: params.dir })
          : await loadSingleShotFile({ route, dir: params.dir }),
      ]
    )
  )
  // oxlint-disable typescript/consistent-type-assertions -- Object.fromEntries cannot express the mapped per-key result type (typing-issues.md §6)
  return Object.fromEntries(entries) as {
    [K in keyof TRoutes]: LoadedRoute<TRoutes[K]>
  }
  // oxlint-enable typescript/consistent-type-assertions
}

async function loadSingleShotFile<TBody extends object>(params: {
  route: Route<TBody, unknown>
  dir: string
}): Promise<TBody> {
  const raw = await readFile(
    join(params.dir, `${params.route.file}.json`),
    'utf8'
  )
  return parseBody({ body: raw, schema: params.route.schema })
}

async function loadPaginatedFile<TBody extends object, TItem>(params: {
  route: Route<TBody, TItem>
  dir: string
}): Promise<PaginatedView<TBody, TItem>> {
  const spec = params.route.paginate
  if (spec === undefined)
    throw new Error(`route ${params.route.file} is not paginated`)
  const pageFiles = (await readdir(params.dir))
    .filter(
      (file) =>
        file.startsWith(`${params.route.file}.page-`) && file.endsWith('.json')
    )
    .toSorted()
  const pages: TBody[] = []
  for (const file of pageFiles) {
    const raw = await readFile(join(params.dir, file), 'utf8')
    pages.push(parseBody({ body: raw, schema: params.route.schema }))
  }
  const firstPage = pages[0]
  if (!firstPage) {
    throw new Error(`no page files for ${params.route.file} in ${params.dir}`)
  }
  return mergedView({
    page: firstPage,
    items: pages.flatMap((page) => spec.items(page)),
    spec,
  })
}

function mergedView<TBody extends object, TItem>(params: {
  page: TBody
  items: TItem[]
  spec: PaginationSpec<TBody, TItem>
}): PaginatedView<TBody, TItem> {
  const pageItems = params.spec.items(params.page)
  const itemsKey = Object.entries(params.page).find(
    ([, value]) => value === pageItems
  )?.[0]
  if (!itemsKey) {
    throw new Error('pagination items field not found on page body')
  }
  // oxlint-disable typescript/consistent-type-assertions -- dynamically constructed return cannot be proven to match PaginatedView (typing-issues.md §6)
  return { [itemsKey]: params.items } as PaginatedView<TBody, TItem>
  // oxlint-enable typescript/consistent-type-assertions
}

function parseBody<TBody extends object>(params: {
  body: string
  schema: ZodType<TBody>
}): TBody {
  let raw: unknown
  try {
    raw = JSON.parse(params.body)
  } catch (error) {
    throw new Error(`capture file is not JSON: ${params.body.slice(0, 60)}`, {
      cause: error,
    })
  }
  const parsed = params.schema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(
      `capture file failed schema validation: ${parsed.error.message}`
    )
  }
  return parsed.data
}

async function newestMtime(params: { dir: string }): Promise<Date> {
  let newest = 0
  for (const file of await readdir(params.dir)) {
    const fileStat = await statIfPresent(join(params.dir, file))
    if (fileStat) newest = Math.max(newest, fileStat.mtimeMs)
  }
  if (newest === 0) throw new Error(`no capture files in ${params.dir}`)
  return new Date(newest)
}
