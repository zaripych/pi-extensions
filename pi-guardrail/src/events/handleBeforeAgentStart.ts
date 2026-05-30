import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
} from '@earendil-works/pi-coding-agent'
import type { GuardrailRuntime } from '../types'
import { buildSystemPromptGuidance } from './buildSystemPromptGuidance'

export function handleBeforeAgentStart(params: {
  event: BeforeAgentStartEvent
  runtime: GuardrailRuntime
}): BeforeAgentStartEventResult | undefined {
  const guidance = buildSystemPromptGuidance({
    context: params.runtime.getContext(),
  })
  if (guidance === undefined) return undefined
  return { systemPrompt: `${params.event.systemPrompt}\n\n${guidance}` }
}
