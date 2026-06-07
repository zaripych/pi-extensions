import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { faker } from '@faker-js/faker'
import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { z } from 'zod'
import { evaluate } from './evaluate'
import type { SingleShotRequest } from './singleShotRequest'

type JsonlInput = string | Record<string, unknown>[]

type RunEvaluateParams = {
  model?: string
  criteria?: string
  input?: string | Record<string, unknown>[]
  inputText?: string
  inputJsonl?: JsonlInput
  singleShotRequest?: SingleShotRequest
}

const resultRowSchema = z.unknown()

async function writeJsonlInput(params: {
  tempDir: string
  id: string
  inputJsonl: JsonlInput
}): Promise<string> {
  const inputPath = join(params.tempDir, `input-${params.id}.jsonl`)
  const content =
    typeof params.inputJsonl === 'string'
      ? params.inputJsonl
      : params.inputJsonl.map((sample) => `${JSON.stringify(sample)}\n`).join('')
  await writeFile(inputPath, content)
  return inputPath
}

async function writeInputSources(params: {
  tempDir: string
  id: string
  input: string | Record<string, unknown>[] | undefined
  inputText: string | undefined
  inputJsonl: JsonlInput | undefined
}): Promise<{ inputText?: string; inputJsonl?: string }> {
  if (params.input !== undefined) {
    if (params.inputText !== undefined || params.inputJsonl !== undefined) {
      throw new Error('Pass input or explicit inputText/inputJsonl, not both.')
    }
    if (typeof params.input === 'string') {
      return writeInputSources({
        tempDir: params.tempDir,
        id: params.id,
        input: undefined,
        inputText: params.input,
        inputJsonl: undefined,
      })
    }
    return writeInputSources({
      tempDir: params.tempDir,
      id: params.id,
      input: undefined,
      inputText: undefined,
      inputJsonl: params.input,
    })
  }

  const inputSources: { inputText?: string; inputJsonl?: string } = {}

  if (params.inputText !== undefined) {
    const inputPath = join(params.tempDir, `input-${params.id}.txt`)
    await writeFile(inputPath, params.inputText)
    inputSources.inputText = inputPath
  }

  if (params.inputJsonl !== undefined) {
    inputSources.inputJsonl = await writeJsonlInput({
      tempDir: params.tempDir,
      id: params.id,
      inputJsonl: params.inputJsonl,
    })
  }

  return inputSources
}

async function readResultRows(outputPath: string): Promise<unknown[]> {
  const contents = await readFile(outputPath, 'utf8')
  const trimmed = contents.trim()
  if (trimmed.length === 0) {
    return []
  }
  return trimmed
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => resultRowSchema.parse(JSON.parse(line)))
}

function createDepsWithSingleShotRequest(singleShotRequest: SingleShotRequest) {
  return {
    createCliRequestOutput: () => ({ singleShotRequest }),
  }
}

export const setupEvaluate = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: evaluate.defaultDeps },
  },
  async (userDeps) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pi-evaluate-'))
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
      }
    )

    async function runEvaluate(params: RunEvaluateParams): Promise<unknown[]> {
      const id = faker.string.alphanumeric(8)
      const criteriaPath = join(tempDir, `criterion-${id}.md`)
      const outputPath = join(tempDir, `eval-results-${id}.jsonl`)
      await writeFile(criteriaPath, params.criteria ?? faker.lorem.paragraph())
      const inputSources = await writeInputSources({
        tempDir,
        id,
        input: params.input,
        inputText: params.inputText,
        inputJsonl: params.inputJsonl,
      })
      const evaluateDeps =
        params.singleShotRequest === undefined
          ? deps
          : createDepsWithSingleShotRequest(params.singleShotRequest)

      await evaluate(
        {
          model: params.model ?? `test/${faker.string.alphanumeric(8)}`,
          criteria: criteriaPath,
          inputText: inputSources.inputText,
          inputJsonl: inputSources.inputJsonl,
          output: outputPath,
        },
        evaluateDeps
      )

      return readResultRows(outputPath)
    }

    return {
      ...deps,
      evaluate: withDeps(evaluate, deps),
      runEvaluate,
      async [Symbol.asyncDispose]() {
        await rm(tempDir, { recursive: true, force: true })
      },
    }
  }
)
