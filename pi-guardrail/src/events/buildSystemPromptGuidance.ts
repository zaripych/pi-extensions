import type {
  BashCategory,
  ModeAction,
  ModeActions,
  PolicyData,
} from '../config/loadPolicy'
import type { ActiveGuardrailMode, GuardrailContext } from '../types'

export function buildSystemPromptGuidance(params: {
  context: GuardrailContext
}): string | undefined {
  const { context } = params
  if (context.status === 'off') return undefined
  if (context.status === 'fail-closed' || context.status === 'policy-error') {
    return denyAllGuidance()
  }

  const actions = context.policy.modes[context.mode]
  const lines: string[] = [`Guardrail mode: ${context.mode}.`]

  appendToolSection({
    lines,
    heading: 'Tools allowed without approval:',
    tools: nonBashTools({ actions, action: 'allow' }),
  })
  appendToolSection({
    lines,
    heading: 'Tools that require approval:',
    tools: nonBashTools({ actions, action: 'ask' }),
  })
  appendToolSection({
    lines,
    heading: 'Tools that are denied:',
    tools: nonBashTools({ actions, action: 'deny' }),
  })

  appendBashSection({ lines, policy: context.policy, mode: context.mode, actions })

  if (context.mode === 'hand-hold') {
    lines.push('')
    lines.push(
      'When a tool call or bash command requires approval, do not issue it in parallel with any other approval-required action. Wait for the result before requesting another. If unsure whether a bash command is bash:read, assume it requires approval.'
    )
  }

  return lines.join('\n')
}

function appendToolSection(params: {
  lines: string[]
  heading: string
  tools: readonly string[]
}): void {
  if (params.tools.length === 0) return
  params.lines.push('')
  params.lines.push(params.heading)
  for (const tool of params.tools) {
    params.lines.push(`- ${tool}`)
  }
}

// The bash tool is a single tool whose commands are sorted into classifications
// (bash:read, bash:write, bash:dangerous, bash:unknown). Each classification's
// handling is governed by the active mode, so render it separately from the
// per-tool sections rather than as if it were a tool name.
function appendBashSection(params: {
  lines: string[]
  policy: PolicyData
  mode: ActiveGuardrailMode
  actions: ModeActions
}): void {
  const categories: { category: BashCategory; classification: string }[] = [
    { category: 'read', classification: 'bash:read' },
    { category: 'write', classification: 'bash:write' },
    { category: 'dangerous', classification: 'bash:dangerous' },
  ]
  const entryLines: string[] = []
  for (const { category, classification } of categories) {
    const action = params.actions.get(classification) ?? 'deny'
    for (const description of params.policy.bashGroupDescriptions[category]) {
      entryLines.push(
        `- ${classification} (${actionPhrase(action)}): ${description}`
      )
    }
  }
  const unknownAction = params.mode === 'hand-hold' ? 'ask' : 'deny'
  entryLines.push(
    `- bash:unknown (${actionPhrase(unknownAction)} by built-in guardrail behavior): any bash command that matches none of the classifications above.`
  )

  params.lines.push('')
  params.lines.push(
    'The bash tool runs shell commands. Each command is classified, and its classification decides how guardrail handles it:'
  )
  params.lines.push(...entryLines)
}

function nonBashTools(params: {
  actions: ModeActions
  action: ModeAction
}): readonly string[] {
  return [...params.actions.entries()]
    .filter(
      ([capability, action]) =>
        action === params.action && !capability.startsWith('bash:')
    )
    .map(([capability]) => capability)
}

function actionPhrase(action: ModeAction) {
  if (action === 'allow') return 'allowed without approval'
  if (action === 'ask') return 'requires approval'
  return 'denied'
}

function denyAllGuidance(): string {
  return 'Guardrail is in config-error deny-all mode. Every model tool call is denied until the configuration is fixed.'
}
