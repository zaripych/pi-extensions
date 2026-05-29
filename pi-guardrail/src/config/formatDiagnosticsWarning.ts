import type { PolicyDiagnostic } from './loadPolicy'

export function formatDiagnosticsWarning(
  diagnostics: readonly PolicyDiagnostic[]
): string {
  const ambiguities = diagnostics.filter(
    (d) => d.kind === 'cross-category-ambiguity'
  )
  const word = ambiguities.length === 1 ? 'ambiguity' : 'ambiguities'
  return `pi-guardrail: ${ambiguities.length} cross-category bash policy ${word} that specificity cannot resolve. Affected commands are treated as bash:unknown. Run /guardrail doctor for details.`
}
