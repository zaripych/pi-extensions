import { dirname, join } from 'node:path'
import dedent from 'dedent'
import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupEvaluate } from './evaluate.harness'
import type { SingleShotRequest } from './singleShotRequest'

const markdown = dedent

const setup = combineHarnesses(setupEvaluate)

/**
 * This test is focusing on observable behaviors that reach into the evaluation
 * function successfully but without actually making expensive calls to LLM providers,
 * to test arguments parsing or actually hit LLM's have a look at pi-evaluate/src/e2e/e2e.harness.ts
 */

describe('evaluate', () => {
  it('writes one consumable result row for one JSONL sample and one fieldless criteria', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
      model: 'test/model',
      criteria: markdown`
        ---
        name: helpfulness
        score-range: binary
        ---

        Score whether the answer is helpful.
      `,
      input: [{ answer: 'Use the harness, not the real model.' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'The answer is helpful.' }),
    })

    expect(result.rows).toEqual([
      expect.objectContaining({
        status: 'success',
        normalizedScore: expect.any(Number),
        reason: expect.stringMatching(/\S/),
      }),
    ])
  })

  it('overwrites the output file instead of appending to it', async () => {
    await using harness = await setup()
    const { evaluate, readResultRows, writeTempFile } = harness
    const criteriaPath = await writeTempFile({
      content: markdown`
        ---
        score-range: binary
        ---

        Score whether the answer is helpful.
      `,
      suffix: '-criteria.md',
    })
    const inputPath = await writeTempFile({
      content: `${JSON.stringify({ answer: 'present' })}\n`,
      suffix: '-input.jsonl',
    })
    const outputPath = await writeTempFile({
      content: `${JSON.stringify({ status: 'stale' })}\n`,
      suffix: '-results.jsonl',
    })

    await evaluate({
      model: 'test/model',
      criteria: criteriaPath,
      inputJsonl: inputPath,
      output: outputPath,
    })

    expect(await readResultRows(outputPath)).toEqual([
      expect.objectContaining({ status: 'success' }),
    ])
  })

  it('writes a success row when a JSONL sample supplies every declared field key', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
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
      input: [{ question: 'Why is the sky blue?', answer: 'Rayleigh scattering.' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'The answer addresses the question.' }),
    })

    expect(result.rows).toEqual([
      expect.objectContaining({ status: 'success' }),
    ])
  })

  it('completes with success when a declared field key is present but empty', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
      criteria: markdown`
        ---
        score-range: binary
        fields:
          - name: answer
        ---

        Score whether the answer is helpful.
      `,
      input: [{ answer: '' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 0, reason: 'The answer is empty.' }),
    })

    expect(result.rows).toEqual([
      expect.objectContaining({ status: 'success' }),
    ])
  })

  it('records an unmatchable cell as error, stops the run, and fails without --allow-skip', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness
    let requestCount = 0

    const result = await runEvaluate({
      criteria: markdown`
        ---
        score-range: binary
        fields:
          - name: question
          - name: answer
        ---

        Score whether the answer addresses the question.
      `,
      input: [{ question: 'Why?' }, { question: 'Why?', answer: 'Because.' }],
      singleShotRequest: async ({ schema }) => {
        requestCount += 1
        return schema.parse({ score: 1, reason: 'ok' })
      },
    })

    expect(result).toEqual({
      rows: [
        expect.objectContaining({
          status: 'error',
          description: expect.stringContaining('answer'),
        }),
      ],
      summary: { counts: { success: 0, skipped: 0, error: 1 }, outcome: 'failed' },
    })
    expect(requestCount).toBe(0)
  })

  it('records an unmatchable cell as skipped, continues, and succeeds with --allow-skip', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
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
      input: [{ question: 'Why?' }, { question: 'Why?', answer: 'Because.' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'Addresses the question.' }),
    })

    expect(result).toEqual({
      rows: [
        expect.objectContaining({
          status: 'skipped',
          description: expect.stringContaining('answer'),
        }),
        expect.objectContaining({ status: 'success' }),
      ],
      summary: { counts: { success: 1, skipped: 1, error: 0 }, outcome: 'completed' },
    })
  })

  it('records an error and fails when the model request fails at evaluation time', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
      criteria: markdown`
        ---
        score-range: binary
        ---

        Score whether the answer is helpful.
      `,
      input: [{ answer: 'anything' }],
      singleShotRequest: async () => {
        throw new Error('model request failed')
      },
    })

    expect(result).toEqual({
      rows: [
        expect.objectContaining({
          status: 'error',
          description: expect.stringContaining('model request failed'),
        }),
      ],
      summary: { counts: { success: 0, skipped: 0, error: 1 }, outcome: 'failed' },
    })
  })

  it('stops at the nth error row and fails when --max-errors is reached', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
      maxErrors: 2,
      criteria: markdown`
        ---
        score-range: binary
        fields:
          - name: answer
        ---

        Score whether the answer is helpful.
      `,
      input: [{ other: 1 }, { other: 2 }, { other: 3 }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'ok' }),
    })

    expect(result).toEqual({
      rows: [
        expect.objectContaining({ status: 'error' }),
        expect.objectContaining({ status: 'error' }),
      ],
      summary: { counts: { success: 0, skipped: 0, error: 2 }, outcome: 'failed' },
    })
  })

  it('runs to completion and succeeds with fewer than --max-errors error rows', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
      maxErrors: 2,
      criteria: markdown`
        ---
        score-range: binary
        fields:
          - name: answer
        ---

        Score whether the answer is helpful.
      `,
      input: [{ other: 1 }, { answer: 'present' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'helpful' }),
    })

    expect(result).toEqual({
      rows: [
        expect.objectContaining({ status: 'error' }),
        expect.objectContaining({ status: 'success' }),
      ],
      summary: { counts: { success: 1, skipped: 0, error: 1 }, outcome: 'completed' },
    })
  })

  it('classifies the matrix and reports counts without writing rows or spending tokens under --dry-run', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness
    let requestCount = 0

    const result = await runEvaluate({
      dryRun: true,
      criteria: markdown`
        ---
        score-range: binary
        fields:
          - name: answer
        ---

        Score whether the answer is helpful.
      `,
      input: [{ other: 1 }, { answer: 'present' }],
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
    const { runEvaluate } = harness
    const controller = new AbortController()
    let requestCount = 0

    const result = await runEvaluate({
      signal: controller.signal,
      criteria: markdown`
        ---
        score-range: binary
        ---

        Score whether the answer is helpful.
      `,
      input: [{ answer: 'first' }, { answer: 'second' }, { answer: 'third' }],
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
      rows: [expect.objectContaining({ status: 'success' })],
      summary: { counts: { success: 1, skipped: 0, error: 0 }, outcome: 'aborted' },
    })
    expect(requestCount).toBe(2)
  })

  it('treats each JSONL line as one sample under --input-jsonl', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
      criteria: markdown`
        ---
        score-range: binary
        ---

        Score whether the answer is helpful.
      `,
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
      suffix: '-input.jsonl',
    })
    const secondInputPath = await writeTempFile({
      content: `${JSON.stringify({ answer: 'third' })}\n`,
      suffix: '-input.jsonl',
    })
    const inputDir = dirname(firstInputPath)
    const outputPath = await writeTempFile({ suffix: '-results.jsonl' })
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
        content: markdown`
          ---
          score-range: binary
          ---

          Score whether the answer is helpful.
        `,
        suffix: '-criteria.md',
      }),
      inputJsonl: join(inputDir, '*-input.jsonl'),
      output: outputPath,
    })

    expect(summary).toEqual({
      counts: { success: 3, skipped: 0, error: 0 },
      outcome: 'completed',
    })
    expect(await readResultRows(outputPath)).toEqual(
      expectedSampleIds.map((sampleId) => expect.objectContaining({ sampleId }))
    )
  })

  it('treats the whole file as one sample under --input-text', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness
    let requestCount = 0

    const result = await runEvaluate({
      criteria: markdown`
        ---
        score-range: binary
        ---

        Score whether the text expresses a positive sentiment.
      `,
      input: 'line one\nline two\nline three',
      singleShotRequest: async ({ schema }) => {
        requestCount += 1
        return schema.parse({ score: 1, reason: 'positive' })
      },
    })

    expect(result.rows).toEqual([
      expect.objectContaining({ status: 'success' }),
    ])
    expect(requestCount).toBe(1)
  })

  it('treats each file matched by --input-text glob as one text sample', async () => {
    await using harness = await setup()
    const { evaluate, writeTempFile } = harness
    const firstInputPath = await writeTempFile({
      content: 'first text',
      suffix: '-input.md',
    })
    await writeTempFile({ content: 'second text', suffix: '-input.md' })
    const inputDir = dirname(firstInputPath)
    const outputPath = await writeTempFile({ suffix: '-results.jsonl' })

    const summary = await evaluate({
      model: 'test/model',
      criteria: await writeTempFile({
        content: markdown`
          ---
          score-range: binary
          ---

          Score whether the text expresses a positive sentiment.
        `,
        suffix: '-criteria.md',
      }),
      inputText: join(inputDir, '*-input.md'),
      output: outputPath,
    })

    expect(summary).toEqual({
      counts: { success: 2, skipped: 0, error: 0 },
      outcome: 'completed',
    })
  })

  it('aborts with a clear error when JSONL input is a JSON array instead of one object per line', async () => {
    await using harness = await setup()
    const { evaluate, writeTempFile } = harness
    const criteriaPath = await writeTempFile(markdown`
      ---
      score-range: binary
      ---

      Score whether the answer is helpful.
    `)
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

  it('records a text sample paired with a field criteria as error and fails by default', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness
    let requestCount = 0

    const result = await runEvaluate({
      criteria: markdown`
        ---
        score-range: binary
        fields:
          - name: answer
        ---

        Score whether the answer is helpful.
      `,
      input: 'just a blob of text',
      singleShotRequest: async ({ schema }) => {
        requestCount += 1
        return schema.parse({ score: 1, reason: 'ok' })
      },
    })

    expect(result).toEqual({
      rows: [
        expect.objectContaining({
          status: 'error',
          description: expect.stringContaining('answer'),
        }),
      ],
      summary: { counts: { success: 0, skipped: 0, error: 1 }, outcome: 'failed' },
    })
    expect(requestCount).toBe(0)
  })

  it('records a text sample paired with a field criteria as skipped and succeeds with --allow-skip', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness
    let requestCount = 0

    const result = await runEvaluate({
      allowSkip: true,
      criteria: markdown`
        ---
        score-range: binary
        fields:
          - name: answer
        ---

        Score whether the answer is helpful.
      `,
      input: 'just a blob of text',
      singleShotRequest: async ({ schema }) => {
        requestCount += 1
        return schema.parse({ score: 1, reason: 'ok' })
      },
    })

    expect(result).toEqual({
      rows: [
        expect.objectContaining({
          status: 'skipped',
          description: expect.stringContaining('answer'),
        }),
      ],
      summary: { counts: { success: 0, skipped: 1, error: 0 }, outcome: 'completed' },
    })
    expect(requestCount).toBe(0)
  })

  it('forwards the abort signal to the model request', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined

    await runEvaluate({
      signal: controller.signal,
      criteria: markdown`
        ---
        score-range: binary
        ---

        Score whether the answer is helpful.
      `,
      input: [{ answer: 'first' }],
      singleShotRequest: async ({ schema, signal }) => {
        receivedSignal = signal
        return schema.parse({ score: 1, reason: 'ok' })
      },
    })

    expect(receivedSignal).toBe(controller.signal)
  })

  it('runs every matched criteria against every sample as an N×M matrix', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
      allowSkip: true,
      criteria: [
        markdown`
          ---
          score-range: binary
          ---

          Score whether the answer is helpful.
        `,
        markdown`
          ---
          score-range: binary
          fields:
            - name: missing_field
          ---

          Score whether the missing field is helpful.
        `,
      ],
      input: [{ answer: 'first' }, { answer: 'second' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'helpful' }),
    })

    expect(result.rows).toEqual([
      expect.objectContaining({ status: 'success' }),
      expect.objectContaining({
        status: 'skipped',
        description: expect.stringContaining('missing_field'),
      }),
      expect.objectContaining({ status: 'success' }),
      expect.objectContaining({
        status: 'skipped',
        description: expect.stringContaining('missing_field'),
      }),
    ])
    expect(result.summary).toEqual({
      counts: { success: 2, skipped: 2, error: 0 },
      outcome: 'completed',
    })
  })

  it('fails with a clear error when --criteria matches no files', async () => {
    await using harness = await setup()
    const { evaluate } = harness

    await expect(
      evaluate({
        model: 'test/model',
        criteria: 'no-such-criteria-glob-*.md',
        inputJsonl: 'no-such-input.jsonl',
        output: 'unused-output.jsonl',
      })
    ).rejects.toThrow(/No criteria files matched/)
  })

  it('identifies each JSONL sample row as <file>#[n]', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
      criteria: markdown`
        ---
        score-range: binary
        ---

        Score whether the answer is helpful.
      `,
      input: [{ answer: 'first' }, { answer: 'second' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'helpful' }),
    })

    expect(result.rows).toEqual([
      expect.objectContaining({ sampleId: expect.stringMatching(/\.jsonl#\[0\]$/) }),
      expect.objectContaining({ sampleId: expect.stringMatching(/\.jsonl#\[1\]$/) }),
    ])
  })

  it('identifies a text sample row by its file path', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
      criteria: markdown`
        ---
        score-range: binary
        ---

        Score whether the text is positive.
      `,
      input: 'a blob of text',
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'positive' }),
    })

    expect(result.rows).toEqual([
      expect.objectContaining({ sampleId: expect.stringMatching(/\.txt$/) }),
    ])
  })

  it('carries the full row contract for success, skipped, and error rows', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness
    let requestCount = 0

    const result = await runEvaluate({
      model: 'test/model',
      allowSkip: true,
      maxErrors: 2,
      criteria: markdown`
        ---
        name: helpfulness
        score-range: binary
        fields:
          - name: answer
        ---

        Score whether the answer is helpful.
      `,
      input: [{ answer: 'present' }, { other: 'missing' }, { answer: 'boom' }],
      singleShotRequest: async ({ schema }) => {
        requestCount += 1
        if (requestCount === 1) {
          return schema.parse({ score: 1, reason: 'helpful' })
        }
        throw new Error('model request failed')
      },
    })

    expect(result.rows).toEqual([
      {
        status: 'success',
        name: 'helpfulness',
        sampleId: expect.any(String),
        sampleHash: expect.any(String),
        criteriaHash: expect.any(String),
        model: 'test/model',
        seed: 0,
        normalizedScore: 1,
        reason: 'helpful',
      },
      {
        status: 'skipped',
        name: 'helpfulness',
        sampleId: expect.any(String),
        sampleHash: expect.any(String),
        criteriaHash: expect.any(String),
        model: 'test/model',
        seed: 0,
        description: expect.stringContaining('answer'),
      },
      {
        status: 'error',
        name: 'helpfulness',
        sampleId: expect.any(String),
        sampleHash: expect.any(String),
        criteriaHash: expect.any(String),
        model: 'test/model',
        seed: 0,
        description: expect.stringContaining('model request failed'),
      },
    ])
  })

  it('uses the criterion file name as name when no name is declared', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
      criteria: markdown`
        ---
        score-range: binary
        ---

        Score whether the answer is helpful.
      `,
      input: [{ answer: 'present' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'helpful' }),
    })

    expect(result.rows).toEqual([
      expect.objectContaining({ name: expect.stringMatching(/^criteria-[^.]+$/) }),
    ])
  })

  it('uses the declared name when the criterion declares one', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
      criteria: markdown`
        ---
        name: faithfulness
        score-range: binary
        ---

        Score whether the answer is faithful.
      `,
      input: [{ answer: 'present' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'faithful' }),
    })

    expect(result.rows).toEqual([
      expect.objectContaining({ name: 'faithfulness' }),
    ])
  })

  it('normalizes a binary score to normalizedScore 0 or 1', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
      criteria: markdown`
        ---
        score-range: binary
        ---

        Score whether the answer is helpful.
      `,
      input: [{ answer: 'first' }, { answer: 'second' }],
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 0, reason: 'not helpful' }),
    })

    expect(result.rows).toEqual([
      expect.objectContaining({ normalizedScore: 0 }),
      expect.objectContaining({ normalizedScore: 0 }),
    ])
  })

  it('normalizes a triple score to normalizedScore 0, 0.5, or 1', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness
    let requestCount = 0

    const result = await runEvaluate({
      criteria: markdown`
        ---
        score-range: triple
        ---

        Score whether the answer is helpful.
      `,
      input: [{ answer: 'one' }, { answer: 'two' }, { answer: 'three' }],
      singleShotRequest: async ({ schema }) => {
        requestCount += 1
        return schema.parse({ score: requestCount - 1, reason: 'graded' })
      },
    })

    expect(result.rows).toEqual([
      expect.objectContaining({ normalizedScore: 0 }),
      expect.objectContaining({ normalizedScore: 0.5 }),
      expect.objectContaining({ normalizedScore: 1 }),
    ])
  })

  it('caches only success cells, leaving skipped and error cells uncached', async () => {
    await using harness = await setup()
    const { runEvaluate, readCacheEntries } = harness
    let requestCount = 0

    await runEvaluate({
      allowSkip: true,
      maxErrors: 5,
      criteria: markdown`
        ---
        score-range: binary
        fields:
          - name: answer
        ---

        Score whether the answer is helpful.
      `,
      input: [{ answer: 'present' }, { other: 'missing' }, { answer: 'boom' }],
      singleShotRequest: async ({ schema }) => {
        requestCount += 1
        if (requestCount === 1) {
          return schema.parse({ score: 1, reason: 'helpful' })
        }
        throw new Error('model request failed')
      },
    })

    expect(await readCacheEntries()).toHaveLength(1)
  })

  it('repeats the cached score and reason without spending a token on identical reruns', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness
    let requestCount = 0
    const singleShotRequest: SingleShotRequest = async ({ schema }) => {
      requestCount += 1
      return schema.parse({ score: 1, reason: 'cached reason' })
    }
    const run = {
      model: 'test/model',
      criteria: markdown`
        ---
        score-range: binary
        ---

        Score whether the answer is helpful.
      `,
      input: [{ answer: 'the same answer' }],
      singleShotRequest,
    }

    const first = await runEvaluate(run)
    const second = await runEvaluate(run)

    expect(requestCount).toBe(1)
    expect(first.rows).toEqual([
      expect.objectContaining({ normalizedScore: 1, reason: 'cached reason' }),
    ])
    expect(second.rows).toEqual([
      expect.objectContaining({ normalizedScore: 1, reason: 'cached reason' }),
    ])
  })

  it('uses a distinct cache result when the sample content changes', async () => {
    await using harness = await setup()
    const { runEvaluate, readCacheEntries } = harness
    let requestCount = 0
    const singleShotRequest: SingleShotRequest = async ({ schema }) => {
      requestCount += 1
      return schema.parse({ score: 1, reason: `verdict ${requestCount}` })
    }
    const criteria = markdown`
      ---
      score-range: binary
      ---

      Score whether the answer is helpful.
    `

    const first = await runEvaluate({
      model: 'test/model',
      criteria,
      input: [{ answer: 'first answer' }],
      singleShotRequest,
    })
    const second = await runEvaluate({
      model: 'test/model',
      criteria,
      input: [{ answer: 'second answer' }],
      singleShotRequest,
    })

    expect(requestCount).toBe(2)
    expect(first.rows).toEqual([
      expect.objectContaining({ reason: 'verdict 1' }),
    ])
    expect(second.rows).toEqual([
      expect.objectContaining({ reason: 'verdict 2' }),
    ])
    expect(await readCacheEntries()).toHaveLength(2)
  })

  it('recomputes via the model when a cached entry no longer satisfies the schema', async () => {
    await using harness = await setup()
    const { runEvaluate, overwriteCacheEntries } = harness
    let requestCount = 0
    const singleShotRequest: SingleShotRequest = async ({ schema }) => {
      requestCount += 1
      return schema.parse({ score: 1, reason: `verdict ${requestCount}` })
    }
    const run = {
      model: 'test/model',
      criteria: markdown`
        ---
        score-range: binary
        ---

        Score whether the answer is helpful.
      `,
      input: [{ answer: 'the same answer' }],
      singleShotRequest,
    }

    await runEvaluate(run)
    await overwriteCacheEntries('{"bogus": "shape"}')
    const recovered = await runEvaluate(run)

    expect(requestCount).toBe(2)
    expect(recovered.rows).toEqual([
      expect.objectContaining({ status: 'success', normalizedScore: 1, reason: 'verdict 2' }),
    ])
  })

  it('produces the same row shape for cache hits and misses in one run', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness
    const singleShotRequest: SingleShotRequest = async ({ schema }) =>
      schema.parse({ score: 1, reason: 'helpful' })
    const criteria = markdown`
      ---
      score-range: binary
      ---

      Score whether the answer is helpful.
    `

    await runEvaluate({
      model: 'test/model',
      criteria,
      input: [{ answer: 'warm cache' }],
      singleShotRequest,
    })
    const result = await runEvaluate({
      model: 'test/model',
      criteria,
      input: [{ answer: 'warm cache' }, { answer: 'fresh sample' }],
      singleShotRequest,
    })

    expect(result.rows).toEqual([
      expect.objectContaining({ status: 'success', normalizedScore: 1, reason: 'helpful' }),
      expect.objectContaining({ status: 'success', normalizedScore: 1, reason: 'helpful' }),
    ])
  })
})
