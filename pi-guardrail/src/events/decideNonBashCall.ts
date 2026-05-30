import type {
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
} from '@earendil-works/pi-coding-agent'
import { block } from '../block'
import type { PolicyData } from '../config/loadPolicy'
import type { SessionGrants } from '../state/sessionGrants'
import type { ActiveGuardrailMode } from '../types'

const ABORT_LABEL = 'Abort'
const ALLOW_ONCE_LABEL = 'Allow once'
const ALLOW_TOOL_LABEL = 'Allow this tool for session'

export async function decideNonBashCall(params: {
  event: ToolCallEvent
  ctx: ExtensionContext
  mode: ActiveGuardrailMode
  policy: PolicyData
  sessionGrants: SessionGrants
}): Promise<ToolCallEventResult | undefined> {
  const { event, ctx, mode, policy, sessionGrants } = params
  const toolName = event.toolName
  const action = policy.modes[mode].get(toolName) ?? 'deny'

  if (action === 'allow') return undefined
  if (action === 'deny') {
    return block(
      'policy-deny',
      `Guardrail mode ${mode} denies tool "${toolName}".`
    )
  }

  if (sessionGrants.hasTool({ toolName })) return undefined

  if (!ctx.hasUI) {
    return block(
      'no-ui',
      `Guardrail mode ${mode} requires approval for tool "${toolName}", but no UI is available.`
    )
  }

  // Abort is first so an accidental default selection fails safe (declines)
  // rather than approving the tool call.
  const choices = [ABORT_LABEL, ALLOW_ONCE_LABEL, ALLOW_TOOL_LABEL]
  const picked = await ctx.ui.select(`Allow tool "${toolName}"?`, choices)
  if (picked === ALLOW_ONCE_LABEL) return undefined
  if (picked === ALLOW_TOOL_LABEL) {
    sessionGrants.grantTool({ toolName })
    return undefined
  }
  return block('user-declined', `User declined tool "${toolName}".`)
}
