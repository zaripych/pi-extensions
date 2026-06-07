import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import { z } from 'zod'
import type { Sample } from './evaluateSamples'

export type EvaluateInput = {
  type: 'text' | 'jsonl'
  stream: Readable
}

const sampleSchema = z.record(z.string(), z.unknown())

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function* readSamples(
  input: EvaluateInput
): AsyncGenerator<Sample> {
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
