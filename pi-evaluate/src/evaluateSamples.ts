import type { Criterion } from './parseCriterion'
import { shouldEvaluate } from './shouldEvaluate'
import { singleShotEval } from './singleShotEval'
import type { SingleShotRequest } from './singleShotRequest'

export type Sample = string | Record<string, unknown>

export type ResultRow =
  | { status: 'success'; score: number; reason: string }
  | { status: 'skipped'; description: string }
  | { status: 'error'; description: string }

export async function* evaluateSamples(params: {
  samples: AsyncIterable<Sample> | Iterable<Sample>
  criterion: Criterion
  singleShotRequest: SingleShotRequest
  allowSkip: boolean
  signal?: AbortSignal
}): AsyncGenerator<ResultRow> {
  for await (const sample of params.samples) {
    if (params.signal?.aborted) return
    const { should, description } = shouldEvaluate({
      sample,
      criterion: params.criterion,
    })
    if (!should) {
      yield {
        status: params.allowSkip ? 'skipped' : 'error',
        description: description ?? '',
      }
      continue
    }
    try {
      const verdict = await singleShotEval({
        singleShotRequest: params.singleShotRequest,
        criteria: params.criterion.body,
        scoreRange: params.criterion.scoreRange,
        sample,
        signal: params.signal,
      })
      yield { status: 'success', score: verdict.score, reason: verdict.reason }
    } catch (error) {
      if (params.signal?.aborted) return
      yield {
        status: 'error',
        description: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
