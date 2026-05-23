import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it, vi } from 'vitest'
import { setupReviewCommand } from './reviewCommand.harness'

const setup = combineHarnesses(setupReviewCommand)

function reviewCommandParams(params: { args: string; hasUI: boolean }) {
  return {
    ...params,
    cwd: '/test/project',
    currentModelId: 'anthropic/claude-sonnet-4-20250514',
    availableModelIds: ['anthropic/claude-sonnet-4-20250514', 'openai/gpt-4o'],
    select: async () => {
      throw new Error('Unexpected select call')
    },
    input: async () => {
      throw new Error('Unexpected input call')
    },
    notify: vi.fn(),
    sendMessage: vi.fn(async () => {}),
  }
}

describe('reviewCommand', () => {
  it('cancelled selection returns cancelled', async () => {
    await using harness = await setup({
      pickTarget: async () => 'cancelled',
    })

    const result = await harness.reviewCommand(
      reviewCommandParams({ args: '', hasUI: true })
    )

    expect(result).toEqual({ cancelled: true })
  })

  it('runs review session and returns output', async () => {
    const reviewOutput = {
      findings: [],
      overall_correctness: 'patch is correct' as const,
      overall_explanation: 'Looks good.',
      overall_confidence_score: 0.95,
    }
    await using harness = await setup({
      runReviewSession: async () => ({
        output: reviewOutput,
        sessionError: undefined,
      }),
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
      select: async (_title: string, options: string[]) => {
        if (options.includes('Review against a base branch')) {
          return 'Review against a base branch'
        }
        return 'main'
      },
      input: async () => {
        throw new Error('Unexpected input call')
      },
      notify: vi.fn(),
      sendMessage: vi.fn(async () => {}),
    }

    await harness.reviewCommand(params)

    expect(harness.runReviewSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/test/project',
        modelId: 'openai/gpt-4o',
        taskPrompt: expect.stringMatching(
          /Review the code changes against the base branch 'main'[\s\S]*abc1234/u
        ),
      })
    )
  })

  it('notifies with config error before running review', async () => {
    await using harness = await setup({
      pickTarget: async () => ({ type: 'uncommitted' as const }),
      loadConfig: async () => ({
        config: {
          tools: ['read'],
          systemPrompt: 'review-prompt.md',
          systemPromptContent: 'prompt',
          prompts: {
            uncommitted: 'review',
            baseBranch: 'review',
            baseBranchFallback: 'review',
            commit: 'review',
            commitNoTitle: 'review',
          },
          thresholds: { minConfidence: 0, maxPriority: 3 },
        },
        configError:
          'Invalid review config:\n✖ bad field\nConfig path: /tmp/review.yaml',
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
      pickTarget: async () => ({ type: 'uncommitted' as const }),
      runReviewSession: async () => ({
        output: undefined,
        sessionError: 'An error occurred while processing your request.',
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
      sessionError: 'An error occurred while processing your request.',
    })
    expect(params.sendMessage).not.toHaveBeenCalled()
  })
})
