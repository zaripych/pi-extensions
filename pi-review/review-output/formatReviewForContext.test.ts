import { describe, expect, it } from 'vitest'
import { formatReviewForContext } from './formatReviewForContext'
import type { ReviewOutput } from './reviewOutputSchema'

const finding = {
  title: 'Fix null check before accessing email',
  body: 'The function does not check for null.',
  confidence_score: 0.9,
  priority: 1 as const,
  code_location: {
    absolute_file_path: '/projects/my-app/src/user.ts',
    line_range: { start: 42, end: 45 },
  },
}

const base: ReviewOutput = {
  findings: [],
  overall_correctness: 'patch is correct',
  overall_explanation: 'The patch looks good.',
  overall_confidence_score: 0.9,
}

const cwd = '/projects/my-app'

describe('formatReviewForContext', () => {
  it('renders finding with relative path and line range', () => {
    const result = formatReviewForContext({
      output: { ...base, findings: [finding] },
      cwd,
      modelId: 'test/model',
    })

    expect(result).toContain('Fix null check before accessing email')
    expect(result).toContain('`src/user.ts`')
    expect(result).toContain('lines 42–45')
  })

  it('renders single-line range without dash', () => {
    const singleLine = {
      ...finding,
      code_location: {
        ...finding.code_location,
        line_range: { start: 10, end: 10 },
      },
    }

    const result = formatReviewForContext({
      output: { ...base, findings: [singleLine] },
      cwd,
      modelId: 'test/model',
    })

    expect(result).toContain('line 10')
    expect(result).not.toContain('lines')
  })

  it('renders priority tag as markdown heading prefix', () => {
    const result = formatReviewForContext({
      output: { ...base, findings: [finding] },
      cwd,
      modelId: 'test/model',
    })

    expect(result).toContain('#### [P1] Fix null check')
  })

  it('omits priority prefix when finding has no priority', () => {
    const { priority: _p, ...noPriority } = finding

    const result = formatReviewForContext({
      output: { ...base, findings: [noPriority] },
      cwd,
      modelId: 'test/model',
    })

    expect(result).not.toContain('[P')
    expect(result).toContain('#### Fix null check')
  })

  it('includes verdict and explanation', () => {
    const result = formatReviewForContext({
      output: base,
      cwd,
      modelId: 'openai/gpt-4o',
    })

    expect(result).toContain('**The patch is correct**')
    expect(result).toContain('The patch looks good.')
  })

  it('includes model used for review', () => {
    const result = formatReviewForContext({
      output: base,
      cwd,
      modelId: 'openai/gpt-4o',
    })

    expect(result).toContain('openai/gpt-4o')
  })

  it('renders incorrect verdict', () => {
    const incorrect: ReviewOutput = {
      ...base,
      overall_correctness: 'patch is incorrect',
    }

    const result = formatReviewForContext({
      output: incorrect,
      cwd,
      modelId: 'test/model',
    })

    expect(result).toContain('**The patch is incorrect**')
  })

  it('includes finding body as markdown paragraph', () => {
    const result = formatReviewForContext({
      output: { ...base, findings: [finding] },
      cwd,
      modelId: 'test/model',
    })

    expect(result).toContain('The function does not check for null.')
  })
})
