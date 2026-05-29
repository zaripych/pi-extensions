import type { ModeAction, PolicyData } from '../config/loadPolicy'
import type {
  GrantableBashClassification,
  SessionGrants,
} from '../state/sessionGrants'
import type { ActiveGuardrailMode } from '../types'
import {
  type BashClassification,
  type ClassifiedPart,
  classifyBashCompound,
} from './bashClassifier'

const ABORT_LABEL = 'Abort'
const ALLOW_ONCE_LABEL = 'Allow once'
const ALLOW_EXACT_LABEL = 'Allow exact command for session'

function allowClassificationLabel(classification: BashClassification): string {
  return `Allow ${classification} for session`
}

type BashAskChoice =
  | { readonly kind: 'allow-once'; readonly label: string }
  | {
      readonly kind: 'allow-exact'
      readonly label: string
      readonly command: string
    }
  | {
      readonly kind: 'allow-classification'
      readonly label: string
      readonly classification: GrantableBashClassification
    }
  | { readonly kind: 'abort'; readonly label: string }

type BashDecision =
  | { readonly kind: 'allow' }
  | {
      readonly kind: 'deny'
      readonly reasonCode: 'policy-deny'
      readonly reason: string
    }
  | {
      readonly kind: 'ask'
      readonly promptTitle: string
      readonly declinedReason: string
      readonly noUIReason: string
      readonly choices: readonly BashAskChoice[]
    }

export function decideBashCommand(params: {
  command: string
  mode: ActiveGuardrailMode
  policy: PolicyData
  sessionGrants: SessionGrants
}): BashDecision {
  const { command, mode, policy, sessionGrants } = params
  if (sessionGrants.hasExactCommand({ command })) return { kind: 'allow' }

  const compound = classifyBashCompound({
    command,
    bashGroups: policy.bashGroups,
  })
  const unparseable = compound.kind === 'unparseable'
  const classifiedParts: readonly ClassifiedPart[] =
    compound.kind === 'parts'
      ? compound.parts
      : [{ command, classification: 'bash:unknown' }]

  const actionedParts = classifiedParts.map((part) => {
    const baseAction = lookupBashAction({
      classification: part.classification,
      mode,
      policy,
    })
    const action: ModeAction =
      baseAction === 'ask' &&
      sessionGrants.hasClassification({ classification: part.classification })
        ? 'allow'
        : baseAction
    return { ...part, action }
  })

  const deniedPart = actionedParts.find((part) => part.action === 'deny')
  if (deniedPart !== undefined) {
    return {
      kind: 'deny',
      reasonCode: 'policy-deny',
      reason: bashDenyReason({
        mode,
        classification: deniedPart.classification,
        command: deniedPart.command,
      }),
    }
  }

  const askedParts = actionedParts.filter((part) => part.action === 'ask')
  if (askedParts.length === 0) return { kind: 'allow' }

  const askPart = askedParts[0]
  if (askPart === undefined) return { kind: 'allow' }

  const multipleAsks = askedParts.length > 1
  const promptTitle = multipleAsks
    ? `Allow compound command "${command}"?`
    : `Allow ${askPart.classification} command "${askPart.command}"?`
  const declinedReason = multipleAsks
    ? `User declined compound command "${command}".`
    : `User declined ${askPart.classification} command "${askPart.command}".`
  const noUIReason = multipleAsks
    ? `Guardrail mode ${mode} requires approval for compound command "${command}", but no UI is available.`
    : `Guardrail mode ${mode} requires approval for ${askPart.classification} command "${askPart.command}", but no UI is available.`

  // Abort is first so an accidental default selection fails safe (declines)
  // rather than approving a risky command, per the Phase 3 prompt contract.
  const choices: BashAskChoice[] = [
    { kind: 'abort', label: ABORT_LABEL },
    { kind: 'allow-once', label: ALLOW_ONCE_LABEL },
  ]
  if (!multipleAsks && !unparseable) {
    choices.push({
      kind: 'allow-exact',
      label: ALLOW_EXACT_LABEL,
      command,
    })
    if (askPart.classification !== 'bash:unknown') {
      choices.push({
        kind: 'allow-classification',
        label: allowClassificationLabel(askPart.classification),
        classification: askPart.classification,
      })
    }
  }

  return {
    kind: 'ask',
    promptTitle,
    declinedReason,
    noUIReason,
    choices,
  }
}

function lookupBashAction(params: {
  classification: BashClassification
  mode: ActiveGuardrailMode
  policy: PolicyData
}): ModeAction {
  if (params.classification === 'bash:unknown') {
    return params.mode === 'read-only' ? 'deny' : 'ask'
  }
  return params.policy.modes[params.mode].get(params.classification) ?? 'deny'
}

function bashDenyReason(params: {
  mode: ActiveGuardrailMode
  classification: BashClassification
  command: string
}): string {
  return `Guardrail mode ${params.mode} denies ${params.classification} command "${params.command}".`
}
