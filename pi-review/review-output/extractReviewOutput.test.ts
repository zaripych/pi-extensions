import { describe, expect, it } from 'vitest'
import { extractReviewOutput } from './extractReviewOutput'
import type { ReviewOutput } from './reviewOutputSchema'

const validOutput: ReviewOutput = {
  findings: [],
  overall_correctness: 'patch is correct',
  overall_explanation: 'No issues found.',
  overall_confidence_score: 0.95,
}

describe('extractReviewOutput', () => {
  it('extracts ReviewOutput from finish-review tool_execution_end event', () => {
    const events = [
      {
        type: 'tool_execution_end',
        toolName: 'reviewer-git',
        result: { content: [], details: undefined },
        isError: false,
      },
      {
        type: 'tool_execution_end',
        toolName: 'finish-review',
        result: { content: [], details: validOutput },
        isError: false,
      },
    ]

    expect(extractReviewOutput(events)).toEqual(validOutput)
  })

  it('returns undefined when no finish-review event exists', () => {
    const events = [
      {
        type: 'tool_execution_end',
        toolName: 'reviewer-git',
        result: { content: [], details: undefined },
        isError: false,
      },
    ]

    expect(extractReviewOutput(events)).toBeUndefined()
  })

  it('returns undefined when finish-review result has invalid details', () => {
    const events = [
      {
        type: 'tool_execution_end',
        toolName: 'finish-review',
        result: { content: [], details: { bad: 'data' } },
        isError: false,
      },
    ]

    expect(extractReviewOutput(events)).toBeUndefined()
  })

  it('skips errored finish-review events', () => {
    const events = [
      {
        type: 'tool_execution_end',
        toolName: 'finish-review',
        result: { content: [], details: validOutput },
        isError: true,
      },
    ]

    expect(extractReviewOutput(events)).toBeUndefined()
  })

  it('returns undefined when events list is empty', () => {
    expect(extractReviewOutput([])).toBeUndefined()
  })
})
