import type { Criteria } from './parseCriteria'
import { shouldEvaluate } from './shouldEvaluate'
import { singleShotEval } from './singleShotEval'
import type { SingleShotRequest } from './singleShotRequest'

export type Sample =
  | { id: string; text: string }
  | { id: string; record: Record<string, unknown> }

export type ResultRow =
  | { status: 'success'; sampleId: string; score: number; reason: string }
  | { status: 'skipped'; sampleId: string; description: string }
  | { status: 'error'; sampleId: string; description: string }

export async function* evaluateSamples(params: {
  samples: AsyncIterable<Sample> | Iterable<Sample>
  gevals: Criteria[]
  singleShotRequest: SingleShotRequest
  allowSkip: boolean
  signal?: AbortSignal
}): AsyncGenerator<ResultRow> {
  for await (const sample of params.samples) {
    if (params.signal?.aborted) return
    for (const geval of params.gevals) {
      if (params.signal?.aborted) return
      const { should, description } = shouldEvaluate({ sample, geval })
      if (!should) {
        yield {
          status: params.allowSkip ? 'skipped' : 'error',
          sampleId: sample.id,
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
          signal: params.signal,
        })
        yield {
          status: 'success',
          sampleId: sample.id,
          score: verdict.score,
          reason: verdict.reason,
        }
      } catch (error) {
        if (params.signal?.aborted) return
        yield {
          status: 'error',
          sampleId: sample.id,
          description: error instanceof Error ? error.message : String(error),
        }
      }
    }
  }
}
