import { singleShotEval, type Verdict } from './singleShotEval'
import type { SingleShotRequest } from './singleShotRequest'

export type Sample = string | Record<string, unknown>

export type EvaluateSamplesResult =
  | { sample: Sample; verdict: Verdict }
  | { sample: Sample; error: unknown }

export async function* evaluateSamples(params: {
  samples: AsyncIterable<Sample> | Iterable<Sample>
  criteria: string
  singleShotRequest: SingleShotRequest
}): AsyncGenerator<EvaluateSamplesResult> {
  for await (const sample of params.samples) {
    try {
      const verdict = await singleShotEval({
        singleShotRequest: params.singleShotRequest,
        criteria: params.criteria,
        sample,
      })
      yield { sample, verdict }
    } catch (error) {
      yield { sample, error }
    }
  }
}
