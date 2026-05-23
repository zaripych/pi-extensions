import { relative } from 'node:path'
import type { Finding, ReviewOutput } from './reviewOutputSchema'

function relativePath(absolutePath: string, cwd: string): string {
  const rel = relative(cwd, absolutePath)
  return rel || absolutePath
}

function formatFinding(finding: Finding, cwd: string): string {
  const loc = finding.code_location
  const filePath = relativePath(loc.absolute_file_path, cwd)
  const lineRange =
    loc.line_range.start === loc.line_range.end
      ? `line ${loc.line_range.start}`
      : `lines ${loc.line_range.start}–${loc.line_range.end}`
  const priority =
    finding.priority !== undefined ? `[P${finding.priority}] ` : ''

  const parts = [
    `#### ${priority}${finding.title}`,
    `**File:** \`${filePath}\`, ${lineRange}`,
    '',
    finding.body,
  ]

  return parts.join('\n')
}

export function formatReviewForContext(params: {
  output: ReviewOutput
  cwd: string
  modelId: string
}): string {
  const { output, cwd, modelId } = params

  const verdict =
    output.overall_correctness === 'patch is correct'
      ? '**The patch is correct**'
      : '**The patch is incorrect**'

  const parts = [
    `## Code Review (${modelId})`,
    '',
    `### Overall Assessment: ${verdict} — confidence ${output.overall_confidence_score}`,
    '',
    output.overall_explanation,
  ]

  if (output.findings.length > 0) {
    parts.push('', '---', '', '### Findings')
    for (const finding of output.findings) {
      parts.push('', formatFinding(finding, cwd), '', '---')
    }
  }

  return parts.join('\n')
}
