import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it, vi } from 'vitest'
import { setupCollectReviewParams } from './collectReviewParams.harness'

const setup = combineHarnesses(setupCollectReviewParams)

function passthroughLoader<T>({
  run,
}: {
  description: string
  run: (runArgs: { signal: AbortSignal }) => Promise<T>
}) {
  return run({ signal: new AbortController().signal })
}

function collectReviewParamsInput() {
  return {
    args: '',
    cwd: '/test/project',
    hasUI: true,
    currentModelId: 'anthropic/claude-sonnet-4-20250514',
    availableModelIds: ['anthropic/claude-sonnet-4-20250514', 'openai/gpt-4o'],
    modelConfig: undefined,
    reviewInstructionsGlob: '**/*.review.md',
    notify: vi.fn(),
    runWithCancellableLoader: passthroughLoader,
    showReviewForm: async () => undefined,
  }
}

describe('collectReviewParams', () => {
  it('returns uncommitted target when no args and no UI', async () => {
    await using harness = await setup()

    const result = await harness.collectReviewParams({
      ...collectReviewParamsInput(),
      hasUI: false,
    })

    expect(result).toEqual({ target: { type: 'uncommitted' } })
  })

  it('passes review instructions from form selection through to result', async () => {
    await using harness = await setup()

    const showReviewForm = vi.fn(async () => ({
      target: { type: 'baseBranch' as const, branch: 'origin/main' },
      modelId: 'openai/gpt-4o',
      includeAgentsMd: false,
      reviewInstructions: {
        path: 'docs/security.review.md',
        content: 'focus on auth',
      },
    }))
    const result = await harness.collectReviewParams({
      ...collectReviewParamsInput(),
      showReviewForm,
    })

    expect(result).toEqual({
      target: { type: 'baseBranch', branch: 'origin/main' },
      modelId: 'openai/gpt-4o',
      includeAgentsMd: false,
      reviewInstructions: {
        path: 'docs/security.review.md',
        content: 'focus on auth',
      },
    })
  })

  it('returns freeform target when args are provided', async () => {
    await using harness = await setup()

    const result = await harness.collectReviewParams({
      ...collectReviewParamsInput(),
      args: 'check for regressions',
    })

    expect(result).toEqual({
      target: { type: 'freeform', instructions: 'check for regressions' },
    })
  })

  it('shows the prepared form and returns its selection', async () => {
    await using harness = await setup()

    const showReviewForm = vi.fn(async () => ({
      target: { type: 'baseBranch' as const, branch: 'origin/main' },
      modelId: 'openai/gpt-4o',
      includeAgentsMd: false,
    }))
    const result = await harness.collectReviewParams({
      ...collectReviewParamsInput(),
      showReviewForm,
    })

    expect(showReviewForm).toHaveBeenCalledWith(
      expect.objectContaining({ defaultTarget: expect.any(String) })
    )
    expect(result).toEqual({
      target: { type: 'baseBranch', branch: 'origin/main' },
      modelId: 'openai/gpt-4o',
      includeAgentsMd: false,
    })
  })

  it('refetches and reopens the form when Fetch origin is chosen', async () => {
    await using harness = await setup()

    const selection = {
      target: { type: 'baseBranch' as const, branch: 'origin/main' },
      modelId: 'openai/gpt-4o',
      includeAgentsMd: false,
    }
    const showReviewForm = vi
      .fn()
      .mockResolvedValueOnce('fetch')
      .mockResolvedValueOnce(selection)
    const result = await harness.collectReviewParams({
      ...collectReviewParamsInput(),
      showReviewForm,
    })

    expect(harness.fetchOrigin).toHaveBeenCalledTimes(1)
    expect(showReviewForm).toHaveBeenCalledTimes(2)
    expect(result).toEqual(selection)
  })

  it('returns cancelled when the form is dismissed', async () => {
    await using harness = await setup()

    const result = await harness.collectReviewParams({
      ...collectReviewParamsInput(),
      showReviewForm: async () => undefined,
    })

    expect(result).toBe('cancelled')
  })

  it('notifies a warning when fetching origin fails', async () => {
    await using harness = await setup({
      fetchOrigin: async () => {
        throw new Error('could not resolve host')
      },
    })

    const params = {
      ...collectReviewParamsInput(),
      showReviewForm: vi
        .fn()
        .mockResolvedValueOnce('fetch')
        .mockResolvedValueOnce(undefined),
    }
    await harness.collectReviewParams(params)

    expect(params.notify).toHaveBeenCalledWith(
      expect.stringContaining('could not resolve host'),
      'warning'
    )
  })

  it('does not warn and reopens the form when the fetch is aborted', async () => {
    await using harness = await setup({
      fetchOrigin: async () => {
        const error = new Error('The operation was aborted')
        error.name = 'AbortError'
        throw error
      },
    })

    const params = {
      ...collectReviewParamsInput(),
      showReviewForm: vi
        .fn()
        .mockResolvedValueOnce('fetch')
        .mockResolvedValueOnce(undefined),
    }
    const result = await harness.collectReviewParams(params)

    expect(params.notify).not.toHaveBeenCalled()
    expect(result).toBe('cancelled')
  })
})
