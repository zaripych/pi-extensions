import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import { evaluateSamples, type Sample } from './evaluateSamples'
import type { SingleShotRequest } from './singleShotRequest'

export type EvaluateInput = {
  type: 'text' | 'jsonl'
  stream: Readable
}

export type InputSource = { type: 'text' | 'jsonl'; path: string }

const sampleSchema = z.record(z.string(), z.unknown())

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function* readSamples(input: EvaluateInput): AsyncGenerator<Sample> {
  if (input.type === 'text') {
    yield await readAll(input.stream)
    return
  }
  const lines = createInterface({ input: input.stream, crlfDelay: Infinity })
  for await (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    yield sampleSchema.parse(JSON.parse(trimmed))
  }
}

export async function evaluateStreams(params: {
  input: EvaluateInput
  output: Writable
  criteria: string
  singleShotRequest: SingleShotRequest
  onError?: (params: { sample: Sample; error: unknown }) => void
}): Promise<void> {
  await pipeline(async function* () {
    for await (const result of evaluateSamples({
      samples: readSamples(params.input),
      criteria: params.criteria,
      singleShotRequest: params.singleShotRequest,
    })) {
      if ('error' in result) {
        if (params.onError === undefined) throw result.error
        params.onError({ sample: result.sample, error: result.error })
        continue
      }
      yield `${JSON.stringify({ score: result.verdict.score, reason: result.verdict.reason })}\n`
    }
  }, params.output)
}
