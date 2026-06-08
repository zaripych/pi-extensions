import { z } from 'zod'
import type { Sample } from './evaluateSamples'
import type { Criteria } from './parseCriteria'
import type { SingleShotRequest } from './singleShotRequest'

const rawScoreSchemaByRange = {
  binary: z.literal([0, 1]),
  triple: z.literal([0, 1, 2]),
} satisfies Record<Criteria['scoreRange'], z.ZodType<number>>

const maxRawScoreByRange = {
  binary: 1,
  triple: 2,
} satisfies Record<Criteria['scoreRange'], number>

function buildVerdictSchema(scoreRange: Criteria['scoreRange']) {
  return z.object({
    score: rawScoreSchemaByRange[scoreRange],
    reason: z.string().min(1),
  })
}

export type Verdict = { normalizedScore: number; reason: string }

function describeScoreRange(scoreRange: Criteria['scoreRange']) {
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
  scoreRange: Criteria['scoreRange']
}): string {
  const renderedSample =
    'text' in params.sample
      ? params.sample.text
      : JSON.stringify(params.sample.record, null, 2)
  return [
    'You are an evaluator. Judge <input> using <criteria>.',
    '',
    '<criteria>',
    params.criteria,
    '</criteria>',
    '',
    '<input>',
    renderedSample,
    '</input>',
    '',
    'Return your verdict as a JSON object with a numeric "score" and a "reason".',
    describeScoreRange(params.scoreRange),
  ].join('\n')
}

export async function singleShotEval(params: {
  singleShotRequest: SingleShotRequest
  criteria: string
  scoreRange: Criteria['scoreRange']
  sample: Sample
  seed: number
  signal?: AbortSignal
}): Promise<Verdict> {
  const verdict = await params.singleShotRequest({
    prompt: buildPrompt({
      criteria: params.criteria,
      sample: params.sample,
      scoreRange: params.scoreRange,
    }),
    schema: buildVerdictSchema(params.scoreRange),
    seed: params.seed,
    signal: params.signal,
  })
  return {
    normalizedScore: verdict.score / maxRawScoreByRange[params.scoreRange],
    reason: verdict.reason,
  }
}
