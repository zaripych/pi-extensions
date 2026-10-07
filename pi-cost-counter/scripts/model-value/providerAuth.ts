import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

const apiKeyEntrySchema = z.object({
  type: z.literal('api_key'),
  key: z.string(),
})
const authFileSchema = z.record(z.string(), z.unknown())

async function readAuthFile(): Promise<Record<string, unknown> | undefined> {
  let raw: string | undefined
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
  return file.data
}

async function resolveStaticKey(params: {
  envVar: string
  authJsonKey: string
}): Promise<string | undefined> {
  const env = process.env[params.envVar]
  if (env !== undefined && env.length > 0) return env
  const auth = await readAuthFile()
  if (auth === undefined) return undefined
  const entry = apiKeyEntrySchema.safeParse(auth[params.authJsonKey])
  if (!entry.success || entry.data.key.length === 0) return undefined
  return entry.data.key
}

export async function resolveBearerHeaders(params: {
  providerId: string
  envVar?: string
}): Promise<Record<string, string>> {
  const runtime = await ModelRuntime.create()
  const resolution = await runtime
    .getAuth(params.providerId)
    .catch(() => undefined)
  let apiKey = resolution?.auth.apiKey
  if (apiKey === undefined && params.envVar !== undefined) {
    apiKey = await resolveStaticKey({
      envVar: params.envVar,
      authJsonKey: params.providerId,
    })
  }
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error(`no credential for "${params.providerId}"`)
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` }
  for (const [key, value] of Object.entries(resolution?.auth.headers ?? {})) {
    if (value !== null) headers[key] = value
  }
  return headers
}
