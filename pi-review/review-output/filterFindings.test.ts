import { describe, expect, it } from 'vitest'
import { filterFindings } from './filterFindings'
import type { ReviewOutput } from './reviewOutputSchema'

const baseFinding = {
  title: 'Fix null check',
  body: 'Missing null check.',
  confidence_score: 0.8,
  priority: 1 as const,
  code_location: {
    absolute_file_path: '/src/user.ts',
    line_range: { start: 10, end: 12 },
  },
}

const baseOutput: ReviewOutput = {
  findings: [baseFinding],
  overall_correctness: 'patch is correct',
  overall_explanation: 'Looks good.',
  overall_confidence_score: 0.9,
}

describe('filterFindings', () => {
  it('drops findings below minConfidence', () => {
    const result = filterFindings({
      output: baseOutput,
      thresholds: { minConfidence: 0.9, maxPriority: 3 },
    })

    expect(result.findings).toEqual([])
  })

  it('drops findings above maxPriority', () => {
    const p3Finding = { ...baseFinding, priority: 3 as const }
    const result = filterFindings({
      output: { ...baseOutput, findings: [baseFinding, p3Finding] },
      thresholds: { minConfidence: 0, maxPriority: 2 },
    })

    expect(result.findings).toEqual([baseFinding])
  })

  it('treats missing priority as P3 for filtering', () => {
    const { priority: _p, ...noPriority } = baseFinding
    const result = filterFindings({
      output: { ...baseOutput, findings: [noPriority] },
      thresholds: { minConfidence: 0, maxPriority: 2 },
    })

    expect(result.findings).toEqual([])
  })

  it('keeps findings when missing priority and maxPriority is 3', () => {
    const { priority: _p, ...noPriority } = baseFinding
    const result = filterFindings({
      output: { ...baseOutput, findings: [noPriority] },
      thresholds: { minConfidence: 0, maxPriority: 3 },
    })

    expect(result.findings).toEqual([noPriority])
  })

  it('preserves non-finding fields unchanged', () => {
    const result = filterFindings({
      output: baseOutput,
      thresholds: { minConfidence: 0, maxPriority: 3 },
    })

    expect(result).toEqual(baseOutput)
  })
})
