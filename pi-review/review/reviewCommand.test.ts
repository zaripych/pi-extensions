import type { Api, Model } from '@earendil-works/pi-ai'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it, vi } from 'vitest'
import { setupReviewCommand } from './reviewCommand.harness'

const setup = combineHarnesses(setupReviewCommand)

type CreateModelRuntime = (modelId: string) => Promise<{
  model: Model<Api> | undefined
  modelRuntime: ModelRuntime
}>

const createModelRuntimeStub = (): CreateModelRuntime =>
  vi.fn<CreateModelRuntime>()

function passthroughLoader<T>({
  run,
}: {
  description: string
  run: (runArgs: { signal: AbortSignal }) => Promise<T>
}) {
  return run({ signal: new AbortController().signal })
}

function reviewCommandParams(params: { args: string; hasUI: boolean }) {
  return {
    ...params,
    cwd: '/test/project',
    currentModelId: 'anthropic/claude-sonnet-4-20250514',
    availableModelIds: ['anthropic/claude-sonnet-4-20250514', 'openai/gpt-4o'],
    showReviewForm: async () => undefined,
    notify: vi.fn(),
    runWithCancellableLoader: passthroughLoader,
    sendMessage: vi.fn(async () => {}),
    createModelRuntime: createModelRuntimeStub(),
  }
}

describe('reviewCommand', () => {
  it('uses the model selected in the review form for the session', async () => {
    await using harness = await setup({
      collectReviewParams: async () => ({
        target: { type: 'uncommitted' as const },
        modelId: 'openai/gpt-4o',
      }),
    })

    await harness.reviewCommand(reviewCommandParams({ args: '', hasUI: true }))

    expect(harness.runReviewSession).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'openai/gpt-4o' })
    )
  })

  it('cancelled selection returns cancelled', async () => {
    await using harness = await setup({
      collectReviewParams: async () => 'cancelled',
    })

    const result = await harness.reviewCommand(
      reviewCommandParams({ args: '', hasUI: true })
    )

    expect(result).toEqual({ cancelled: true })
  })

  it('runs review session and returns output', async () => {
    const reviewOutput = {
      findings: [],
      overall_explanation: 'Looks good.',
      overall_confidence_score: 0.95,
    }
    await using harness = await setup({
      runReviewSession: async () => ({ output: reviewOutput }),
    })

    const params = reviewCommandParams({
      args: 'check error handling',
      hasUI: true,
    })
    const result = await harness.reviewCommand(params)

    expect(result).toEqual(
      expect.objectContaining({
        output: reviewOutput,
        modelId: expect.any(String),
      })
    )
  })

  it('sends review message with formatted content', async () => {
    await using harness = await setup()

    const params = reviewCommandParams({
      args: 'check error handling',
      hasUI: true,
    })
    await harness.reviewCommand(params)

    expect(params.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: 'review',
        display: true,
      })
    )
  })

  it('passes task prompt and session model to runReviewSession', async () => {
    await using harness = await setup({
      getMergeBaseForBranch: async () => 'abc1234',
    })

    const params = {
      args: '',
      cwd: '/test/project',
      currentModelId: 'anthropic/claude-sonnet-4-20250514',
      availableModelIds: [
        'anthropic/claude-sonnet-4-20250514',
        'openai/gpt-4o',
      ],
      hasUI: true,
      showReviewForm: async () => ({
        target: { type: 'baseBranch' as const, branch: 'main' },
        modelId: 'openai/gpt-4o',
        includeAgentsMd: true,
      }),
      createModelRuntime: createModelRuntimeStub(),
      notify: vi.fn(),
      runWithCancellableLoader: passthroughLoader,
      sendMessage: vi.fn(async () => {}),
    }

    await harness.reviewCommand(params)

    expect(harness.runReviewSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/test/project',
        modelId: 'openai/gpt-4o',
        includeAgentsMd: true,
        taskPrompt: expect.stringMatching(
          /Review the code changes against the base branch 'main'[\s\S]*abc1234/u
        ),
      })
    )
  })

  it('appends review instructions content to the target prompt', async () => {
    await using harness = await setup({
      getMergeBaseForBranch: async () => 'abc1234',
    })

    const params = {
      args: '',
      cwd: '/test/project',
      currentModelId: 'anthropic/claude-sonnet-4-20250514',
      availableModelIds: [
        'anthropic/claude-sonnet-4-20250514',
        'openai/gpt-4o',
      ],
      hasUI: true,
      showReviewForm: async () => ({
        target: { type: 'baseBranch' as const, branch: 'main' },
        modelId: 'openai/gpt-4o',
        includeAgentsMd: false,
        reviewInstructions: {
          path: 'docs/security.review.md',
          content: 'Focus on authentication and authorization flows.',
        },
      }),
      createModelRuntime: createModelRuntimeStub(),
      notify: vi.fn(),
      runWithCancellableLoader: passthroughLoader,
      sendMessage: vi.fn(async () => {}),
    }

    await harness.reviewCommand(params)

    expect(harness.runReviewSession).toHaveBeenCalledWith(
      expect.objectContaining({
        taskPrompt: expect.stringContaining(
          'Focus on authentication and authorization flows.'
        ),
      })
    )
    expect(harness.runReviewSession).toHaveBeenCalledWith(
      expect.objectContaining({
        taskPrompt: expect.stringContaining("the base branch 'main'"),
      })
    )
    expect(params.notify).toHaveBeenCalledWith(
      'Using review instructions: docs/security.review.md',
      'info'
    )
  })

  it('appends bundled correctness instructions and notifies Correctness when no file is selected', async () => {
    await using harness = await setup({
      getMergeBaseForBranch: async () => 'abc1234',
    })

    const params = {
      args: '',
      cwd: '/test/project',
      currentModelId: 'anthropic/claude-sonnet-4-20250514',
      availableModelIds: [
        'anthropic/claude-sonnet-4-20250514',
        'openai/gpt-4o',
      ],
      hasUI: true,
      showReviewForm: async () => ({
        target: { type: 'baseBranch' as const, branch: 'main' },
        modelId: 'openai/gpt-4o',
        includeAgentsMd: false,
      }),
      createModelRuntime: createModelRuntimeStub(),
      notify: vi.fn(),
      runWithCancellableLoader: passthroughLoader,
      sendMessage: vi.fn(async () => {}),
    }

    await harness.reviewCommand(params)

    expect(params.notify).toHaveBeenCalledWith(
      'Using review instructions: Correctness',
      'info'
    )
    const correctnessContent = await harness.getCorrectnessInstructionsContent()
    expect(harness.runReviewSession).toHaveBeenCalledWith(
      expect.objectContaining({
        taskPrompt: expect.stringContaining(correctnessContent),
      })
    )
  })

  it('passes loader signal to runReviewSession', async () => {
    await using harness = await setup()

    const controller = new AbortController()
    const params = {
      ...reviewCommandParams({ args: 'check error handling', hasUI: true }),
      runWithCancellableLoader: <T>({
        run,
      }: {
        description: string
        run: (runArgs: { signal: AbortSignal }) => Promise<T>
      }) => run({ signal: controller.signal }),
    }

    await harness.reviewCommand(params)

    expect(harness.runReviewSession).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it('skips loader when hasUI is false', async () => {
    await using harness = await setup({
      collectReviewParams: async () => ({
        target: { type: 'uncommitted' as const },
      }),
    })

    let loaderCalled = false
    const params = {
      ...reviewCommandParams({ args: '', hasUI: false }),
      runWithCancellableLoader: <T>(args: {
        description: string
        run: (runArgs: { signal: AbortSignal }) => Promise<T>
      }) => {
        loaderCalled = true
        return passthroughLoader(args)
      },
    }

    await harness.reviewCommand(params)

    expect(loaderCalled).toBe(false)
    expect(harness.runReviewSession).toHaveBeenCalled()
  })

  it('notifies with config error before running review', async () => {
    await using harness = await setup({
      collectReviewParams: async () => ({
        target: { type: 'uncommitted' as const },
      }),
      loadConfig: async () => ({
        config: {
          tools: ['read'],
          reviewInstructionsGlob: '**/*.review.md',
          systemPromptContent: 'prompt',
          correctnessInstructionsContent: 'correctness',
          thresholds: { minConfidence: 0 },
        },
        configError:
          'Invalid review config:\n✖ bad field\nConfig path: /tmp/review.yaml',
        warnings: [],
      }),
    })

    const params = reviewCommandParams({ args: '', hasUI: true })
    await harness.reviewCommand(params)

    expect(params.notify).toHaveBeenCalledWith(
      expect.stringContaining('bad field'),
      'warning'
    )
    expect(params.notify).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/review.yaml'),
      'warning'
    )
  })

  it('notifies with error when review session returns no output', async () => {
    await using harness = await setup({
      collectReviewParams: async () => ({
        target: { type: 'uncommitted' as const },
      }),
      runReviewSession: async () => ({
        error: 'An error occurred while processing your request.',
      }),
    })

    const params = reviewCommandParams({ args: '', hasUI: true })
    const result = await harness.reviewCommand(params)

    expect(params.notify).toHaveBeenCalledWith(
      expect.stringContaining(
        'An error occurred while processing your request.'
      ),
      'error'
    )
    expect(result).toEqual({
      error: 'An error occurred while processing your request.',
    })
    expect(params.sendMessage).not.toHaveBeenCalled()
  })

  it('cancelled review session returns cancelled without sending a review message', async () => {
    await using harness = await setup({
      collectReviewParams: async () => ({
        target: { type: 'uncommitted' as const },
      }),
      runReviewSession: async () => ({ cancelled: true as const }),
    })

    const params = reviewCommandParams({ args: '', hasUI: true })
    const result = await harness.reviewCommand(params)

    expect(result).toEqual({ cancelled: true })
    expect(params.sendMessage).not.toHaveBeenCalled()
  })
})
