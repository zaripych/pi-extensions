import type { PolicyData, PolicyDiagnostic } from './config/loadPolicy'
import type { SessionGrants } from './state/sessionGrants'

export type ActiveGuardrailMode = 'read-only' | 'hand-hold'

export type GuardrailFlagValue = ActiveGuardrailMode | 'off'

export type GuardrailContext =
  | {
      readonly status: 'off'
    }
  | {
      readonly status: 'ready'
      readonly mode: ActiveGuardrailMode
      readonly policy: PolicyData
      readonly diagnostics: readonly PolicyDiagnostic[]
      readonly sessionGrants: SessionGrants
    }
  | {
      readonly status: 'policy-error'
      readonly mode: ActiveGuardrailMode
      readonly error: string
    }
  | {
      readonly status: 'fail-closed'
      readonly error: string
    }

export type GuardrailRuntime = {
  getContext: () => GuardrailContext
  reload: () => Promise<void>
  switchMode: (params: { mode: ActiveGuardrailMode }) => void
  enable: (params: { mode: ActiveGuardrailMode }) => Promise<void>
  disable: () => void
}

export function isFailedContext(
  context: GuardrailContext
): context is Extract<
  GuardrailContext,
  { status: 'policy-error' | 'fail-closed' }
> {
  return context.status === 'policy-error' || context.status === 'fail-closed'
}
