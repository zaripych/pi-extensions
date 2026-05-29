import type {
  BashToolCallEvent,
  ExtensionContext,
  ToolCallEventResult,
} from '@earendil-works/pi-coding-agent'
import { block } from '../block'
import type { PolicyData } from '../config/loadPolicy'
import type { SessionGrants } from '../state/sessionGrants'
import type { ActiveGuardrailMode } from '../types'
import { decideBashCommand } from './decideBashCommand'

export async function decideBashCall(params: {
  event: BashToolCallEvent
  ctx: ExtensionContext
  mode: ActiveGuardrailMode
  policy: PolicyData
  sessionGrants: SessionGrants
}): Promise<ToolCallEventResult | undefined> {
  const decision = decideBashCommand({
    command: params.event.input.command,
    mode: params.mode,
    policy: params.policy,
    sessionGrants: params.sessionGrants,
  })

  if (decision.kind === 'allow') return undefined
  if (decision.kind === 'deny') {
    return block(decision.reasonCode, decision.reason)
  }
  if (!params.ctx.hasUI) return block('no-ui', decision.noUIReason)

  const labels = decision.choices.map((choice) => choice.label)
  const picked = await params.ctx.ui.select(decision.promptTitle, labels)
  const chosen = decision.choices.find((choice) => choice.label === picked)
  if (chosen === undefined) {
    return block('user-declined', decision.declinedReason)
  }
  if (chosen.kind === 'allow-once') return undefined
  if (chosen.kind === 'allow-exact') {
    params.sessionGrants.grantExactCommand({ command: chosen.command })
    return undefined
  }
  if (chosen.kind === 'allow-classification') {
    params.sessionGrants.grantClassification({
      classification: chosen.classification,
    })
    return undefined
  }
  return block('user-declined', decision.declinedReason)
}
