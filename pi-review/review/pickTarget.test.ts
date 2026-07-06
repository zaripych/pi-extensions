import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it, vi } from 'vitest'
import { setupPickTarget } from './pickTarget.harness'

const setup = combineHarnesses(setupPickTarget)

function passthroughLoader<T>({
  run,
}: {
  description: string
  run: (runArgs: { signal: AbortSignal }) => Promise<T>
}) {
  return run({ signal: new AbortController().signal })
}

function pickTargetParams() {
  return {
    args: '',
    cwd: '/test/project',
    hasUI: true,
    currentModelId: 'anthropic/claude-sonnet-4-20250514',
    availableModelIds: ['anthropic/claude-sonnet-4-20250514', 'openai/gpt-4o'],
    modelConfig: undefined,
    notify: vi.fn(),
    runWithCancellableLoader: passthroughLoader,
    showReviewForm: async () => undefined,
  }
}

describe('pickTarget', () => {
  it('returns uncommitted target when no args and no UI', async () => {
    await using harness = await setup()

    const result = await harness.pickTarget({
      ...pickTargetParams(),
      hasUI: false,
    })

    expect(result).toEqual({ target: { type: 'uncommitted' } })
  })

  it('returns custom target when args are provided', async () => {
    await using harness = await setup()

    const result = await harness.pickTarget({
      ...pickTargetParams(),
      args: 'check for regressions',
    })

    expect(result).toEqual({
      target: { type: 'custom', instructions: 'check for regressions' },
    })
  })

  it('shows the prepared form and returns its selection', async () => {
    await using harness = await setup()

    const showReviewForm = vi.fn(async () => ({
      target: { type: 'baseBranch' as const, branch: 'origin/main' },
      modelId: 'openai/gpt-4o',
      includeAgents: false,
    }))
    const result = await harness.pickTarget({
      ...pickTargetParams(),
      showReviewForm,
    })

    expect(showReviewForm).toHaveBeenCalledWith(
      expect.objectContaining({ defaultTarget: expect.any(String) })
    )
    expect(result).toEqual({
      target: { type: 'baseBranch', branch: 'origin/main' },
      modelId: 'openai/gpt-4o',
      includeAgents: false,
    })
  })

  it('refetches and reopens the form when Fetch origin is chosen', async () => {
    await using harness = await setup()

    const selection = {
      target: { type: 'baseBranch' as const, branch: 'origin/main' },
      modelId: 'openai/gpt-4o',
      includeAgents: false,
    }
    const showReviewForm = vi
      .fn()
      .mockResolvedValueOnce('fetch')
      .mockResolvedValueOnce(selection)
    const result = await harness.pickTarget({
      ...pickTargetParams(),
      showReviewForm,
    })

    expect(harness.prepareReviewForm).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ fetch: false })
    )
    expect(harness.prepareReviewForm).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ fetch: true })
    )
    expect(showReviewForm).toHaveBeenCalledTimes(2)
    expect(result).toEqual(selection)
  })

  it('returns cancelled when the form is dismissed', async () => {
    await using harness = await setup()

    const result = await harness.pickTarget({
      ...pickTargetParams(),
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
      ...pickTargetParams(),
      showReviewForm: vi
        .fn()
        .mockResolvedValueOnce('fetch')
        .mockResolvedValueOnce(undefined),
    }
    await harness.pickTarget(params)

    expect(params.notify).toHaveBeenCalledWith(
      expect.stringContaining('could not resolve host'),
      'warning'
    )
  })
})
