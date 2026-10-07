import { readdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupLoadAaModels } from './loadAaModels.harness'

function aaPage(params: {
  models: Array<{ slug: string; index: number | null }>
  hasMore?: boolean
}) {
  return {
    data: params.models.map((model) => ({
      slug: model.slug,
      name: model.slug.toUpperCase(),
      evaluations: { artificial_analysis_intelligence_index: model.index },
    })),
    pagination: { has_more: params.hasMore ?? false },
  }
}

async function writeCache(params: {
  cacheDir: string
  pages: unknown[]
  ageDays?: number
}) {
  for (const [index, page] of params.pages.entries()) {
    const file = join(params.cacheDir, `aa-models-page-${index + 1}.json`)
    await writeFile(file, JSON.stringify(page))
    if (params.ageDays !== undefined) {
      const stale = new Date(Date.now() - params.ageDays * 24 * 3_600_000)
      await utimes(file, stale, stale)
    }
  }
}

const setup = setupLoadAaModels

describe('loadAaModels', () => {
  it('serves models from a fresh cache without fetching', async () => {
    await using harness = await setup()
    await writeCache({
      cacheDir: harness.cacheDir,
      pages: [aaPage({ models: [{ slug: 'gpt-5-2-codex', index: 28.5 }] })],
    })

    const models = await harness.loadAaModels({ now: new Date() })

    expect(models).toEqual([
      {
        slug: 'gpt-5-2-codex',
        name: 'GPT-5-2-CODEX',
        evaluations: { artificial_analysis_intelligence_index: 28.5 },
      },
    ])
    expect(harness.fetchAaPages).not.toHaveBeenCalled()
  })

  it('refreshes a stale cache by fetching and rewriting the page set', async () => {
    const fresh = aaPage({ models: [{ slug: 'new-model', index: 2 }] })
    await using harness = await setup({ fetchAaPages: async () => [fresh] })
    await writeCache({
      cacheDir: harness.cacheDir,
      pages: [aaPage({ models: [{ slug: 'old-model', index: 1 }] })],
      ageDays: 2,
    })

    const models = await harness.loadAaModels({ now: new Date() })

    expect(models.map((model) => model.slug)).toEqual(['new-model'])
    expect(harness.fetchAaPages).toHaveBeenCalled()
    const files = (await readdir(harness.cacheDir)).toSorted()
    expect(files).toEqual(['aa-models-page-1.json'])
    const written = JSON.parse(
      await readFile(join(harness.cacheDir, 'aa-models-page-1.json'), 'utf8')
    )
    expect(written).toEqual(fresh)
  })

  it('fetches when no cache exists', async () => {
    await using harness = await setup({
      fetchAaPages: async () => [
        aaPage({ models: [{ slug: 'new-model', index: 2 }] }),
      ],
    })

    const models = await harness.loadAaModels({ now: new Date() })

    expect(models.map((model) => model.slug)).toEqual(['new-model'])
    expect((await readdir(harness.cacheDir)).toSorted()).toEqual([
      'aa-models-page-1.json',
    ])
  })

  it('fails fast when a required refresh fails, without serving the stale cache', async () => {
    await using harness = await setup({
      fetchAaPages: async () => {
        throw new Error('fetch failed')
      },
    })
    await writeCache({
      cacheDir: harness.cacheDir,
      pages: [aaPage({ models: [{ slug: 'old-model', index: 1 }] })],
      ageDays: 2,
    })

    await expect(harness.loadAaModels({ now: new Date() })).rejects.toThrow(
      'fetch failed'
    )
    // the stale cache is left untouched
    const written = JSON.parse(
      await readFile(join(harness.cacheDir, 'aa-models-page-1.json'), 'utf8')
    )
    expect(written.data[0]?.slug).toBe('old-model')
  })

  it('rejects cached pages that fail validation', async () => {
    await using harness = await setup()
    await writeFile(
      join(harness.cacheDir, 'aa-models-page-1.json'),
      '{not json'
    )

    await expect(harness.loadAaModels({ now: new Date() })).rejects.toThrow(
      'is not valid JSON'
    )
  })
})
