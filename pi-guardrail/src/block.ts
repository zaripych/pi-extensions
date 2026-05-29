import type { ToolCallEventResult } from '@earendil-works/pi-coding-agent'

export type GuardrailReasonCode =
  | 'policy-deny'
  | 'user-declined'
  | 'no-ui'
  | 'config-error'

// `reasonCode` is not part of pi's ToolCallEventResult contract. Pi reads
// `block` and `reason` only and ignores extra fields. We attach this code so
// tests can assert the structured cause of a block (and the human-readable
// `reason` text can drift freely without breaking them).
export type GuardrailBlockResult = ToolCallEventResult & {
  block: true
  reason: string
  reasonCode: GuardrailReasonCode
}

export function block(
  reasonCode: GuardrailReasonCode,
  reason: string
): GuardrailBlockResult {
  return { block: true, reason, reasonCode }
}
