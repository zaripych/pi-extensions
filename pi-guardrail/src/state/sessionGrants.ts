import type { BashClassification } from '../bash/bashClassifier'

export type GrantableBashClassification = Exclude<
  BashClassification,
  'bash:unknown'
>

export type SessionGrants = {
  hasExactCommand: (params: { command: string }) => boolean
  grantExactCommand: (params: { command: string }) => void
  hasClassification: (params: {
    classification: BashClassification
  }) => boolean
  grantClassification: (params: {
    classification: GrantableBashClassification
  }) => void
}

export function createSessionGrants(): SessionGrants {
  const exactCommands = new Set<string>()
  const classifications = new Set<GrantableBashClassification>()
  return {
    hasExactCommand: ({ command }) => exactCommands.has(command),
    grantExactCommand: ({ command }) => {
      exactCommands.add(command)
    },
    hasClassification: ({ classification }) =>
      classification !== 'bash:unknown' && classifications.has(classification),
    grantClassification: ({ classification }) => {
      classifications.add(classification)
    },
  }
}
