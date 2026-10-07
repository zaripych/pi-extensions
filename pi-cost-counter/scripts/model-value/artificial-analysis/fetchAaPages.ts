import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { fetchJson } from '../fetchJson'
import { aaPageSchema, type AaPage } from './aaPageSchema'

const AA_BASE = 'https://artificialanalysis.ai/api/v2'
const MAX_PAGES = 10

const apiKeyEntrySchema = z.object({
  type: z.literal('api_key'),
  key: z.string(),
})
const authFileSchema = z.record(z.string(), z.unknown())

/** The AA API key is stored manually in pi's credential file — there is no
 * registered AA provider, so ModelRuntime cannot resolve it. */
const AUTH_JSON_KEY = 'artificialanalysis.ai'

async function resolveAaApiKey(): Promise<string | undefined> {
  const env = process.env.ARTIFICIAL_ANALYSIS_API_KEY
  if (env !== undefined && env.length > 0) return env
  let raw: string
  try {
    raw = await readFile(join(homedir(), '.pi', 'agent', 'auth.json'), 'utf8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error('~/.pi/agent/auth.json is not valid JSON', { cause: error })
  }
  const file = authFileSchema.safeParse(parsed)
  if (!file.success) return undefined
  const apiKey = apiKeyEntrySchema.safeParse(file.data[AUTH_JSON_KEY])
  if (!apiKey.success || apiKey.data.key.length === 0) return undefined
  return apiKey.data.key
}

export async function fetchAaPages(): Promise<AaPage[]> {
  const key = await resolveAaApiKey()
  if (key === undefined) {
    throw new Error(
      'no Artificial Analysis API key found (ARTIFICIAL_ANALYSIS_API_KEY or an "artificialanalysis.ai" api_key entry in ~/.pi/agent/auth.json)'
    )
  }
  const pages: AaPage[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await fetchJson({
      url: `${AA_BASE}/language/models/free?page=${page}`,
      headers: { 'x-api-key': key },
    })
    const parsed = aaPageSchema.parse(body)
    pages.push(parsed)
    if (parsed.pagination?.has_more !== true) break
  }
  return pages
}
