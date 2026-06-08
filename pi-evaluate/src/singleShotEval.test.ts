import { describe, expect, it } from 'vitest'
import { singleShotEval } from './singleShotEval'

describe('singleShotEval', () => {
  it('wraps criteria and input in explicit tags before asking for a verdict', async () => {
    let receivedPrompt = ''

    await singleShotEval({
      singleShotRequest: async ({ prompt, schema }) => {
        receivedPrompt = prompt
        return schema.parse({ score: 1, reason: 'ok' })
      },
      criteria: 'Score whether the answer is helpful.',
      scoreRange: 'binary',
      sample: { id: 'sample.txt', text: 'The answer to judge.' },
      seed: 0,
    })

    expect(receivedPrompt).toBe(
      [
        'You are an evaluator. Judge <input> using <criteria>.',
        '',
        '<criteria>',
        'Score whether the answer is helpful.',
        '</criteria>',
        '',
        '<input>',
        'The answer to judge.',
        '</input>',
        '',
        'Return your verdict as a JSON object with a numeric "score" and a "reason".',
        'The "score" must be an integer: 0 (fail) or 1 (pass).',
      ].join('\n')
    )
  })
})
