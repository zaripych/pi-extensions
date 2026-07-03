import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupPrepareReviewForm } from './prepareReviewForm.harness'

const setup = combineHarnesses(setupPrepareReviewForm)

function prepareReviewFormParams() {
  return {
    cwd: '/test/project',
    currentModelId: 'anthropic/claude-sonnet-4-20250514',
    availableModelIds: ['anthropic/claude-sonnet-4-20250514', 'openai/gpt-4o'],
    modelConfig: undefined,
    fetch: false,
  }
}

describe('prepareReviewForm', () => {
  it('defaults target to uncommitted when the working tree is dirty', async () => {
    await using harness = await setup({
      hasUncommittedChanges: async () => true,
    })

    const form = await harness.prepareReviewForm(prepareReviewFormParams())

    expect(form.defaultTarget).toBe('uncommitted')
  })

  it('defaults target to branch with base origin/main on a clean non-main branch', async () => {
    await using harness = await setup({
      getDefaultBranch: async () => 'main',
      hasUncommittedChanges: async () => false,
      getCurrentBranch: async () => 'feature/login',
      listBranchesWithAuthors: async () => [
        { name: 'feature/login', author: 'Alice' },
        { name: 'origin/main', author: 'Bob' },
        { name: 'main', author: 'Bob' },
      ],
    })

    const form = await harness.prepareReviewForm(prepareReviewFormParams())

    expect(form).toEqual(
      expect.objectContaining({
        defaultTarget: 'branch',
        defaultBase: 'origin/main',
      })
    )
  })

  it('falls back to base main when origin/main does not exist', async () => {
    await using harness = await setup({
      getDefaultBranch: async () => 'main',
      hasUncommittedChanges: async () => false,
      getCurrentBranch: async () => 'feature/login',
      listBranchesWithAuthors: async () => [
        { name: 'feature/login', author: 'Alice' },
        { name: 'main', author: 'Bob' },
      ],
    })

    const form = await harness.prepareReviewForm(prepareReviewFormParams())

    expect(form.defaultBase).toBe('main')
  })

  it('defaults target to commit on a clean main branch', async () => {
    await using harness = await setup({
      getDefaultBranch: async () => 'main',
      hasUncommittedChanges: async () => false,
      getCurrentBranch: async () => 'main',
    })

    const form = await harness.prepareReviewForm(prepareReviewFormParams())

    expect(form.defaultTarget).toBe('commit')
  })

  it('pins main and origin/main to the top of recency-sorted branches', async () => {
    await using harness = await setup({
      getDefaultBranch: async () => 'main',
      listBranchesWithAuthors: async () => [
        { name: 'feature/new', author: 'Alice' },
        { name: 'origin/main', author: 'Bob' },
        { name: 'feature/old', author: 'Carol' },
        { name: 'main', author: 'Bob' },
      ],
    })

    const form = await harness.prepareReviewForm(prepareReviewFormParams())

    expect(form.branches).toEqual([
      { name: 'main', author: 'Bob' },
      { name: 'origin/main', author: 'Bob' },
      { name: 'feature/new', author: 'Alice' },
      { name: 'feature/old', author: 'Carol' },
    ])
  })

  it('sorts chooseFrom models to the top of available models', async () => {
    await using harness = await setup()

    const form = await harness.prepareReviewForm({
      ...prepareReviewFormParams(),
      availableModelIds: [
        'anthropic/claude-sonnet-4-20250514',
        'openai/gpt-4o',
        'google/gemini-2.5-pro',
      ],
      modelConfig: { chooseFrom: ['google/gemini-2.5-pro'] },
    })

    expect(form.models).toEqual([
      'google/gemini-2.5-pro',
      'anthropic/claude-sonnet-4-20250514',
      'openai/gpt-4o',
    ])
  })

  it('uses the detected default branch for base default and pinning', async () => {
    await using harness = await setup({
      getDefaultBranch: async () => 'master',
      hasUncommittedChanges: async () => false,
      getCurrentBranch: async () => 'feature/login',
      listBranchesWithAuthors: async () => [
        { name: 'feature/login', author: 'Alice' },
        { name: 'origin/master', author: 'Bob' },
        { name: 'master', author: 'Bob' },
      ],
    })

    const form = await harness.prepareReviewForm(prepareReviewFormParams())

    expect(form).toEqual(
      expect.objectContaining({
        defaultTarget: 'branch',
        defaultBase: 'origin/master',
        defaultBranch: 'master',
        branches: [
          { name: 'master', author: 'Bob' },
          { name: 'origin/master', author: 'Bob' },
          { name: 'feature/login', author: 'Alice' },
        ],
      })
    )
  })

  it('falls back to a master branch from the list when detection fails', async () => {
    await using harness = await setup({
      getDefaultBranch: async () => undefined,
      hasUncommittedChanges: async () => false,
      getCurrentBranch: async () => 'feature/login',
      listBranchesWithAuthors: async () => [
        { name: 'feature/login', author: 'Alice' },
        { name: 'master', author: 'Bob' },
      ],
    })

    const form = await harness.prepareReviewForm(prepareReviewFormParams())

    expect(form).toEqual(
      expect.objectContaining({
        defaultBase: 'master',
        defaultBranch: 'master',
      })
    )
  })

  it('puts the auto-selected model first, ahead of other chooseFrom models', async () => {
    await using harness = await setup()

    const form = await harness.prepareReviewForm({
      ...prepareReviewFormParams(),
      currentModelId: 'openai/gpt-4o',
      availableModelIds: [
        'openai/gpt-4o',
        'openai/gpt-5',
        'anthropic/claude-sonnet-4-20250514',
      ],
      modelConfig: {
        chooseFrom: ['openai/gpt-5', 'anthropic/claude-sonnet-4-20250514'],
      },
    })

    expect(form).toEqual(
      expect.objectContaining({
        defaultModel: 'anthropic/claude-sonnet-4-20250514',
        models: [
          'anthropic/claude-sonnet-4-20250514',
          'openai/gpt-5',
          'openai/gpt-4o',
        ],
      })
    )
  })

  it('does not fetch origin unless requested', async () => {
    await using harness = await setup()

    await harness.prepareReviewForm(prepareReviewFormParams())

    expect(harness.fetchOrigin).not.toHaveBeenCalled()
  })

  it('returns a fetch warning and still builds the form when fetchOrigin fails', async () => {
    await using harness = await setup({
      fetchOrigin: async () => {
        throw new Error('could not resolve host')
      },
      listBranchesWithAuthors: async () => [{ name: 'main', author: 'Bob' }],
    })

    const form = await harness.prepareReviewForm({
      ...prepareReviewFormParams(),
      fetch: true,
    })

    expect(form).toEqual(
      expect.objectContaining({
        fetchWarning: expect.stringContaining('could not resolve host'),
        branches: [{ name: 'main', author: 'Bob' }],
      })
    )
  })
})
