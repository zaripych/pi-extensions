import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { hashContent } from './hashContent'
import type { SingleShotRequest } from './singleShotRequest'

const missingFileErrorSchema = z.object({ code: z.literal('ENOENT') })

function cacheKey(params: {
  prompt: string
  schema: z.ZodType
  model: string
  seed: number
}): string {
  return hashContent(
    JSON.stringify({
      input: params.prompt,
      outputSchema: z.toJSONSchema(params.schema),
      model: params.model,
      seed: params.seed,
    })
  )
}

async function readCacheEntry(entryPath: string): Promise<unknown> {
  let contents: string
  try {
    contents = await readFile(entryPath, 'utf8')
  } catch (error) {
    if (missingFileErrorSchema.safeParse(error).success) {
      return undefined
    }
    throw error
  }
  try {
    return JSON.parse(contents)
  } catch {
    return undefined
  }
}

export async function probeResultCache(params: {
  prompt: string
  schema: z.ZodType
  model: string
  seed: number
  cacheDir: string
}): Promise<boolean> {
  const key = cacheKey({
    prompt: params.prompt,
    schema: params.schema,
    model: params.model,
    seed: params.seed,
  })
  const cached = await readCacheEntry(join(params.cacheDir, key, 'result.json'))
  return cached !== undefined && params.schema.safeParse(cached).success
}

export function withResultCache(params: {
  singleShotRequest: SingleShotRequest
  cacheDir: string
  model: string
  cacheCounts: { hit: number; miss: number }
}): SingleShotRequest {
  return async ({ prompt, schema, seed, signal }) => {
    const key = cacheKey({ prompt, schema, model: params.model, seed })
    const entryPath = join(params.cacheDir, key, 'result.json')
    const cached = await readCacheEntry(entryPath)
    if (cached !== undefined) {
      const parsed = schema.safeParse(cached)
      if (parsed.success) {
        params.cacheCounts.hit += 1
        return parsed.data
      }
    }
    params.cacheCounts.miss += 1
    const result = await params.singleShotRequest({ prompt, schema, seed, signal })
    await mkdir(dirname(entryPath), { recursive: true })
    await writeFile(entryPath, `${JSON.stringify(result, null, 2)}\n`)
    return result
  }
}
