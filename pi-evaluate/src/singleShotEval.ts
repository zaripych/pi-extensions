import { z } from 'zod'
import type { Sample } from './evaluateSamples'
import type { SingleShotRequest } from './singleShotRequest'

const verdictSchema = z.object({
  score: z.number(),
  reason: z.string(),
})

export type Verdict = z.infer<typeof verdictSchema>

function buildPrompt(params: {
  criteria: string
  sample: Sample
}): string {
  const renderedSample =
    typeof params.sample === 'string'
      ? params.sample
      : JSON.stringify(params.sample, null, 2)
  return [
    'You are an evaluator. Apply the following criterion to the sample.',
    '',
    '## Criterion',
    params.criteria,
    '',
    '## Sample',
    renderedSample,
    '',
    'Return your verdict as a JSON object with a numeric "score" and a "reason".',
  ].join('\n')
}

export async function singleShotEval(params: {
  singleShotRequest: SingleShotRequest
  criteria: string
  sample: Sample
}): Promise<Verdict> {
  const verdict = await params.singleShotRequest({
    prompt: buildPrompt({ criteria: params.criteria, sample: params.sample }),
    schema: verdictSchema,
  })
  if (verdict.reason.length === 0) {
    throw new Error('Evaluator returned an empty reason.')
  }
  return verdict
}
