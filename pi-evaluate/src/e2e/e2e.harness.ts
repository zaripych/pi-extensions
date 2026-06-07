import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { faker } from '@faker-js/faker'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { z } from 'zod'

const execFileAsync = promisify(execFile)
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const binPath = join(packageDir, 'bin', 'evaluate.ts')
const execFileErrorSchema = z.object({
  code: z.union([z.number(), z.string()]).optional(),
  stderr: z.union([z.string(), z.instanceof(Buffer)]),
  stdout: z.union([z.string(), z.instanceof(Buffer)]),
})
const missingFileErrorSchema = z.object({ code: z.literal('ENOENT') })

async function writeInput(params: {
  tempDir: string
  id: string
  input: string | Record<string, unknown>[]
}): Promise<string[]> {
  if (typeof params.input === 'string') {
    const inputPath = join(params.tempDir, `input-${params.id}.txt`)
    await writeFile(inputPath, params.input)
    return ['--input-text', inputPath]
  }
  const inputPath = join(params.tempDir, `input-${params.id}.jsonl`)
  await writeFile(
    inputPath,
    params.input.map((sample) => `${JSON.stringify(sample)}\n`).join('')
  )
  return ['--input-jsonl', inputPath]
}

async function readJsonlLines(filePath: string): Promise<string[]> {
  try {
    const contents = await readFile(filePath, 'utf8')
    const trimmed = contents.trim()
    if (trimmed.length === 0) {
      return []
    }
    return trimmed.split('\n').filter((line) => line.length > 0)
  } catch (error) {
    if (missingFileErrorSchema.safeParse(error).success) {
      return []
    }
    throw error
  }
}

async function readJsonlRows(filePath: string): Promise<unknown[]> {
  return (await readJsonlLines(filePath)).map((line) =>
    z.unknown().parse(JSON.parse(line))
  )
}

function findOutputPath(args: string[]): string | undefined {
  const outputArgIndex = args.indexOf('--output')
  if (outputArgIndex === -1) {
    return undefined
  }
  return args.at(outputArgIndex + 1)
}

export const setupE2e = configureHarnesses(async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pi-evaluate-e2e-'))
  const id = faker.string.alphanumeric(8)
  const outputPath = join(tempDir, `eval-results-${id}.jsonl`)

  async function runEvaluateCli(params: { args: string[] }): Promise<{
    code: number | string | undefined
    stderr: string
    stdout: string
    resultRows?: unknown[]
  }> {
    const outputPath = findOutputPath(params.args)

    async function withResultRows(result: {
      code: number | string | undefined
      stderr: string
      stdout: string
    }): Promise<{
      code: number | string | undefined
      stderr: string
      stdout: string
      resultRows?: unknown[]
    }> {
      if (outputPath === undefined) {
        return result
      }
      return { ...result, resultRows: await readJsonlRows(outputPath) }
    }

    try {
      const result = await execFileAsync(
        process.execPath,
        ['--import', 'tsx', binPath, ...params.args],
        { cwd: packageDir }
      )
      return withResultRows({
        code: 0,
        stderr: result.stderr,
        stdout: result.stdout,
      })
    } catch (error) {
      const parsedError = execFileErrorSchema.safeParse(error)
      if (!parsedError.success) {
        throw error
      }
      return withResultRows({
        code: parsedError.data.code,
        stderr: parsedError.data.stderr.toString(),
        stdout: parsedError.data.stdout.toString(),
      })
    }
  }

  async function inputArgs(input: string | Record<string, unknown>[]): Promise<string[]> {
    return writeInput({ tempDir, id, input })
  }

  async function criteriaArgs(criteria: string): Promise<string[]> {
    const criteriaPath = join(tempDir, `criteria-${id}.md`)
    await writeFile(criteriaPath, criteria)
    return ['--criteria', criteriaPath]
  }

  function outputArgs(): string[] {
    return ['--output', outputPath]
  }

  return {
    runEvaluateCli,
    inputArgs,
    criteriaArgs,
    outputArgs,
    async [Symbol.asyncDispose]() {
      await rm(tempDir, { recursive: true, force: true })
    },
  }
})
