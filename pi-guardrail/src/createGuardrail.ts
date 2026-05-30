import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolCallEvent,
} from '@earendil-works/pi-coding-agent'
import { parseGuardrailFlag } from './cli-args/parseGuardrailFlag'
import { handleGuardrailCommand } from './commands/handleGuardrailCommand'
import { formatDiagnosticsWarning } from './config/formatDiagnosticsWarning'
import { loadPolicy } from './config/loadPolicy'
import { handleBeforeAgentStart } from './events/handleBeforeAgentStart'
import { handleToolCall } from './events/handleToolCall'
import { computeActiveTools } from './state/computeActiveTools'
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

type GuardrailPi = Pick<
  ExtensionAPI,
  'getAllTools' | 'setActiveTools' | 'getActiveTools'
>

export async function createGuardrail(
  params: {
    guardrailFlag: string | boolean | undefined
    pi: GuardrailPi
  },
  deps = defaultDeps
) {
  let context: GuardrailContext = { status: 'off' }

  // The active tool set as it was before guardrail first narrowed it. Captured
  // once, just before the first narrowing, so `/guardrail off` can restore what
  // the user had before guardrail activated.
  let baselineActiveTools: readonly string[] | undefined

  // pi's runtime-bound action methods (getAllTools/setActiveTools) throw during
  // extension loading, so the load path must not touch them. It only loads the
  // policy into context; the initial active-tool narrowing happens at
  // session_start, and command-time mode changes narrow immediately.
  async function loadPolicyIntoContext(params: {
    mode: ActiveGuardrailMode
  }): Promise<void> {
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

  function applyActiveTools(): void {
    if (context.status === 'off') return
    if (baselineActiveTools === undefined) {
      baselineActiveTools = params.pi.getActiveTools()
    }
    if (isFailedContext(context)) {
      params.pi.setActiveTools([])
      return
    }
    const registeredToolNames = params.pi.getAllTools().map((tool) => tool.name)
    params.pi.setActiveTools(
      computeActiveTools({
        registeredToolNames,
        modeActions: context.policy.modes[context.mode],
      })
    )
  }

  async function enable(params: { mode: ActiveGuardrailMode }): Promise<void> {
    await loadPolicyIntoContext({ mode: params.mode })
    applyActiveTools()
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
    applyActiveTools()
  }

  function disable(): void {
    if (baselineActiveTools !== undefined) {
      const registered = new Set(
        params.pi.getAllTools().map((tool) => tool.name)
      )
      params.pi.setActiveTools(
        baselineActiveTools.filter((name) => registered.has(name))
      )
    }
    // Drop the baseline so the next activation recaptures whatever tools are
    // active then, preserving user/extension changes made while guardrail off.
    baselineActiveTools = undefined
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
    await loadPolicyIntoContext({ mode: flag.value })
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
    handleBeforeAgentStart: (params: { event: BeforeAgentStartEvent }) =>
      handleBeforeAgentStart({ ...params, runtime }),
    handleSessionStart(params: { ctx: ExtensionContext }) {
      const current = runtime.getContext()
      applyActiveTools()
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
