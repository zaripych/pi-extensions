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
    pi: params.pi,
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
  params.pi.registerCommand('read-only', {
    description: 'Alias for /guardrail read-only.',
    handler: async (_args, ctx) => {
      await guardrail.handleGuardrailCommand({ args: 'read-only', ctx })
    },
  })
  params.pi.registerCommand('hand-hold', {
    description: 'Alias for /guardrail hand-hold.',
    handler: async (_args, ctx) => {
      await guardrail.handleGuardrailCommand({ args: 'hand-hold', ctx })
    },
  })
}

registerGuardrail.defaultDeps = defaultDeps
