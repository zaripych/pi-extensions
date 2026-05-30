import type { ModeAction, ModeActions } from '../config/loadPolicy'

const BASH_SUBSETS = ['bash:read', 'bash:write', 'bash:dangerous'] as const

function isVisible(action: ModeAction | undefined): boolean {
  return action === 'allow' || action === 'ask'
}

export function computeActiveTools(params: {
  registeredToolNames: readonly string[]
  modeActions: ModeActions
}): string[] {
  const bashVisible = BASH_SUBSETS.some((subset) =>
    isVisible(params.modeActions.get(subset))
  )
  return params.registeredToolNames.filter((toolName) => {
    if (toolName === 'bash') return bashVisible
    return isVisible(params.modeActions.get(toolName))
  })
}
