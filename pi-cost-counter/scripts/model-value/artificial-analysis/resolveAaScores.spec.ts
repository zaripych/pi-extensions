import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupResolveAaScores } from './resolveAaScores.harness'

/** Fresh cache pages matching the harness cacheDir, so no fetch happens. */
async function seedCache(params: {
  cacheDir: string
  models: Array<{ slug: string; index: number | null }>
}) {
  await writeFile(
    join(params.cacheDir, 'aa-models-page-1.json'),
    JSON.stringify({
      data: params.models.map((model) => ({
        slug: model.slug,
        name: model.slug.toUpperCase(),
        evaluations: { artificial_analysis_intelligence_index: model.index },
      })),
      pagination: { has_more: false },
    })
  )
}

const setup = setupResolveAaScores

describe('resolveAaScores', () => {
  it('matches models by exact and separator-normalized identifiers', async () => {
    await using harness = await setup()
    await seedCache({
      cacheDir: harness.cacheDir,
      models: [
        { slug: 'gpt-5-2-codex', index: 28.5 },
        { slug: 'claude-sonnet-4-6', index: 24.7 },
      ],
    })

    const scores = await harness.resolveAaScores({
      now: new Date(),
      models: ['gpt-5.2-codex', 'claude-sonnet-4-6'],
    })

    expect(Object.fromEntries(scores)).toEqual({
      'gpt-5.2-codex': 28.5,
      'claude-sonnet-4-6': 24.7,
    })
  })

  it('returns no entry for models without an AA evaluation', async () => {
    await using harness = await setup()
    await seedCache({
      cacheDir: harness.cacheDir,
      models: [{ slug: 'gpt-4-pro', index: null }],
    })

    const scores = await harness.resolveAaScores({
      now: new Date(),
      models: ['gpt-4-pro'],
    })

    expect(scores.size).toBe(0)
  })

  it('returns no entry for unknown models without failing', async () => {
    await using harness = await setup()
    await seedCache({
      cacheDir: harness.cacheDir,
      models: [{ slug: 'gpt-5-2-codex', index: 28.5 }],
    })

    const scores = await harness.resolveAaScores({
      now: new Date(),
      models: ['totally-unknown'],
    })

    expect(scores.size).toBe(0)
  })

  it('does not match reasoning variants by prefix', async () => {
    await using harness = await setup()
    await seedCache({
      cacheDir: harness.cacheDir,
      models: [
        { slug: 'claude-sonnet-5-5-low', index: 35.9 },
        { slug: 'claude-sonnet-5-5-xhigh', index: 51.9 },
      ],
    })

    const scores = await harness.resolveAaScores({
      now: new Date(),
      models: ['claude-sonnet-5-5'],
    })

    expect(scores.size).toBe(0)
  })
})
