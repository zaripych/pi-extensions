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

  it('aborts with a clear error and no result row when criteria omit score-range', async () => {
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

  it('aborts with a clear error and no result row when both --input-text and --input-jsonl are passed', async () => {
    await using harness = await setup()
    const { runEvaluateCli, criteriaArgs, inputArgs, outputArgs } = harness

    const result = await runEvaluateCli({
      args: [
        '--model',
        'test/model',
        ...(await criteriaArgs(markdown`
          ---
          score-range: binary
          ---

          Score whether the answer is helpful.
        `)),
        ...(await inputArgs('a blob of text')),
        ...(await inputArgs([{ answer: 'hello' }])),
        ...outputArgs(),
      ],
    })

    expect(result).toEqual({
      code: 1,
      stderr: expect.stringContaining('only one of'),
      stdout: '',
      resultRows: [],
    })
  })

  it('aborts with a clear error and no result row when --criteria matches no files', async () => {
    await using harness = await setup()
    const { runEvaluateCli, inputArgs, outputArgs } = harness

    const result = await runEvaluateCli({
      args: [
        '--model',
        'test/model',
        '--criteria',
        'no-such-criteria-glob-*.md',
        ...(await inputArgs([{ answer: 'hello' }])),
        ...outputArgs(),
      ],
    })

    expect(result).toEqual({
      code: 1,
      stderr: expect.stringContaining('No criteria files matched'),
      stdout: '',
      resultRows: [],
    })
  })

  it('reads every sample from a process-substituted --input-jsonl', async () => {
    await using harness = await setup()
    const {
      runEvaluateShell,
      criteriaArgs,
      outputArgs,
      evaluateCommand,
      writeTempFile,
    } = harness

    const criteriaPath = (await criteriaArgs(markdown`
      ---
      score-range: binary
      ---

      Score whether the answer is helpful.
    `)).at(1)
    const dataPath = await writeTempFile({
      name: 'records.jsonl',
      content: `${JSON.stringify({ answer: 'first' })}\n${JSON.stringify({ answer: 'second' })}\n`,
    })

    const result = await runEvaluateShell({
      command: `${evaluateCommand} --model test/model --dry-run --criteria '${criteriaPath}' --input-jsonl <(cat '${dataPath}') ${outputArgs().join(' ')}`,
    })

    expect(result).toEqual(
      expect.objectContaining({
        code: 0,
        stdout: expect.stringContaining(
          'success-eligible: 2, skipped: 0, error: 0'
        ),
      })
    )
  })

  it('aborts with a clear error and no result row when criteria set an unsupported score-range', async () => {
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
              name: 'positive_sentiment',
              sampleId: expect.any(String),
              sampleHash: expect.any(String),
              criteriaHash: expect.any(String),
              model,
              seed: 0,
              normalizedScore: expect.any(Number),
              reason: expect.stringMatching(/.+/),
            },
          ],
        })
      )
    },
    120_000
  )
})
