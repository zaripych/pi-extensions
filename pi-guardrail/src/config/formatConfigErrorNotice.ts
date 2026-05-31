export function formatConfigErrorNotice(params: { error: string }): string {
  return `pi-guardrail: invalid guardrail config — failing closed for safety. All model tool calls are denied. Fix guardrail.yaml and run /guardrail reload, or run /guardrail off to disable guardrail.\n\n${params.error}`
}
