import { stringify as stringifyYaml } from 'yaml'
import { classifyDiscoveredVerb } from './classifyDiscoveredVerb'
import type { DiscoveredCommand } from './discoverCliCommands'

// Serializes a single value as a YAML scalar, quoting/escaping it when the
// value would otherwise be parsed as a non-string (e.g. `false`, `42`) or
// would break the document (e.g. names containing `#`, `: `, `[`).
function yamlScalar(value: string): string {
  return stringifyYaml(value, { lineWidth: 0 }).replace(/\n$/, '')
}

// Emits a per-command import-file (the shape `bash.import` files use): a
// `command`/`description` header, flat read/write/dangerous lists, and a
// commented block of unknown commands. dangerous is never inferred from
// discovery, so it is always emitted empty for the user to fill in.
export function formatDiscoveryReport(params: {
  cli: string
  commands: readonly DiscoveredCommand[]
}): string {
  const { cli } = params
  const read: string[] = []
  const write: string[] = []
  const unknown: string[] = []
  for (const command of params.commands) {
    const full = `${cli} ${command.path.join(' ')}`
    const classification = classifyDiscoveredVerb(command.path)
    if (classification === 'read') read.push(full)
    else if (classification === 'write') write.push(full)
    else unknown.push(full)
  }

  const lines: string[] = [
    `command: ${yamlScalar(cli)}`,
    `description: ${yamlScalar(`${cli} commands discovered from --help and heuristically classified. Review before importing.`)}`,
    ...formatList('read', read),
    ...formatList('write', write),
    'dangerous: []',
    '',
  ]

  if (unknown.length === 0) {
    lines.push(`# No unknown commands discovered for ${cli}.`)
    return lines.join('\n')
  }
  lines.push(`# Unknown commands discovered for ${cli}.`)
  lines.push('# Review manually before assigning any command to read, write, or dangerous.')
  lines.push('# unknown:')
  for (const command of unknown) {
    lines.push(`#   - ${yamlScalar(command)}`)
  }
  return lines.join('\n')
}

function formatList(key: string, commands: readonly string[]): string[] {
  if (commands.length === 0) return [`${key}: []`]
  return [`${key}:`, ...commands.map((command) => `  - ${yamlScalar(command)}`)]
}
