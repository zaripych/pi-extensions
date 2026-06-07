import dedent from 'dedent'
import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupEvaluate } from './evaluate.harness'

const markdown = dedent

const setup = combineHarnesses(setupEvaluate)

/**
 * This test is focusing on observable behaviors that reach into the evaluation
 * function successfully but without actually making expensive calls to LLM providers,
 * to test arguments parsing or actually hit LLM's have a look at pi-evaluate/src/e2e/e2e.harness.ts
 */

describe('evaluate', () => {
  it('writes one consumable result row for one JSONL sample and one fieldless criterion', async () => {
    await using harness = await setup()

    const result = await harness.runEvaluate({
      model: 'test/model',
      criteria: markdown`
        ---
        name: helpfulness
        score-range: binary
        ---

        Score whether the answer is helpful.
      `,
      inputJsonl: [{ answer: 'Use the harness, not the real model.' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'The answer is helpful.' }),
    })

    expect(result).toEqual([
      { score: expect.any(Number), reason: expect.stringMatching(/\S/) },
    ])
  })
})
