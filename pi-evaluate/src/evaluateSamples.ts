import type { Criteria } from './parseCriteria'
import { shortHash } from './shortHash'
import { shouldEvaluate } from './shouldEvaluate'
import { singleShotEval } from './singleShotEval'
import type { SingleShotRequest } from './singleShotRequest'

export type Sample =
  | { id: string; text: string }
  | { id: string; record: Record<string, unknown> }

type Base = {
  name: string
  sampleId: string
  sampleHash: string
  criteriaHash: string
  model: string
  seed: number
}

export type ResultRow =
  | (Base & { status: 'success'; score: number; reason: string })
  | (Base & { status: 'skipped'; description: string })
  | (Base & { status: 'error'; description: string })

function hashSample(sample: Sample): string {
  return shortHash(
    'text' in sample ? sample.text : JSON.stringify(sample.record)
  )
}

export async function* evaluateSamples(params: {
  samples: AsyncIterable<Sample> | Iterable<Sample>
  gevals: Criteria[]
  singleShotRequest: SingleShotRequest
  allowSkip: boolean
  model: string
  seed: number
  signal?: AbortSignal
}): AsyncGenerator<ResultRow> {
  for await (const sample of params.samples) {
    if (params.signal?.aborted) return
    const sampleHash = hashSample(sample)
    for (const geval of params.gevals) {
      if (params.signal?.aborted) return
      const base: Base = {
        name: geval.name,
        sampleId: sample.id,
        sampleHash,
        criteriaHash: geval.criteriaHash,
        model: params.model,
        seed: params.seed,
      }
      const { should, description } = shouldEvaluate({ sample, geval })
      if (!should) {
        yield {
          ...base,
          status: params.allowSkip ? 'skipped' : 'error',
          description: description ?? '',
        }
        continue
      }
      try {
        const verdict = await singleShotEval({
          singleShotRequest: params.singleShotRequest,
          criteria: geval.body,
          scoreRange: geval.scoreRange,
          sample,
          seed: params.seed,
          signal: params.signal,
        })
        yield {
          ...base,
          status: 'success',
          score: verdict.score,
          reason: verdict.reason,
        }
      } catch (error) {
        if (params.signal?.aborted) return
        yield {
          ...base,
          status: 'error',
          description: error instanceof Error ? error.message : String(error),
        }
      }
    }
  }
}
