import { dirname, join } from 'node:path'
import dedent from 'dedent'
import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupEvaluate } from './evaluate.harness'

const markdown = dedent

const setup = combineHarnesses(setupEvaluate)

const helpfulCriteria = markdown`
  ---
  score-range: binary
  ---

  Score whether the answer is helpful.
`

describe('evaluate --input-jsonl', () => {
  it('treats each JSONL line as one sample under --input-jsonl', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
      criteria: helpfulCriteria,
      input: [{ answer: 'first' }, { answer: 'second' }, { answer: 'third' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'helpful' }),
    })

    expect(result.rows).toEqual([
      expect.objectContaining({ status: 'success' }),
      expect.objectContaining({ status: 'success' }),
      expect.objectContaining({ status: 'success' }),
    ])
  })

  it('treats each line from files matched by --input-jsonl glob as one sample', async () => {
    await using harness = await setup()
    const { evaluate, writeTempFile, readResultRows } = harness
    const firstInputPath = await writeTempFile({
      content: [{ answer: 'first' }, { answer: 'second' }]
        .map((sample) => `${JSON.stringify(sample)}\n`)
        .join(''),
      path: 'jsonl-glob/first.jsonl',
    })
    const secondInputPath = await writeTempFile({
      content: `${JSON.stringify({ answer: 'third' })}\n`,
      path: 'jsonl-glob/second.jsonl',
    })
    const inputDir = dirname(firstInputPath)
    const outputPath = await writeTempFile({ path: 'results.jsonl' })
    const expectedSampleIds = [firstInputPath, secondInputPath]
      .sort()
      .flatMap((path) =>
        path === firstInputPath
          ? [`${firstInputPath}#[0]`, `${firstInputPath}#[1]`]
          : [`${secondInputPath}#[0]`]
      )

    const summary = await evaluate({
      model: 'test/model',
      criteria: await writeTempFile({
        content: helpfulCriteria,
        path: 'criteria.md',
      }),
      inputJsonl: join(inputDir, '*.jsonl'),
      output: outputPath,
    })

    expect(summary).toEqual({
      counts: { success: 3, skipped: 0, error: 0 },
      cacheCounts: { hit: 0, miss: 3 },
      outcome: 'completed',
    })
    expect(await readResultRows(outputPath)).toEqual(
      expectedSampleIds.map((sampleId) => expect.objectContaining({ sampleId }))
    )
  })

  it('aborts with a clear error when JSONL input is a JSON array instead of one object per line', async () => {
    await using harness = await setup()
    const { evaluate, writeTempFile } = harness
    const criteriaPath = await writeTempFile(helpfulCriteria)
    const inputPath = await writeTempFile(
      '[{"answer": "first"}, {"answer": "second"}]\n'
    )

    await expect(
      evaluate({
        model: 'test/model',
        criteria: criteriaPath,
        inputJsonl: inputPath,
        output: await writeTempFile(),
      })
    ).rejects.toThrow(/one JSON object per line/)
  })

  it('identifies each JSONL sample row as <file>#[n]', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
      criteria: helpfulCriteria,
      input: [{ answer: 'first' }, { answer: 'second' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'helpful' }),
    })

    expect(result.rows).toEqual([
      expect.objectContaining({
        sampleId: expect.stringMatching(/\.jsonl#\[0\]$/),
      }),
      expect.objectContaining({
        sampleId: expect.stringMatching(/\.jsonl#\[1\]$/),
      }),
    ])
  })

  it('identifies a record by its supplied sampleId and falls back to <file>#[n] without one', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
      criteria: helpfulCriteria,
      input: [
        { sampleId: 'cases/login', answer: 'first' },
        { answer: 'second' },
      ],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'helpful' }),
    })

    expect(result.rows).toEqual([
      expect.objectContaining({ sampleId: 'cases/login' }),
      expect.objectContaining({
        sampleId: expect.stringMatching(/\.jsonl#\[1\]$/),
      }),
    ])
  })

  it('strips sampleId from the record before rendering the judge prompt', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness
    const prompts: string[] = []

    await runEvaluate({
      criteria: helpfulCriteria,
      input: [{ sampleId: 'cases/login', answer: 'log in first' }],
      singleShotRequest: async ({ prompt, schema }) => {
        prompts.push(prompt)
        return schema.parse({ score: 1, reason: 'helpful' })
      },
    })

    expect(prompts).toEqual([expect.stringContaining('log in first')])
    expect(prompts[0]).not.toContain('sampleId')
    expect(prompts[0]).not.toContain('cases/login')
  })

  it('reuses the cached verdict of an identical record submitted without a sampleId', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness
    let requestCount = 0
    const singleShotRequest = async <Output>(params: {
      schema: { parse: (value: unknown) => Output }
    }): Promise<Output> => {
      requestCount += 1
      return params.schema.parse({ score: 1, reason: 'helpful' })
    }

    await runEvaluate({
      model: 'test/model',
      criteria: helpfulCriteria,
      input: [{ answer: 'the same answer' }],
      singleShotRequest,
    })
    await runEvaluate({
      model: 'test/model',
      criteria: helpfulCriteria,
      input: [{ sampleId: 'cases/login', answer: 'the same answer' }],
      singleShotRequest,
    })

    expect(requestCount).toBe(1)
  })

  it('fails naming the record when a supplied sampleId is not a non-empty string', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    await expect(
      runEvaluate({
        criteria: helpfulCriteria,
        input: [{ answer: 'first' }, { sampleId: 7, answer: 'second' }],
        singleShotRequest: async ({ schema }) =>
          schema.parse({ score: 1, reason: 'helpful' }),
      })
    ).rejects.toThrow(/#\[1\].*sampleId.*non-empty string/i)
  })

  it('fails on the first duplicate supplied sampleId', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    await expect(
      runEvaluate({
        criteria: helpfulCriteria,
        input: [
          { sampleId: 'cases/login', answer: 'first' },
          { sampleId: 'cases/login', answer: 'second' },
        ],
        singleShotRequest: async ({ schema }) =>
          schema.parse({ score: 1, reason: 'helpful' }),
      })
    ).rejects.toThrow(/duplicate sampleId "cases\/login"/i)
  })

  it('fails when a supplied sampleId collides with the generated id of another record', async () => {
    await using harness = await setup()
    const { evaluate, writeTempFile } = harness
    const inputPath = await writeTempFile({ path: 'input.jsonl' })
    await writeTempFile({
      content: [
        JSON.stringify({ answer: 'falls back to path#[0]' }),
        JSON.stringify({ sampleId: `${inputPath}#[0]`, answer: 'collides' }),
      ]
        .map((line) => `${line}\n`)
        .join(''),
      path: 'input.jsonl',
    })

    await expect(
      evaluate({
        model: 'test/model',
        criteria: await writeTempFile({
          content: helpfulCriteria,
          path: 'criteria.md',
        }),
        inputJsonl: inputPath,
        output: await writeTempFile({ path: 'results.jsonl' }),
      })
    ).rejects.toThrow(/duplicate sampleId/i)
  })

  it('fails at startup when a criterion declares the reserved sampleId field', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness
    let requestCount = 0

    await expect(
      runEvaluate({
        criteria: markdown`
          ---
          score-range: binary
          fields:
            - name: sampleId
            - name: answer
          ---

          Score whether the answer is helpful.
        `,
        input: [{ sampleId: 'cases/login', answer: 'first' }],
        singleShotRequest: async ({ schema }) => {
          requestCount += 1
          return schema.parse({ score: 1, reason: 'helpful' })
        },
      })
    ).rejects.toThrow(/sampleId.*reserved/i)
    expect(requestCount).toBe(0)
  })
})
