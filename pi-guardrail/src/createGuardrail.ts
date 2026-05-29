import type {
  ExtensionCommandContext,
  ExtensionContext,
  ToolCallEvent,
} from '@earendil-works/pi-coding-agent'
import { parseGuardrailFlag } from './cli-args/parseGuardrailFlag'
import { handleGuardrailCommand } from './commands/handleGuardrailCommand'
import { formatDiagnosticsWarning } from './config/formatDiagnosticsWarning'
import { loadPolicy } from './config/loadPolicy'
import { handleToolCall } from './events/handleToolCall'
import { createSessionGrants } from './state/sessionGrants'
import {
  type ActiveGuardrailMode,
  type GuardrailContext,
  type GuardrailRuntime,
  isFailedContext,
} from './types'

const defaultDeps = {
  loadPolicy,
  handleGuardrailCommand,
}

export async function createGuardrail(
  params: { guardrailFlag: string | boolean | undefined },
  deps = defaultDeps
) {
  let context: GuardrailContext = { status: 'off' }

  async function enable(params: { mode: ActiveGuardrailMode }): Promise<void> {
    const result = await deps.loadPolicy()
    if (result.status === 'error') {
      context = { status: 'policy-error', mode: params.mode, error: result.error }
      return
    }
    context = {
      status: 'ready',
      mode: params.mode,
      policy: result.policy,
      diagnostics: result.diagnostics,
      sessionGrants: createSessionGrants(),
    }
  }

  function switchMode(params: { mode: ActiveGuardrailMode }): void {
    if (context.status !== 'ready') return
    if (context.mode === params.mode) return
    context = {
      status: 'ready',
      mode: params.mode,
      policy: context.policy,
      diagnostics: context.diagnostics,
      sessionGrants: createSessionGrants(),
    }
  }

  // Not yet wired to a /guardrail subcommand. Reserved for a future
  // `/guardrail off` that lets the user disable enforcement at runtime.
  function disable(): void {
    context = { status: 'off' }
  }

  async function reload(): Promise<void> {
    if (context.status === 'off' || context.status === 'fail-closed') return
    await enable({ mode: context.mode })
  }

  const flag = parseGuardrailFlag(params.guardrailFlag)
  if (flag.kind === 'error') {
    context = { status: 'fail-closed', error: flag.error }
  } else if (flag.value !== 'off') {
    await enable({ mode: flag.value })
  }

  const runtime: GuardrailRuntime = {
    getContext: () => context,
    reload,
    switchMode,
    enable,
    disable,
  }

  return {
    handleToolCall: (params: { event: ToolCallEvent; ctx: ExtensionContext }) =>
      handleToolCall({ ...params, runtime }),
    handleSessionStart(params: { ctx: ExtensionContext }) {
      const current = runtime.getContext()
      if (isFailedContext(current)) {
        params.ctx.ui.notify(current.error, 'error')
        return
      }
      if (current.status === 'ready' && current.diagnostics.length > 0) {
        params.ctx.ui.notify(
          formatDiagnosticsWarning(current.diagnostics),
          'warning'
        )
      }
    },
    handleGuardrailCommand: (params: {
      args: string
      ctx: ExtensionCommandContext
    }) => deps.handleGuardrailCommand({ ...params, runtime }),
  }
}

createGuardrail.defaultDeps = defaultDeps
