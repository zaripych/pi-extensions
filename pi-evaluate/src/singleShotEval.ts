import { z } from 'zod'
import type { Sample } from './evaluateSamples'
import type { Criterion } from './parseCriterion'
import type { SingleShotRequest } from './singleShotRequest'

const rawScoreSchemaByRange = {
  binary: z.literal([0, 1]),
  triple: z.literal([0, 1, 2]),
} satisfies Record<Criterion['scoreRange'], z.ZodType<number>>

const maxRawScoreByRange = {
  binary: 1,
  triple: 2,
} satisfies Record<Criterion['scoreRange'], number>

function buildVerdictSchema(scoreRange: Criterion['scoreRange']) {
  return z.object({
    score: rawScoreSchemaByRange[scoreRange],
    reason: z.string().min(1),
  })
}

export type Verdict = { score: number; reason: string }

function describeScoreRange(scoreRange: Criterion['scoreRange']) {
  switch (scoreRange) {
    case 'binary':
      return 'The "score" must be an integer: 0 (fail) or 1 (pass).'
    case 'triple':
      return 'The "score" must be an integer: 0 (fail), 1 (partial), or 2 (pass).'
  }
}

function buildPrompt(params: {
  criteria: string
  sample: Sample
  scoreRange: Criterion['scoreRange']
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
    describeScoreRange(params.scoreRange),
  ].join('\n')
}

export async function singleShotEval(params: {
  singleShotRequest: SingleShotRequest
  criteria: string
  scoreRange: Criterion['scoreRange']
  sample: Sample
  signal?: AbortSignal
}): Promise<Verdict> {
  const verdict = await params.singleShotRequest({
    prompt: buildPrompt({
      criteria: params.criteria,
      sample: params.sample,
      scoreRange: params.scoreRange,
    }),
    schema: buildVerdictSchema(params.scoreRange),
    signal: params.signal,
  })
  return {
    score: verdict.score / maxRawScoreByRange[params.scoreRange],
    reason: verdict.reason,
  }
}
