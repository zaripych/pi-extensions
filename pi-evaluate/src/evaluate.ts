import { open, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import fastGlob from 'fast-glob'
import { createCliRequestOutput } from './createCliRequestOutput'
import type { Sample } from './evaluateSamples'
import { evaluateSamples } from './evaluateSamples'
import { findRepoRoot } from './findRepoRoot'
import { parseCriteria } from './parseCriteria'
import { readSamples } from './readSamples'
import { probeResultCache, withResultCache } from './resultCache'
import type { SingleShotRequest } from './singleShotRequest'

const defaultDeps = {
  createCliRequestOutput,
  getCacheDir: async (): Promise<string> =>
    join(await findRepoRoot(process.cwd()), '.eval-cache'),
}

export type EvaluateSummary = {
  counts: { success: number; skipped: number; error: number }
  cacheCounts: { hit: number; miss: number }
  outcome: 'completed' | 'failed' | 'aborted'
}

type GlobPatterns = string | string[]

type InputSource = {
  type: 'text' | 'jsonl' | 'text-nul'
  patterns: GlobPatterns
}

const criteriaIgnore = ['**/AGENTS.md', '**/CLAUDE.md', '**/README.md']

function hasPatterns(patterns: GlobPatterns | undefined): boolean {
  if (Array.isArray(patterns)) {
    return patterns.some((pattern) => pattern.length > 0)
  }
  return typeof patterns === 'string' && patterns.length > 0
}

async function resolvePaths(params: {
  patterns: GlobPatterns
  ignore?: string[]
}): Promise<string[]> {
  const entries = await fastGlob(params.patterns, {
    ignore: params.ignore,
    onlyFiles: false,
    objectMode: true,
  })
  return entries
    .filter((entry) => !entry.dirent.isDirectory())
    .map((entry) => entry.path)
    .sort()
}

function chooseInputSource(params: {
  inputText: GlobPatterns | undefined
  inputJsonl: GlobPatterns | undefined
  inputTextNul: GlobPatterns | undefined
}): InputSource {
  const hasInputText = hasPatterns(params.inputText)
  const hasInputJsonl = hasPatterns(params.inputJsonl)
  const hasInputTextNul = hasPatterns(params.inputTextNul)
  const providedCount = [hasInputText, hasInputJsonl, hasInputTextNul].filter(
    Boolean
  ).length
  if (providedCount > 1) {
    throw new Error(
      'Pass only one of --input-text, --input-jsonl, or --input-text-nul.'
    )
  }
  if (hasInputText && params.inputText !== undefined) {
    return { type: 'text', patterns: params.inputText }
  }
  if (hasInputJsonl && params.inputJsonl !== undefined) {
    return { type: 'jsonl', patterns: params.inputJsonl }
  }
  if (hasInputTextNul && params.inputTextNul !== undefined) {
    return { type: 'text-nul', patterns: params.inputTextNul }
  }
  throw new Error(
    '--input-text, --input-jsonl, or --input-text-nul is required: pass a sample file (use <(cat file) for process substitution).'
  )
}

const optionByInputType = {
  text: '--input-text',
  jsonl: '--input-jsonl',
  'text-nul': '--input-text-nul',
} as const

async function resolveInputSources(
  inputSource: InputSource
): Promise<{ type: 'text' | 'jsonl' | 'text-nul'; path: string }[]> {
  const inputPaths = await resolvePaths({ patterns: inputSource.patterns })
  if (inputPaths.length === 0) {
    const option = optionByInputType[inputSource.type]
    throw new Error(
      `No input ${inputSource.type} files matched ${option} "${describePatterns(inputSource.patterns)}".`
    )
  }
  return inputPaths.map((path) => ({ type: inputSource.type, path }))
}

function describePatterns(patterns: GlobPatterns): string {
  return Array.isArray(patterns) ? patterns.join(' ') : patterns
}

async function* readInputSamples(
  inputSources: { type: 'text' | 'jsonl' | 'text-nul'; path: string }[]
): AsyncGenerator<Sample> {
  const seenSampleIds = new Set<string>()
  for (const inputSource of inputSources) {
    await using inputHandle = await open(inputSource.path, 'r')
    yield* readSamples({
      type: inputSource.type,
      path: inputSource.path,
      stream: inputHandle.createReadStream(),
      seenSampleIds,
    })
  }
}

export async function evaluate(
  params: {
    model: string
    criteria: GlobPatterns
    inputText?: GlobPatterns
    inputJsonl?: GlobPatterns
    inputTextNul?: GlobPatterns
    output: string
    allowSkip?: boolean
    maxErrors?: number
    seed?: number
    dryRun?: boolean
    signal?: AbortSignal
  },
  deps = defaultDeps
): Promise<EvaluateSummary> {
  const inputSource = chooseInputSource({
    inputText: params.inputText,
    inputJsonl: params.inputJsonl,
    inputTextNul: params.inputTextNul,
  })

  const gevalPaths = await resolvePaths({
    patterns: params.criteria,
    ignore: criteriaIgnore,
  })
  if (gevalPaths.length === 0) {
    throw new Error(
      `No criteria files matched --criteria "${describePatterns(params.criteria)}".`
    )
  }
  const gevals = await Promise.all(
    gevalPaths.map(async (path) =>
      parseCriteria({
        source: await readFile(path, 'utf8'),
        fileName: basename(path),
      })
    )
  )

  const dryRun = params.dryRun ?? false
  const seed = params.seed ?? 0
  const cacheCounts = { hit: 0, miss: 0 }
  const cacheDir = await deps.getCacheDir()
  const dryRunRequest: SingleShotRequest = async ({ prompt, schema, seed }) => {
    const isHit = await probeResultCache({
      prompt,
      schema,
      model: params.model,
      seed,
      cacheDir,
    })
    cacheCounts[isHit ? 'hit' : 'miss'] += 1
    return schema.parse({ score: 0, reason: 'dry-run' })
  }
  const singleShotRequest = dryRun
    ? dryRunRequest
    : withResultCache({
        singleShotRequest: deps.createCliRequestOutput({ model: params.model })
          .singleShotRequest,
        cacheDir,
        model: params.model,
        cacheCounts,
      })

  const inputSources = await resolveInputSources(inputSource)

  const rows = evaluateSamples({
    samples: readInputSamples(inputSources),
    gevals,
    singleShotRequest,
    allowSkip: params.allowSkip ?? false,
    model: params.model,
    seed,
    signal: params.signal,
  })

  const counts = { success: 0, skipped: 0, error: 0 }

  if (dryRun) {
    for await (const row of rows) {
      counts[row.status] += 1
    }
    return {
      counts,
      cacheCounts,
      outcome: params.signal?.aborted ? 'aborted' : 'completed',
    }
  }

  const errorThreshold = Math.max(params.maxErrors ?? 0, 1)
  await using outputHandle = await open(params.output, 'w')
  let stoppedForErrors = false
  await pipeline(async function* () {
    for await (const row of rows) {
      counts[row.status] += 1
      yield `${JSON.stringify(row)}\n`
      if (row.status === 'error' && counts.error >= errorThreshold) {
        stoppedForErrors = true
        return
      }
    }
  }, outputHandle.createWriteStream())

  const outcome = params.signal?.aborted
    ? 'aborted'
    : stoppedForErrors
      ? 'failed'
      : 'completed'
  return { counts, cacheCounts, outcome }
}

evaluate.defaultDeps = defaultDeps
