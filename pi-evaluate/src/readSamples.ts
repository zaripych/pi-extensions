import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import { z } from 'zod'
import type { Sample } from './evaluateSamples'

export type EvaluateInput = {
  type: 'text' | 'jsonl'
  path: string
  stream: Readable
}

const sampleSchema = z.record(z.string(), z.unknown())

function previewLine(line: string): string {
  return line.length > 80 ? `${line.slice(0, 80)}…` : line
}

function parseJsonlSample(line: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (cause) {
    throw new Error(
      `JSONL input must contain one JSON object per line; could not parse line: ${previewLine(line)}`,
      { cause }
    )
  }
  const parsed = sampleSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(
      `JSONL input must contain one JSON object per line, not a JSON array or other value; offending line: ${previewLine(line)}`,
      { cause: parsed.error }
    )
  }
  return parsed.data
}

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
    yield { id: input.path, text: await readAll(input.stream) }
    return
  }
  const lines = createInterface({ input: input.stream, crlfDelay: Infinity })
  let index = 0
  for await (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    yield { id: `${input.path}#[${index}]`, record: parseJsonlSample(trimmed) }
    index += 1
  }
}
