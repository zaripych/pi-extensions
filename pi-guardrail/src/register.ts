import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { createGuardrail } from './createGuardrail'

const defaultDeps = {
  createGuardrail,
}

export async function registerGuardrail(
  params: { pi: ExtensionAPI },
  deps = defaultDeps
): Promise<void> {
  params.pi.registerFlag('guardrail', {
    type: 'string',
    description: 'Guardrail mode: read-only | hand-hold | off',
  })

  const guardrail = await deps.createGuardrail({
    guardrailFlag: params.pi.getFlag('guardrail'),
  })

  params.pi.on('tool_call', (event, ctx) =>
    guardrail.handleToolCall({ event, ctx })
  )
  params.pi.on('session_start', (_event, ctx) => {
    guardrail.handleSessionStart({ ctx })
  })
  params.pi.registerCommand('guardrail', {
    description: 'Inspect or change the guardrail mode.',
    handler: async (args, ctx) => {
      await guardrail.handleGuardrailCommand({ args, ctx })
    },
  })
}

registerGuardrail.defaultDeps = defaultDeps
