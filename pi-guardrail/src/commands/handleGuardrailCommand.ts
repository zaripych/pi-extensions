import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { formatDiagnosticsWarning } from '../config/formatDiagnosticsWarning'
import {
  type InspectPolicyResult,
  inspectPolicy,
  type PolicyDiagnostic,
} from '../config/loadPolicy'
import { type GuardrailRuntime, isFailedContext } from '../types'

const defaultDeps = {
  inspectPolicy,
}

export async function handleGuardrailCommand(
  params: {
    args: string
    ctx: ExtensionCommandContext
    runtime: GuardrailRuntime
  },
  deps = defaultDeps
): Promise<void> {
  const { runtime } = params
  const subcommand = params.args.trim()

  if (subcommand === 'doctor') {
    const inspection = await deps.inspectPolicy()
    notifyDoctorResult({ ctx: params.ctx, inspection })
    return
  }

  if (subcommand === 'reload') {
    await runtime.reload()
    const reloaded = runtime.getContext()
    if (isFailedContext(reloaded)) {
      params.ctx.ui.notify(reloaded.error, 'error')
      return
    }
    if (reloaded.status === 'ready' && reloaded.diagnostics.length > 0) {
      params.ctx.ui.notify(
        formatDiagnosticsWarning(reloaded.diagnostics),
        'warning'
      )
    }
    return
  }

  if (subcommand === 'read-only' || subcommand === 'hand-hold') {
    const before = runtime.getContext()
    if (before.status === 'ready') {
      if (before.mode === subcommand) {
        params.ctx.ui.notify(
          `Guardrail is already in ${subcommand} mode.`,
          'info'
        )
        return
      }
      runtime.switchMode({ mode: subcommand })
      return
    }
    await runtime.enable({ mode: subcommand })
    const after = runtime.getContext()
    if (isFailedContext(after)) {
      params.ctx.ui.notify(after.error, 'error')
    }
    return
  }

  const context = runtime.getContext()
  if (context.status === 'off') return
  if (isFailedContext(context)) {
    params.ctx.ui.notify(context.error, 'error')
    return
  }
  params.ctx.ui.notify(
    `Unknown /guardrail subcommand: "${subcommand}".`,
    'error'
  )
}

handleGuardrailCommand.defaultDeps = defaultDeps

function notifyDoctorResult(params: {
  ctx: ExtensionCommandContext
  inspection: InspectPolicyResult
}): void {
  const { ctx, inspection } = params
  if (inspection.status === 'missing') {
    ctx.ui.notify(
      `pi-guardrail: no config file at ${inspection.configPath}. Startup or /guardrail reload would create the shipped default. (Doctor does not modify config.)`,
      'info'
    )
    return
  }
  if (inspection.status === 'read-error' || inspection.status === 'error') {
    ctx.ui.notify(
      `pi-guardrail doctor: config-error. Guardrail would deny every model tool call.\n\n${inspection.error}`,
      'error'
    )
    return
  }
  if (inspection.diagnostics.length === 0) {
    ctx.ui.notify(
      `pi-guardrail doctor: ok. Config at ${inspection.configPath}.`,
      'info'
    )
    return
  }
  ctx.ui.notify(
    formatDoctorWarningReport({
      configPath: inspection.configPath,
      diagnostics: inspection.diagnostics,
    }),
    'warning'
  )
}

function formatDoctorWarningReport(params: {
  configPath: string
  diagnostics: readonly PolicyDiagnostic[]
}): string {
  const ambiguities = params.diagnostics.filter(
    (d) => d.kind === 'cross-category-ambiguity'
  )
  const lines: string[] = []
  lines.push(
    `pi-guardrail doctor: ${ambiguities.length} cross-category bash policy ambiguit${ambiguities.length === 1 ? 'y' : 'ies'}.`
  )
  lines.push(`Config: ${params.configPath}`)
  lines.push('')
  ambiguities.forEach((ambiguity, index) => {
    lines.push(`Ambiguity ${index + 1} (cross-category):`)
    for (const entry of ambiguity.entries) {
      lines.push(`  ${formatEntryLine(entry)}`)
    }
    lines.push(
      '  Reason: these entries are co-matchable and tie on specificity, so a unique category cannot be selected. Matching commands are treated as bash:unknown.'
    )
    lines.push('')
  })
  return lines.join('\n')
}

function formatEntryLine(entry: PolicyDiagnostic['entries'][number]): string {
  const predicates: string[] = []
  if (entry.include.length > 0) {
    predicates.push(`include: [${entry.include.join(', ')}]`)
  }
  if (entry.exclude.length > 0) {
    predicates.push(`exclude: [${entry.exclude.join(', ')}]`)
  }
  const suffix = predicates.length > 0 ? ` (${predicates.join('; ')})` : ''
  return `bash.${entry.category}[${entry.groupName}].commands[${entry.commandIndex}]: ${entry.prefix}${suffix}`
}
