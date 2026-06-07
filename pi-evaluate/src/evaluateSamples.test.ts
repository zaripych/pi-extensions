import { describe, expect, it } from 'vitest'
import { evaluateSamples } from './evaluateSamples'

describe('evaluateSamples', () => {
  it('yields one verdict result per sample, in order', async () => {
    const results = await Array.fromAsync(
      evaluateSamples({
        samples: [{ text: 'hello' }, { text: 'world' }],
        criteria: 'criterion body',
        singleShotRequest: async ({ schema }) =>
          schema.parse({ score: 1, reason: 'meets the criterion' }),
      })
    )

    expect(results).toEqual([
      {
        sample: { text: 'hello' },
        verdict: { score: 1, reason: 'meets the criterion' },
      },
      {
        sample: { text: 'world' },
        verdict: { score: 1, reason: 'meets the criterion' },
      },
    ])
  })

  it('yields an error result for a failing cell and continues', async () => {
    const results = await Array.fromAsync(
      evaluateSamples({
        samples: [{ text: 'boom' }, { text: 'fine' }],
        criteria: 'criterion body',
        singleShotRequest: async ({ prompt, schema }) => {
          if (prompt.includes('boom')) {
            throw new Error('evaluation failed')
          }
          return schema.parse({ score: 1, reason: 'ok' })
        },
      })
    )

    expect(results).toEqual([
      { sample: { text: 'boom' }, error: expect.any(Error) },
      { sample: { text: 'fine' }, verdict: { score: 1, reason: 'ok' } },
    ])
  })
})
