import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  readdirIfPresent,
  statIfPresent,
} from '../../billing-capture/fsIfPresent'
import { aaPageSchema, type AaModel, type AaPage } from './aaPageSchema'
import { fetchAaPages } from './fetchAaPages'

const FRESHNESS_MS = 24 * 3_600_000

const defaultDeps = {
  fetchAaPages,
  getCacheDir: () => join(homedir(), '.cache', 'pi-billing'),
}

function pageFiles(files: string[]): string[] {
  return files
    .filter(
      (file) => file.startsWith('aa-models-page-') && file.endsWith('.json')
    )
    .toSorted()
}

async function readCachedPages(params: {
  cacheDir: string
}): Promise<{ pages: AaPage[]; newestMtimeMs: number } | undefined> {
  const files = await readdirIfPresent(params.cacheDir)
  if (files === undefined) return undefined
  const pages: AaPage[] = []
  let newestMtimeMs = 0
  for (const file of pageFiles(files)) {
    const fileStat = await statIfPresent(join(params.cacheDir, file))
    if (fileStat) newestMtimeMs = Math.max(newestMtimeMs, fileStat.mtimeMs)
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(join(params.cacheDir, file), 'utf8'))
    } catch (error) {
      throw new Error(`AA cache page ${file} is not valid JSON`, {
        cause: error,
      })
    }
    pages.push(aaPageSchema.parse(parsed))
  }
  if (pages.length === 0) return undefined
  return { pages, newestMtimeMs }
}

/** A failed refresh never replaces the existing cache. */
async function writePagesAtomically(params: {
  cacheDir: string
  pages: AaPage[]
}) {
  await mkdir(params.cacheDir, { recursive: true })
  for (const [index, page] of params.pages.entries()) {
    await writeFile(
      join(params.cacheDir, `aa-models-page-${index + 1}.json.tmp`),
      JSON.stringify(page)
    )
  }
  const files = await readdir(params.cacheDir)
  for (const file of pageFiles(files)) {
    await rm(join(params.cacheDir, file), { force: true })
  }
  for (const index of params.pages.keys()) {
    await rename(
      join(params.cacheDir, `aa-models-page-${index + 1}.json.tmp`),
      join(params.cacheDir, `aa-models-page-${index + 1}.json`)
    )
  }
}

/** Cached AA models, fresh for 24 hours; refresh failures propagate. */
export async function loadAaModels(
  params: { now: Date },
  deps = defaultDeps
): Promise<AaModel[]> {
  const cacheDir = deps.getCacheDir()
  const cached = await readCachedPages({ cacheDir })
  if (cached && params.now.getTime() - cached.newestMtimeMs <= FRESHNESS_MS) {
    return cached.pages.flatMap((page) => page.data)
  }
  const pages = await deps.fetchAaPages()
  await writePagesAtomically({ cacheDir, pages })
  return pages.flatMap((page) => page.data)
}

loadAaModels.defaultDeps = defaultDeps
