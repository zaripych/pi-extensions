import dedent from 'dedent'
import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupE2e } from './e2e.harness'

const markdown = dedent
const setup = combineHarnesses(setupE2e)

const models = ['openai/gpt-5.4-mini', 'anthropic/claude-sonnet-4-6']

describe('evaluate CLI', () => {
  it('exits unsuccessfully with a clear error and no result row when criteria is missing', async () => {
    await using harness = await setup()
    const { runEvaluateCli, inputArgs, outputArgs } = harness

    const result = await runEvaluateCli({
      args: [
        '--model',
        'test/model',
        ...(await inputArgs([{ answer: 'hello' }])),
        ...outputArgs(),
      ],
    })

    expect(result).toEqual({
      code: 1,
      stderr: expect.stringContaining('Missing required argument: criteria'),
      stdout: '',
      resultRows: [],
    })
  })

  it('aborts with a clear error and no result row when a criterion omits score-range', async () => {
    await using harness = await setup()
    const { runEvaluateCli, criteriaArgs, inputArgs, outputArgs } = harness

    const result = await runEvaluateCli({
      args: [
        '--model',
        'test/model',
        ...(await criteriaArgs(markdown`
          ---
          name: helpfulness
          ---

          Score whether the answer is helpful.
        `)),
        ...(await inputArgs([{ answer: 'hello' }])),
        ...outputArgs(),
      ],
    })

    expect(result).toEqual({
      code: 1,
      stderr: expect.stringContaining('score-range'),
      stdout: '',
      resultRows: [],
    })
  })

  it('aborts with a clear error and no result row when a criterion sets an unsupported score-range', async () => {
    await using harness = await setup()
    const { runEvaluateCli, criteriaArgs, inputArgs, outputArgs } = harness

    const result = await runEvaluateCli({
      args: [
        '--model',
        'test/model',
        ...(await criteriaArgs(markdown`
          ---
          score-range: quintuple
          ---

          Score whether the answer is helpful.
        `)),
        ...(await inputArgs([{ answer: 'hello' }])),
        ...outputArgs(),
      ],
    })

    expect(result).toEqual({
      code: 1,
      stderr: expect.stringContaining('score-range'),
      stdout: '',
      resultRows: [],
    })
  })
})

describe.skipIf(!process.env.E2E)('evaluate CLI against real models', () => {
  it.each(models)(
    'writes one structured verdict row when judging a text sample with %s',
    async (model) => {
      await using harness = await setup()
      const { runEvaluateCli, criteriaArgs, inputArgs, outputArgs } = harness

      const result = await runEvaluateCli({
        args: [
          '--model',
          model,
          ...(await criteriaArgs(markdown`
            ---
            name: positive_sentiment
            score-range: binary
            ---

            Evaluate whether the sample text expresses a positive sentiment.

            Steps:
            1. Read the text.
            2. Decide whether its overall sentiment is positive.

            Score 1 if the sentiment is positive, otherwise score 0.
          `)),
          ...(await inputArgs(
            'I absolutely love this, it made my whole day wonderful!'
          )),
          ...outputArgs(),
        ],
      })

      expect(result).toEqual(
        expect.objectContaining({
          code: 0,
          resultRows: [
            {
              status: 'success',
              score: expect.any(Number),
              reason: expect.stringMatching(/.+/),
            },
          ],
        })
      )
    },
    120_000
  )
})
