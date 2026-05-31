import type { PolicyDiagnostic } from './loadPolicy'

export function formatDiagnosticsWarning(
  diagnostics: readonly PolicyDiagnostic[]
): string {
  const count = diagnostics.length
  const word = count === 1 ? 'issue' : 'issues'
  return `pi-guardrail: ${count} bash policy ${word} detected. Affected commands are treated as bash:unknown. Run /guardrail doctor for details.`
}
