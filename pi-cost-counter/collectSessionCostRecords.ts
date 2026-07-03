import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

const assistantCostLineSchema = z.object({
  type: z.literal('message'),
  message: z.object({
    role: z.literal('assistant'),
    provider: z.string().default('unknown'),
    model: z.string().default('unknown'),
    timestamp: z.number(),
    usage: z.object({
      input: z.number().default(0),
      output: z.number().default(0),
      cacheRead: z.number().default(0),
      cacheWrite: z.number().default(0),
      cost: z.object({
        input: z.number(),
        output: z.number(),
        cacheRead: z.number(),
        cacheWrite: z.number(),
        total: z.number(),
      }),
    }),
  }),
})

const sessionHeaderSchema = z.object({
  type: z.literal('session'),
  id: z.string(),
  cwd: z.string(),
})

function isAssistantMessageLine(parsed: unknown) {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    'type' in parsed &&
    parsed.type === 'message' &&
    'message' in parsed &&
    typeof parsed.message === 'object' &&
    parsed.message !== null &&
    'role' in parsed.message &&
    parsed.message.role === 'assistant'
  )
}

const defaultDeps = {
  getSessionsDir: () => join(homedir(), '.pi', 'agent', 'sessions'),
}

export async function collectSessionCostRecords(
  params: { start: Date; end: Date },
  deps = defaultDeps
) {
  const startMs = params.start.getTime()
  const endMs = params.end.getTime()
  const sessionsDir = deps.getSessionsDir()
  const entries = await readdir(sessionsDir, {
    recursive: true,
    withFileTypes: true,
  }).catch(() => [])

  const records = []
  const stats = { invalidJsonLines: 0, schemaMismatchLines: 0 }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
    const raw = await readFile(join(entry.parentPath, entry.name), 'utf8')
    let sessionId = 'unknown'
    let cwd = 'unknown'
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        stats.invalidJsonLines += 1
        continue
      }
      if (!isAssistantMessageLine(parsed)) {
        const header = sessionHeaderSchema.safeParse(parsed)
        if (header.success) {
          sessionId = header.data.id
          cwd = header.data.cwd
        }
        continue
      }
      const result = assistantCostLineSchema.safeParse(parsed)
      if (!result.success) {
        stats.schemaMismatchLines += 1
        continue
      }
      const { timestamp, provider, model, usage } = result.data.message
      if (timestamp < startMs || timestamp > endMs) continue
      const { cost, ...tokens } = usage
      records.push({ ts: timestamp, sessionId, cwd, provider, model, tokens, cost })
    }
  }
  return { records: records.sort((a, b) => a.ts - b.ts), stats }
}

collectSessionCostRecords.defaultDeps = defaultDeps
