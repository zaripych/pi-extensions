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

  Score whether the text is helpful.
`

describe('evaluate --input-text-nul', () => {
  it('treats each NUL-separated segment as one text sample identified by the id from the stream', async () => {
    await using harness = await setup()
    const { evaluate, writeTempFile, readResultRows } = harness
    const inputPath = await writeTempFile({
      content: [
        dedent`
          db/AGENTS.md
          # What

          The database layer module.
        `,
        dedent`
          dal/AGENTS.md
          # What

          The data access layer.
        `,
      ].join('\0'),
      path: 'samples.nul',
    })
    const outputPath = await writeTempFile({ path: 'results.jsonl' })

    const summary = await evaluate({
      model: 'test/model',
      criteria: await writeTempFile({
        content: helpfulCriteria,
        path: 'criteria.md',
      }),
      inputTextNul: inputPath,
      output: outputPath,
    })

    expect(summary).toEqual({
      counts: { success: 2, skipped: 0, error: 0 },
      cacheCounts: { hit: 0, miss: 2 },
      outcome: 'completed',
    })
    expect(await readResultRows(outputPath)).toEqual([
      expect.objectContaining({ sampleId: 'db/AGENTS.md' }),
      expect.objectContaining({ sampleId: 'dal/AGENTS.md' }),
    ])
  })

  it('trims whitespace around the id line and inlines the sample text verbatim into the judge prompt', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness
    const prompts: string[] = []

    const result = await runEvaluate({
      criteria: helpfulCriteria,
      inputTextNul: '  notes/plan.md  \n  indented line\n\ntrailing line\n',
      singleShotRequest: async ({ prompt, schema }) => {
        prompts.push(prompt)
        return schema.parse({ score: 1, reason: 'helpful' })
      },
    })

    expect(result.rows).toEqual([
      expect.objectContaining({ sampleId: 'notes/plan.md' }),
    ])
    expect(prompts).toEqual([
      expect.stringContaining(
        '<input>\n  indented line\n\ntrailing line\n\n</input>'
      ),
    ])
  })

  it('allows a trailing NUL separator without producing an extra sample', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
      criteria: helpfulCriteria,
      inputTextNul: `${[
        dedent`
          first.md
          first text
        `,
        dedent`
          second.md
          second text
        `,
      ].join('\0')}\0`,
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'helpful' }),
    })

    expect(result).toEqual({
      rows: [
        expect.objectContaining({ sampleId: 'first.md' }),
        expect.objectContaining({ sampleId: 'second.md' }),
      ],
      summary: {
        counts: { success: 2, skipped: 0, error: 0 },
        cacheCounts: { hit: 0, miss: 2 },
        outcome: 'completed',
      },
    })
  })

  it('identifies a sample with an empty id slot as <file>#[n]', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    const result = await runEvaluate({
      criteria: helpfulCriteria,
      inputTextNul: [
        dedent`
          first.md
          first text
        `,
        '\nanonymous text',
        '  \nwhitespace id text',
      ].join('\0'),
      singleShotRequest: async ({ schema }) =>
        schema.parse({ score: 1, reason: 'helpful' }),
    })

    expect(result.rows).toEqual([
      expect.objectContaining({ sampleId: 'first.md' }),
      expect.objectContaining({
        sampleId: expect.stringMatching(/\.nul#\[1\]$/),
      }),
      expect.objectContaining({
        sampleId: expect.stringMatching(/\.nul#\[2\]$/),
      }),
    ])
  })

  it('fails naming the sample position when a segment has no newline after the id line', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    await expect(
      runEvaluate({
        criteria: helpfulCriteria,
        inputTextNul: [
          dedent`
            first.md
            first text
          `,
          'id-line-without-text',
        ].join('\0'),
        singleShotRequest: async ({ schema }) =>
          schema.parse({ score: 1, reason: 'helpful' }),
      })
    ).rejects.toThrow(/sample 2 .*no newline/i)
  })

  it('fails naming the sample position when a segment between separators is empty', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    await expect(
      runEvaluate({
        criteria: helpfulCriteria,
        inputTextNul: [
          dedent`
            first.md
            first text
          `,
          '',
          dedent`
            third.md
            third text
          `,
        ].join('\0'),
        singleShotRequest: async ({ schema }) =>
          schema.parse({ score: 1, reason: 'helpful' }),
      })
    ).rejects.toThrow(/sample 2 .* is empty/i)
  })

  it('fails on the first duplicate supplied id in the stream', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness

    await expect(
      runEvaluate({
        criteria: helpfulCriteria,
        inputTextNul: [
          dedent`
            notes.md
            first text
          `,
          dedent`
            notes.md
            second text
          `,
        ].join('\0'),
        singleShotRequest: async ({ schema }) =>
          schema.parse({ score: 1, reason: 'helpful' }),
      })
    ).rejects.toThrow(/duplicate sampleId "notes\.md"/i)
  })

  it('reads every file matched by --input-text-nul glob patterns', async () => {
    await using harness = await setup()
    const { evaluate, writeTempFile, readResultRows } = harness
    const firstPath = await writeTempFile({
      content: dedent`
        a.md
        first text
      `,
      path: 'nul-glob/first.nul',
    })
    await writeTempFile({
      content: dedent`
        b.md
        second text
      `,
      path: 'nul-glob/second.nul',
    })
    const outputPath = await writeTempFile({ path: 'results.jsonl' })

    const summary = await evaluate({
      model: 'test/model',
      criteria: await writeTempFile({
        content: helpfulCriteria,
        path: 'criteria.md',
      }),
      inputTextNul: join(dirname(firstPath), '*.nul'),
      output: outputPath,
    })

    expect(summary).toEqual({
      counts: { success: 2, skipped: 0, error: 0 },
      cacheCounts: { hit: 0, miss: 2 },
      outcome: 'completed',
    })
    expect(await readResultRows(outputPath)).toEqual([
      expect.objectContaining({ sampleId: 'a.md' }),
      expect.objectContaining({ sampleId: 'b.md' }),
    ])
  })

  it('fails on a supplied id duplicated across two --input-text-nul files', async () => {
    await using harness = await setup()
    const { evaluate, writeTempFile } = harness
    const firstPath = await writeTempFile({
      content: dedent`
        shared.md
        first text
      `,
      path: 'nul-dup/first.nul',
    })
    await writeTempFile({
      content: dedent`
        shared.md
        second text
      `,
      path: 'nul-dup/second.nul',
    })

    await expect(
      evaluate({
        model: 'test/model',
        criteria: await writeTempFile({
          content: helpfulCriteria,
          path: 'criteria.md',
        }),
        inputTextNul: join(dirname(firstPath), '*.nul'),
        output: await writeTempFile({ path: 'results.jsonl' }),
      })
    ).rejects.toThrow(/duplicate sampleId "shared\.md"/i)
  })

  it('fails when a supplied id collides with the generated id of another sample', async () => {
    await using harness = await setup()
    const { evaluate, writeTempFile } = harness
    const inputPath = await writeTempFile({ path: 'samples.nul' })
    await writeTempFile({
      content: [
        '\nfalls back to path#[0]',
        dedent`
          ${inputPath}#[0]
          collides
        `,
      ].join('\0'),
      path: 'samples.nul',
    })

    await expect(
      evaluate({
        model: 'test/model',
        criteria: await writeTempFile({
          content: helpfulCriteria,
          path: 'criteria.md',
        }),
        inputTextNul: inputPath,
        output: await writeTempFile({ path: 'results.jsonl' }),
      })
    ).rejects.toThrow(/duplicate sampleId/i)
  })

  it('fails when --input-text-nul is combined with another input flag', async () => {
    await using harness = await setup()
    const { evaluate, writeTempFile } = harness
    const criteriaPath = await writeTempFile({
      content: helpfulCriteria,
      path: 'criteria.md',
    })
    const nulPath = await writeTempFile({
      content: dedent`
        a.md
        text
      `,
      path: 'samples.nul',
    })

    await expect(
      evaluate({
        model: 'test/model',
        criteria: criteriaPath,
        inputTextNul: nulPath,
        inputText: await writeTempFile({ content: 'text', path: 'sample.md' }),
        output: await writeTempFile({ path: 'results.jsonl' }),
      })
    ).rejects.toThrow(/only one of/i)
    await expect(
      evaluate({
        model: 'test/model',
        criteria: criteriaPath,
        inputTextNul: nulPath,
        inputJsonl: await writeTempFile({
          content: `${JSON.stringify({ answer: 'x' })}\n`,
          path: 'input.jsonl',
        }),
        output: await writeTempFile({ path: 'results.jsonl' }),
      })
    ).rejects.toThrow(/only one of/i)
  })

  it('reuses the cached verdict of an identical sample evaluated via --input-text', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness
    let requestCount = 0
    const singleShotRequest = async <Output>(params: {
      schema: { parse: (value: unknown) => Output }
    }): Promise<Output> => {
      requestCount += 1
      return params.schema.parse({ score: 1, reason: 'helpful' })
    }
    const text = 'the same sample text'

    await runEvaluate({
      model: 'test/model',
      criteria: helpfulCriteria,
      input: text,
      singleShotRequest,
    })
    await runEvaluate({
      model: 'test/model',
      criteria: helpfulCriteria,
      inputTextNul: dedent`
        streamed-id.md
        ${text}
      `,
      singleShotRequest,
    })

    expect(requestCount).toBe(1)
  })

  it('classifies the streamed matrix and reports counts without spending tokens under --dry-run', async () => {
    await using harness = await setup()
    const { runEvaluate } = harness
    let requestCount = 0

    const result = await runEvaluate({
      dryRun: true,
      criteria: helpfulCriteria,
      inputTextNul: [
        dedent`
          first.md
          first text
        `,
        dedent`
          second.md
          second text
        `,
      ].join('\0'),
      singleShotRequest: async ({ schema }) => {
        requestCount += 1
        return schema.parse({ score: 1, reason: 'helpful' })
      },
    })

    expect(result).toEqual({
      rows: [],
      summary: {
        counts: { success: 2, skipped: 0, error: 0 },
        cacheCounts: { hit: 0, miss: 2 },
        outcome: 'completed',
      },
    })
    expect(requestCount).toBe(0)
  })
})
