import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import { z } from 'zod'
import type { Sample } from './evaluateSamples'

export type EvaluateInput = {
  type: 'text' | 'jsonl' | 'text-nul'
  path: string
  stream: Readable
  seenSampleIds: Set<string>
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

function claimSampleId(params: {
  sampleId: string
  path: string
  seenSampleIds: Set<string>
}): string {
  if (params.seenSampleIds.has(params.sampleId)) {
    throw new Error(
      `Duplicate sampleId "${params.sampleId}" in "${params.path}"; sampleIds must be unique across the run.`
    )
  }
  params.seenSampleIds.add(params.sampleId)
  return params.sampleId
}

function toJsonlSample(params: {
  record: Record<string, unknown>
  path: string
  index: number
  seenSampleIds: Set<string>
}): Sample {
  if (!('sampleId' in params.record)) {
    return {
      id: claimSampleId({
        sampleId: `${params.path}#[${params.index}]`,
        path: params.path,
        seenSampleIds: params.seenSampleIds,
      }),
      record: params.record,
    }
  }
  const { sampleId, ...record } = params.record
  if (typeof sampleId !== 'string' || sampleId.length === 0) {
    throw new Error(
      `Record ${params.path}#[${params.index}] has an invalid sampleId; it must be a non-empty string.`
    )
  }
  return {
    id: claimSampleId({
      sampleId,
      path: params.path,
      seenSampleIds: params.seenSampleIds,
    }),
    record,
  }
}

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseTextNulSegment(params: {
  segment: string
  path: string
  index: number
  seenSampleIds: Set<string>
}): Sample {
  if (params.segment.length === 0) {
    throw new Error(
      `NUL-separated sample ${params.index + 1} in "${params.path}" is empty; only a trailing NUL separator is allowed.`
    )
  }
  const newlineIndex = params.segment.indexOf('\n')
  if (newlineIndex === -1) {
    throw new Error(
      `NUL-separated sample ${params.index + 1} in "${params.path}" has no newline separating the id line from the text.`
    )
  }
  const suppliedId = params.segment.slice(0, newlineIndex).trim()
  const id = claimSampleId({
    sampleId:
      suppliedId.length > 0
        ? suppliedId
        : `${params.path}#[${params.index}]`,
    path: params.path,
    seenSampleIds: params.seenSampleIds,
  })
  const text = params.segment.slice(newlineIndex + 1)
  return { id, text }
}

async function* readTextNulSamples(input: EvaluateInput): AsyncGenerator<Sample> {
  const decoder = new TextDecoder()
  let buffer = ''
  let index = 0
  const takeSegment = (nulIndex: number): Sample => {
    const segment = buffer.slice(0, nulIndex)
    buffer = buffer.slice(nulIndex + 1)
    const sample = parseTextNulSegment({
      segment,
      path: input.path,
      index,
      seenSampleIds: input.seenSampleIds,
    })
    index += 1
    return sample
  }
  for await (const chunk of input.stream) {
    buffer += decoder.decode(Buffer.from(chunk), { stream: true })
    let nulIndex = buffer.indexOf('\0')
    while (nulIndex !== -1) {
      yield takeSegment(nulIndex)
      nulIndex = buffer.indexOf('\0')
    }
  }
  buffer += decoder.decode()
  if (buffer.length > 0) {
    yield takeSegment(buffer.length)
  }
}

export async function* readSamples(
  input: EvaluateInput
): AsyncGenerator<Sample> {
  if (input.type === 'text') {
    yield { id: input.path, text: await readAll(input.stream) }
    return
  }
  if (input.type === 'text-nul') {
    yield* readTextNulSamples(input)
    return
  }
  const lines = createInterface({ input: input.stream, crlfDelay: Infinity })
  let index = 0
  for await (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    yield toJsonlSample({
      record: parseJsonlSample(trimmed),
      path: input.path,
      index,
      seenSampleIds: input.seenSampleIds,
    })
    index += 1
  }
}
