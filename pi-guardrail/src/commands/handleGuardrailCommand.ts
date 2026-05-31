import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { formatConfigErrorNotice } from '../config/formatConfigErrorNotice'
import { formatDiagnosticsWarning } from '../config/formatDiagnosticsWarning'
import {
  type BashEntryLocation,
  type InspectPolicyResult,
  importPolicyFileExists,
  inspectPolicy,
  type PolicyDiagnostic,
  resetPolicyToDefault,
  saveImportPolicyFile,
} from '../config/loadPolicy'
import { UnreachableError } from '../correctness/UnreachableError'
import { discoverCliCommands } from '../discover/discoverCliCommands'
import { formatDiscoveryReport } from '../discover/formatDiscoveryReport'
import {
  type GuardrailContext,
  type GuardrailRuntime,
  isFailedContext,
} from '../types'

const defaultDeps = {
  inspectPolicy,
  resetPolicyToDefault,
  discoverCliCommands,
  saveImportPolicyFile,
  importPolicyFileExists,
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

  if (subcommand === '' || subcommand === 'status') {
    notifyStatus({ ctx: params.ctx, context: runtime.getContext() })
    return
  }

  if (subcommand === 'discover' || subcommand.startsWith('discover ')) {
    const cli = subcommand.slice('discover'.length).trim()
    if (cli === '') {
      params.ctx.ui.notify('Usage: /guardrail discover <cli>', 'error')
      return
    }
    const commands = await deps.discoverCliCommands({ cli })
    if (commands.length === 0) {
      params.ctx.ui.notify(
        `pi-guardrail: no commands discovered for "${cli}".`,
        'info'
      )
      return
    }
    const report = formatDiscoveryReport({ cli, commands })
    params.ctx.ui.notify(report, 'info')
    if (!params.ctx.hasUI) return
    const { exists } = await deps.importPolicyFileExists({ cli })
    const saveLabel = exists ? 'Save - overwrite existing' : 'Save'
    const choice = await params.ctx.ui.select('Save discovered policy?', [
      saveLabel,
      'Abort',
    ])
    if (choice !== saveLabel) return
    const { path } = await deps.saveImportPolicyFile({ cli, content: report })
    params.ctx.ui.notify(
      `pi-guardrail: saved ${path}. Add it under bash.import in guardrail.yaml to use it.`,
      'info'
    )
    return
  }

  if (subcommand === 'reset-to-default') {
    const confirmed = await params.ctx.ui.confirm(
      'Reset guardrail policy?',
      'This overwrites ~/.pi/agent/guardrail.yaml with the shipped default. Your current policy will be lost.'
    )
    if (!confirmed) {
      params.ctx.ui.notify('pi-guardrail: reset-to-default cancelled.', 'info')
      return
    }
    const { configPath } = await deps.resetPolicyToDefault()
    params.ctx.ui.notify(
      `pi-guardrail: wrote the shipped default policy to ${configPath}. Run /guardrail reload to apply it.`,
      'info'
    )
    return
  }

  if (subcommand === 'off') {
    runtime.disable()
    params.ctx.ui.notify(
      'pi-guardrail: off. Enforcement is disabled for the model.',
      'info'
    )
    return
  }

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

function notifyStatus(params: {
  ctx: ExtensionCommandContext
  context: GuardrailContext
}): void {
  const { ctx, context } = params
  if (context.status === 'off') {
    ctx.ui.notify(
      'pi-guardrail: off. Enforcement is disabled for the model.',
      'info'
    )
    return
  }
  if (context.status === 'fail-closed') {
    ctx.ui.notify(
      `pi-guardrail: deny-all mode. Every model tool call is denied.\n\n${context.error}`,
      'error'
    )
    return
  }
  if (context.status === 'policy-error') {
    ctx.ui.notify(formatConfigErrorNotice({ error: context.error }), 'error')
    return
  }
  if (context.diagnostics.length > 0) {
    const count = context.diagnostics.length
    ctx.ui.notify(
      `pi-guardrail: mode ${context.mode}. ${count} configuration ${count === 1 ? 'issue' : 'issues'} flagged; run /guardrail doctor for details.`,
      'warning'
    )
    return
  }
  ctx.ui.notify(
    `pi-guardrail: mode ${context.mode}. Policy ok.`,
    'info'
  )
}

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
  const count = params.diagnostics.length
  const lines: string[] = []
  lines.push(
    `pi-guardrail doctor: ${count} bash policy issue${count === 1 ? '' : 's'}.`
  )
  lines.push(`Config: ${params.configPath}`)
  lines.push('')
  params.diagnostics.forEach((diagnostic, index) => {
    lines.push(...formatDiagnostic({ diagnostic, index }))
    lines.push('')
  })
  return lines.join('\n')
}

function formatDiagnostic(params: {
  diagnostic: PolicyDiagnostic
  index: number
}): string[] {
  const { diagnostic, index } = params
  const heading = `Issue ${index + 1}`
  if (diagnostic.kind === 'cross-category-ambiguity') {
    return [
      `${heading} (cross-category ambiguity):`,
      ...diagnostic.entries.map((entry) => `  ${formatEntryLine(entry)}`),
      '  Reason: these entries are co-matchable and tie on specificity, so a unique category cannot be selected. Matching commands are treated as bash:unknown.',
    ]
  }
  if (diagnostic.kind === 'import-prefix-violation') {
    return [
      `${heading} (import prefix violation):`,
      `  ${formatEntryLine(diagnostic.entry)}`,
      `  Reason: every command in this import must start with "${diagnostic.command}". This entry was ignored.`,
    ]
  }
  if (diagnostic.kind === 'duplicate-import-command') {
    return [
      `${heading} (duplicate import command):`,
      `  command: ${diagnostic.command}`,
      ...diagnostic.importPaths.map((path) => `  ${path}`),
      '  Reason: more than one import declares this command, so all of them were ignored.',
    ]
  }
  throw new UnreachableError(diagnostic)
}

function formatEntryLine(entry: BashEntryLocation): string {
  const predicates: string[] = []
  if (entry.include.length > 0) {
    predicates.push(`include: [${entry.include.join(', ')}]`)
  }
  if (entry.exclude.length > 0) {
    predicates.push(`exclude: [${entry.exclude.join(', ')}]`)
  }
  const suffix = predicates.length > 0 ? ` (${predicates.join('; ')})` : ''
  if (entry.importPath !== undefined) {
    return `import ${entry.importPath} (command ${entry.groupName}).${entry.category}.commands[${entry.commandIndex}]: ${entry.prefix}${suffix}`
  }
  return `bash.${entry.category}[${entry.groupName}].commands[${entry.commandIndex}]: ${entry.prefix}${suffix}`
}
