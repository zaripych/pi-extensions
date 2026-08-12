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
  overall_explanation: 'Looks good.',
  overall_confidence_score: 0.9,
}

describe('filterFindings', () => {
  it('drops findings below minConfidence', () => {
    const result = filterFindings({
      output: baseOutput,
      thresholds: { minConfidence: 0.9 },
    })

    expect(result.findings).toEqual([])
  })

  it('keeps findings at or above minConfidence', () => {
    const result = filterFindings({
      output: baseOutput,
      thresholds: { minConfidence: 0.8 },
    })

    expect(result.findings).toEqual([baseFinding])
  })

  it('preserves non-finding fields unchanged', () => {
    const result = filterFindings({
      output: baseOutput,
      thresholds: { minConfidence: 0 },
    })

    expect(result).toEqual(baseOutput)
  })
})
