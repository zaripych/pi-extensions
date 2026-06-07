import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { faker } from '@faker-js/faker'
import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { z } from 'zod'
import { evaluate } from './evaluate'
import type { SingleShotRequest } from './singleShotRequest'

type RunEvaluateParams = {
  model?: string
  criteria?: string | string[]
  input?: string | Record<string, unknown>[]
  singleShotRequest?: SingleShotRequest
  allowSkip?: boolean
  maxErrors?: number
  dryRun?: boolean
  signal?: AbortSignal
}

const resultRowSchema = z.unknown()

async function writeCriteria(params: {
  tempDir: string
  id: string
  criteria: string | string[] | undefined
}): Promise<string> {
  const bodies =
    params.criteria === undefined
      ? [faker.lorem.paragraph()]
      : Array.isArray(params.criteria)
        ? params.criteria
        : [params.criteria]
  if (!Array.isArray(params.criteria)) {
    const criteriaPath = join(params.tempDir, `criteria-${params.id}.md`)
    await writeFile(criteriaPath, bodies[0] ?? '')
    return criteriaPath
  }
  await Promise.all(
    bodies.map((body, index) =>
      writeFile(
        join(params.tempDir, `criteria-${params.id}-${index}.md`),
        body
      )
    )
  )
  return join(params.tempDir, `criteria-${params.id}-*.md`)
}

async function writeInput(params: {
  tempDir: string
  id: string
  input: string | Record<string, unknown>[] | undefined
}): Promise<{ inputText?: string; inputJsonl?: string }> {
  if (params.input === undefined) {
    return {}
  }
  if (typeof params.input === 'string') {
    const inputPath = join(params.tempDir, `input-${params.id}.txt`)
    await writeFile(inputPath, params.input)
    return { inputText: inputPath }
  }
  const inputPath = join(params.tempDir, `input-${params.id}.jsonl`)
  await writeFile(
    inputPath,
    params.input.map((sample) => `${JSON.stringify(sample)}\n`).join('')
  )
  return { inputJsonl: inputPath }
}

const missingFileErrorSchema = z.object({ code: z.literal('ENOENT') })

async function readResultRows(outputPath: string): Promise<unknown[]> {
  let contents: string
  try {
    contents = await readFile(outputPath, 'utf8')
  } catch (error) {
    if (missingFileErrorSchema.safeParse(error).success) {
      return []
    }
    throw error
  }
  const trimmed = contents.trim()
  if (trimmed.length === 0) {
    return []
  }
  return trimmed
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => resultRowSchema.parse(JSON.parse(line)))
}

function createDepsWithSingleShotRequest(params: {
  singleShotRequest: SingleShotRequest
  cacheDir: string
}) {
  return {
    createCliRequestOutput: () => ({ singleShotRequest: params.singleShotRequest }),
    getCacheDir: async () => params.cacheDir,
  }
}

export const setupEvaluate = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: evaluate.defaultDeps },
  },
  async (userDeps) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pi-evaluate-'))
    const cacheDir = join(tempDir, '.eval-cache')
    const deps = configureDependencies(
      { inferTypesFrom: { defaultDeps: evaluate.defaultDeps }, userDeps },
      {
        createCliRequestOutput: () => ({
          singleShotRequest: async ({ schema }) =>
            schema.parse({
              score: faker.number.int({ min: 0, max: 1 }),
              reason: faker.lorem.sentence(),
            }),
        }),
        getCacheDir: async () => cacheDir,
      }
    )

    async function readCacheEntries(): Promise<string[]> {
      try {
        return (await readdir(cacheDir)).sort()
      } catch (error) {
        if (missingFileErrorSchema.safeParse(error).success) {
          return []
        }
        throw error
      }
    }

    async function overwriteCacheEntries(content: string): Promise<void> {
      await Promise.all(
        (await readCacheEntries()).map((entry) =>
          writeFile(join(cacheDir, entry, 'result.json'), content)
        )
      )
    }

    async function writeTempFile(content = ''): Promise<string> {
      const path = join(tempDir, `temp-${faker.string.alphanumeric(8)}`)
      await writeFile(path, content)
      return path
    }

    async function runEvaluate(
      params: RunEvaluateParams
    ): Promise<{ rows: unknown[]; summary: Awaited<ReturnType<typeof evaluate>> }> {
      const id = faker.string.alphanumeric(8)
      const outputPath = join(tempDir, `eval-results-${id}.jsonl`)
      const criteriaPath = await writeCriteria({
        tempDir,
        id,
        criteria: params.criteria,
      })
      const inputSources = await writeInput({ tempDir, id, input: params.input })
      const evaluateDeps =
        params.singleShotRequest === undefined
          ? deps
          : createDepsWithSingleShotRequest({
              singleShotRequest: params.singleShotRequest,
              cacheDir,
            })

      const summary = await evaluate(
        {
          model: params.model ?? `test/${faker.string.alphanumeric(8)}`,
          criteria: criteriaPath,
          inputText: inputSources.inputText,
          inputJsonl: inputSources.inputJsonl,
          output: outputPath,
          allowSkip: params.allowSkip,
          maxErrors: params.maxErrors,
          dryRun: params.dryRun,
          signal: params.signal,
        },
        evaluateDeps
      )

      return { rows: await readResultRows(outputPath), summary }
    }

    return {
      ...deps,
      cacheDir,
      readCacheEntries,
      overwriteCacheEntries,
      writeTempFile,
      evaluate: withDeps(evaluate, deps),
      runEvaluate,
      async [Symbol.asyncDispose]() {
        await rm(tempDir, { recursive: true, force: true })
      },
    }
  }
)
