import type { ReviewOutput } from './reviewOutputSchema'

export function filterFindings(params: {
  output: ReviewOutput
  thresholds: { minConfidence: number; maxPriority: number }
}): ReviewOutput {
  const { output, thresholds } = params
  return {
    ...output,
    findings: output.findings.filter(
      (f) =>
        f.confidence_score >= thresholds.minConfidence &&
        (f.priority ?? 3) <= thresholds.maxPriority
    ),
  }
}
