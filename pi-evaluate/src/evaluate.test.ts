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

    expect(result.rows).toEqual([
      {
        status: 'success',
        score: expect.any(Number),
        reason: expect.stringMatching(/\S/),
      },
    ])
  })

  it('writes a success row when a JSONL sample supplies every declared field key', async () => {
    await using harness = await setup()

    const result = await harness.runEvaluate({
      model: 'test/model',
      criteria: markdown`
        ---
        name: addresses_question
        score-range: binary
        fields:
          - name: question
          - name: answer
        ---

        Score whether the answer addresses the question.
      `,
      inputJsonl: [{ question: 'Why is the sky blue?', answer: 'Rayleigh scattering.' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'The answer addresses the question.' }),
    })

    expect(result.rows).toEqual([
      {
        status: 'success',
        score: expect.any(Number),
        reason: expect.stringMatching(/\S/),
      },
    ])
  })

  it('completes with success when a declared field key is present but empty', async () => {
    await using harness = await setup()

    const result = await harness.runEvaluate({
      criteria: markdown`
        ---
        score-range: binary
        fields:
          - name: answer
        ---

        Score whether the answer is helpful.
      `,
      inputJsonl: [{ answer: '' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 0, reason: 'The answer is empty.' }),
    })

    expect(result.rows).toEqual([
      {
        status: 'success',
        score: expect.any(Number),
        reason: expect.stringMatching(/\S/),
      },
    ])
  })

  it('records an unmatchable cell as error, stops the run, and fails without --allow-skip', async () => {
    await using harness = await setup()
    let requestCount = 0

    const result = await harness.runEvaluate({
      criteria: markdown`
        ---
        score-range: binary
        fields:
          - name: question
          - name: answer
        ---

        Score whether the answer addresses the question.
      `,
      inputJsonl: [{ question: 'Why?' }, { question: 'Why?', answer: 'Because.' }],
      singleShotRequest: async ({ schema }) => {
        requestCount += 1
        return schema.parse({ score: 1, reason: 'ok' })
      },
    })

    expect(result).toEqual({
      rows: [{ status: 'error', description: expect.stringContaining('answer') }],
      summary: { counts: { success: 0, skipped: 0, error: 1 }, outcome: 'failed' },
    })
    expect(requestCount).toBe(0)
  })

  it('records an unmatchable cell as skipped, continues, and succeeds with --allow-skip', async () => {
    await using harness = await setup()

    const result = await harness.runEvaluate({
      allowSkip: true,
      criteria: markdown`
        ---
        score-range: binary
        fields:
          - name: question
          - name: answer
        ---

        Score whether the answer addresses the question.
      `,
      inputJsonl: [{ question: 'Why?' }, { question: 'Why?', answer: 'Because.' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'Addresses the question.' }),
    })

    expect(result).toEqual({
      rows: [
        { status: 'skipped', description: expect.stringContaining('answer') },
        {
          status: 'success',
          score: expect.any(Number),
          reason: expect.stringMatching(/\S/),
        },
      ],
      summary: { counts: { success: 1, skipped: 1, error: 0 }, outcome: 'completed' },
    })
  })

  it('records an error and fails when the model request fails at evaluation time', async () => {
    await using harness = await setup()

    const result = await harness.runEvaluate({
      criteria: markdown`
        ---
        score-range: binary
        ---

        Score whether the answer is helpful.
      `,
      inputJsonl: [{ answer: 'anything' }],
      singleShotRequest: async () => {
        throw new Error('model request failed')
      },
    })

    expect(result).toEqual({
      rows: [
        { status: 'error', description: expect.stringContaining('model request failed') },
      ],
      summary: { counts: { success: 0, skipped: 0, error: 1 }, outcome: 'failed' },
    })
  })

  it('stops at the nth error row and fails when --max-errors is reached', async () => {
    await using harness = await setup()

    const result = await harness.runEvaluate({
      maxErrors: 2,
      criteria: markdown`
        ---
        score-range: binary
        fields:
          - name: answer
        ---

        Score whether the answer is helpful.
      `,
      inputJsonl: [{ other: 1 }, { other: 2 }, { other: 3 }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'ok' }),
    })

    expect(result).toEqual({
      rows: [
        { status: 'error', description: expect.stringMatching(/\S/) },
        { status: 'error', description: expect.stringMatching(/\S/) },
      ],
      summary: { counts: { success: 0, skipped: 0, error: 2 }, outcome: 'failed' },
    })
  })

  it('runs to completion and succeeds with fewer than --max-errors error rows', async () => {
    await using harness = await setup()

    const result = await harness.runEvaluate({
      maxErrors: 2,
      criteria: markdown`
        ---
        score-range: binary
        fields:
          - name: answer
        ---

        Score whether the answer is helpful.
      `,
      inputJsonl: [{ other: 1 }, { answer: 'present' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'helpful' }),
    })

    expect(result).toEqual({
      rows: [
        { status: 'error', description: expect.stringMatching(/\S/) },
        {
          status: 'success',
          score: expect.any(Number),
          reason: expect.stringMatching(/\S/),
        },
      ],
      summary: { counts: { success: 1, skipped: 0, error: 1 }, outcome: 'completed' },
    })
  })

  it('classifies the matrix and reports counts without writing rows or spending tokens under --dry-run', async () => {
    await using harness = await setup()
    let requestCount = 0

    const result = await harness.runEvaluate({
      dryRun: true,
      criteria: markdown`
        ---
        score-range: binary
        fields:
          - name: answer
        ---

        Score whether the answer is helpful.
      `,
      inputJsonl: [{ other: 1 }, { answer: 'present' }],
      singleShotRequest: async ({ schema }) => {
        requestCount += 1
        return schema.parse({ score: 1, reason: 'ok' })
      },
    })

    expect(result).toEqual({
      rows: [],
      summary: { counts: { success: 1, skipped: 0, error: 1 }, outcome: 'completed' },
    })
    expect(requestCount).toBe(0)
  })

  it('aborts mid-run: stops further cells, drops the interrupted cell, keeps flushed rows, and fails', async () => {
    await using harness = await setup()
    const controller = new AbortController()
    let requestCount = 0

    const result = await harness.runEvaluate({
      signal: controller.signal,
      criteria: markdown`
        ---
        score-range: binary
        ---

        Score whether the answer is helpful.
      `,
      inputJsonl: [{ answer: 'first' }, { answer: 'second' }, { answer: 'third' }],
      singleShotRequest: async ({ schema }) => {
        requestCount += 1
        if (requestCount === 1) {
          return schema.parse({ score: 1, reason: 'first verdict' })
        }
        controller.abort()
        throw new Error('Model request failed (aborted)')
      },
    })

    expect(result).toEqual({
      rows: [
        {
          status: 'success',
          score: expect.any(Number),
          reason: expect.stringMatching(/\S/),
        },
      ],
      summary: { counts: { success: 1, skipped: 0, error: 0 }, outcome: 'aborted' },
    })
    expect(requestCount).toBe(2)
  })

  it('treats each JSONL line as one sample under --input-jsonl', async () => {
    await using harness = await setup()

    const result = await harness.runEvaluate({
      criteria: markdown`
        ---
        score-range: binary
        ---

        Score whether the answer is helpful.
      `,
      inputJsonl: [{ answer: 'first' }, { answer: 'second' }, { answer: 'third' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'helpful' }),
    })

    expect(result.rows).toEqual([
      { status: 'success', score: expect.any(Number), reason: expect.stringMatching(/\S/) },
      { status: 'success', score: expect.any(Number), reason: expect.stringMatching(/\S/) },
      { status: 'success', score: expect.any(Number), reason: expect.stringMatching(/\S/) },
    ])
  })

  it('treats the whole file as one sample under --input-text', async () => {
    await using harness = await setup()
    let requestCount = 0

    const result = await harness.runEvaluate({
      criteria: markdown`
        ---
        score-range: binary
        ---

        Score whether the text expresses a positive sentiment.
      `,
      inputText: 'line one\nline two\nline three',
      singleShotRequest: async ({ schema }) => {
        requestCount += 1
        return schema.parse({ score: 1, reason: 'positive' })
      },
    })

    expect(result.rows).toEqual([
      { status: 'success', score: expect.any(Number), reason: expect.stringMatching(/\S/) },
    ])
    expect(requestCount).toBe(1)
  })

  it('aborts with a clear error when JSONL input is a JSON array instead of one object per line', async () => {
    await using harness = await setup()

    await expect(
      harness.runEvaluate({
        criteria: markdown`
          ---
          score-range: binary
          ---

          Score whether the answer is helpful.
        `,
        inputJsonl: '[{"answer": "first"}, {"answer": "second"}]\n',
        singleShotRequest: async ({ schema }) =>
          schema.parse({ score: 1, reason: 'helpful' }),
      })
    ).rejects.toThrow(/one JSON object per line/)
  })

  it('records a text sample paired with a field criterion as error and fails by default', async () => {
    await using harness = await setup()
    let requestCount = 0

    const result = await harness.runEvaluate({
      criteria: markdown`
        ---
        score-range: binary
        fields:
          - name: answer
        ---

        Score whether the answer is helpful.
      `,
      inputText: 'just a blob of text',
      singleShotRequest: async ({ schema }) => {
        requestCount += 1
        return schema.parse({ score: 1, reason: 'ok' })
      },
    })

    expect(result).toEqual({
      rows: [{ status: 'error', description: expect.stringContaining('answer') }],
      summary: { counts: { success: 0, skipped: 0, error: 1 }, outcome: 'failed' },
    })
    expect(requestCount).toBe(0)
  })

  it('records a text sample paired with a field criterion as skipped and succeeds with --allow-skip', async () => {
    await using harness = await setup()
    let requestCount = 0

    const result = await harness.runEvaluate({
      allowSkip: true,
      criteria: markdown`
        ---
        score-range: binary
        fields:
          - name: answer
        ---

        Score whether the answer is helpful.
      `,
      inputText: 'just a blob of text',
      singleShotRequest: async ({ schema }) => {
        requestCount += 1
        return schema.parse({ score: 1, reason: 'ok' })
      },
    })

    expect(result).toEqual({
      rows: [{ status: 'skipped', description: expect.stringContaining('answer') }],
      summary: { counts: { success: 0, skipped: 1, error: 0 }, outcome: 'completed' },
    })
    expect(requestCount).toBe(0)
  })

  it('forwards the abort signal to the model request', async () => {
    await using harness = await setup()
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined

    await harness.runEvaluate({
      signal: controller.signal,
      criteria: markdown`
        ---
        score-range: binary
        ---

        Score whether the answer is helpful.
      `,
      inputJsonl: [{ answer: 'first' }],
      singleShotRequest: async ({ schema, signal }) => {
        receivedSignal = signal
        return schema.parse({ score: 1, reason: 'ok' })
      },
    })

    expect(receivedSignal).toBe(controller.signal)
  })
})
