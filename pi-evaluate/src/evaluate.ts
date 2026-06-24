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
import { withResultCache } from './resultCache'
import type { SingleShotRequest } from './singleShotRequest'

const defaultDeps = {
  createCliRequestOutput,
  getCacheDir: async (): Promise<string> =>
    join(await findRepoRoot(process.cwd()), '.eval-cache'),
}

export type EvaluateSummary = {
  counts: { success: number; skipped: number; error: number }
  outcome: 'completed' | 'failed' | 'aborted'
}

type GlobPatterns = string | string[]

type InputSource = { type: 'text' | 'jsonl'; patterns: GlobPatterns }

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
}): InputSource {
  const hasInputText = hasPatterns(params.inputText)
  const hasInputJsonl = hasPatterns(params.inputJsonl)
  if (hasInputText && hasInputJsonl) {
    throw new Error('Pass only one of --input-text or --input-jsonl, not both.')
  }
  if (hasInputText && params.inputText !== undefined) {
    return { type: 'text', patterns: params.inputText }
  }
  if (hasInputJsonl && params.inputJsonl !== undefined) {
    return { type: 'jsonl', patterns: params.inputJsonl }
  }
  throw new Error(
    '--input-text or --input-jsonl is required: pass a sample file (use <(cat file) for process substitution).'
  )
}

const dryRunRequest: SingleShotRequest = async ({ schema }) =>
  schema.parse({ score: 0, reason: 'dry-run' })

async function resolveInputSources(
  inputSource: InputSource
): Promise<{ type: 'text' | 'jsonl'; path: string }[]> {
  const inputPaths = await resolvePaths({ patterns: inputSource.patterns })
  if (inputPaths.length === 0) {
    const option = inputSource.type === 'text' ? '--input-text' : '--input-jsonl'
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
  inputSources: { type: 'text' | 'jsonl'; path: string }[]
): AsyncGenerator<Sample> {
  for (const inputSource of inputSources) {
    await using inputHandle = await open(inputSource.path, 'r')
    yield* readSamples({
      type: inputSource.type,
      path: inputSource.path,
      stream: inputHandle.createReadStream(),
    })
  }
}

export async function evaluate(
  params: {
    model: string
    criteria: GlobPatterns
    inputText?: GlobPatterns
    inputJsonl?: GlobPatterns
    output: string
    allowSkip?: boolean
    maxErrors?: number
    dryRun?: boolean
    signal?: AbortSignal
  },
  deps = defaultDeps
): Promise<EvaluateSummary> {
  const inputSource = chooseInputSource({
    inputText: params.inputText,
    inputJsonl: params.inputJsonl,
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
  const seed = 0
  const singleShotRequest = dryRun
    ? dryRunRequest
    : withResultCache({
        singleShotRequest: deps.createCliRequestOutput({ model: params.model })
          .singleShotRequest,
        cacheDir: await deps.getCacheDir(),
        model: params.model,
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
    return { counts, outcome: params.signal?.aborted ? 'aborted' : 'completed' }
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
  return { counts, outcome }
}

evaluate.defaultDeps = defaultDeps
