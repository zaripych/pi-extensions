import type { GuardrailFlagValue } from '../types'

export type ParsedGuardrailFlag =
  | { kind: 'ok'; value: GuardrailFlagValue }
  | { kind: 'error'; error: string }

const validValues = [
  'read-only',
  'hand-hold',
  'off',
] satisfies GuardrailFlagValue[]

function isGuardrailFlagValue(value: string): value is GuardrailFlagValue {
  for (const valid of validValues) {
    if (value === valid) return true
  }
  return false
}

export function parseGuardrailFlag(
  guardrailFlag: string | boolean | undefined
): ParsedGuardrailFlag {
  if (typeof guardrailFlag === 'undefined') {
    return { kind: 'ok', value: 'hand-hold' }
  }
  if (typeof guardrailFlag !== 'string') {
    return {
      kind: 'error',
      error: 'Invalid --guardrail value (expected a string).',
    }
  }
  if (isGuardrailFlagValue(guardrailFlag)) {
    return { kind: 'ok', value: guardrailFlag }
  }
  return {
    kind: 'error',
    error: `Invalid --guardrail value "${guardrailFlag}". Expected one of: ${validValues.join(', ')}.`,
  }
}
