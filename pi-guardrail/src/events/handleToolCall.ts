import type {
  BashToolCallEvent,
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
} from '@earendil-works/pi-coding-agent'
import { decideBashCall } from '../bash/decideBashCall'
import { block } from '../block'
import { type GuardrailRuntime, isFailedContext } from '../types'

function isBashEvent(event: ToolCallEvent): event is BashToolCallEvent {
  return event.toolName === 'bash'
}

export async function handleToolCall(params: {
  event: ToolCallEvent
  ctx: ExtensionContext
  runtime: GuardrailRuntime
}): Promise<ToolCallEventResult | undefined> {
  const context = params.runtime.getContext()
  if (context.status === 'off') return undefined
  if (isFailedContext(context)) {
    return block('config-error', context.error)
  }

  if (isBashEvent(params.event)) {
    return decideBashCall({
      event: params.event,
      ctx: params.ctx,
      mode: context.mode,
      policy: context.policy,
      sessionGrants: context.sessionGrants,
    })
  }

  // Phase 5 will add full non-bash enforcement. Phase 0 tracer: read-only
  // explicitly denies "write".
  if (context.mode === 'read-only' && params.event.toolName === 'write') {
    return block(
      'policy-deny',
      `Guardrail mode read-only denies tool "${params.event.toolName}".`
    )
  }
  return undefined
}
