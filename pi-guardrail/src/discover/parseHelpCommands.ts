// Help-text command parsing adapted from ~/Projects/assist (MIT-licensed)
// permitCliReads/parseCommands. Recognizes the "Commands:" style sections that
// most CLIs (git, gh, az, kubectl, ...) emit in their --help output.

// Matches command-section headers where "commands"/"subcommands"/"subgroups"
// is the last word before an optional parenthesized qualifier and optional
// colon. Covers plain "Commands:", qualified "Available Commands:", grouped
// kubectl-style "Deploy Commands:" / "Basic Commands (Beginner):", and
// "Subgroups:". Requiring the keyword to be the final word avoids matching
// prose lines such as "These are common Git commands used in ...:".
const COMMAND_SECTION_RE =
  /^(?:[\w()/-]+ )*(?:sub)?(?:commands|subgroups)(?: \([\w ]+\))?:?$/i

const COMMAND_SECTION_MULTILINE_RE = new RegExp(COMMAND_SECTION_RE.source, 'im')

export type ParsedHelpCommand = {
  readonly name: string
  readonly description: string
}

function isSkippable(name: string): boolean {
  return name.startsWith('-') || name.startsWith('<') || name.startsWith('[')
}

function matchCommandLine(
  trimmed: string,
  pattern: RegExp
): ParsedHelpCommand | undefined {
  const match = trimmed.match(pattern)
  const name = match?.[1]
  const description = match?.[2]
  if (name === undefined || description === undefined) return undefined
  if (isSkippable(name)) return undefined
  return { name, description: description.trim() }
}

function parseCommandLine(trimmed: string): ParsedHelpCommand | undefined {
  // Format: "name  [tag] : description" (az-style, tag + colon-space)
  const azMatch = matchCommandLine(trimmed, /^(\S+)\s+(?:\[.*?]\s+)?:\s*(.+)/)
  if (azMatch) return azMatch
  // Format: "name:  Description" (gh-style, colon after name)
  const colonMatch = matchCommandLine(trimmed, /^(\S+?):\s{2,}(.+)/)
  if (colonMatch) return colonMatch
  // Format: "name    Description" (standard, space-separated)
  const spaceMatch = matchCommandLine(trimmed, /^(\S+)(?:,\s*\S+)?\s{2,}(.+)/)
  if (spaceMatch) return spaceMatch
  // Bare command name with no description
  if (/^\S+$/.test(trimmed) && !isSkippable(trimmed)) {
    return { name: trimmed, description: '' }
  }
  return undefined
}

export function parseHelpCommands(helpText: string): ParsedHelpCommand[] {
  const commands: ParsedHelpCommand[] = []
  let inCommandSection = false

  for (const line of helpText.split('\n')) {
    const trimmed = line.trim()

    if (COMMAND_SECTION_RE.test(trimmed)) {
      inCommandSection = true
      continue
    }

    if (
      inCommandSection &&
      trimmed &&
      !line.startsWith(' ') &&
      !line.startsWith('\t')
    ) {
      inCommandSection = false
      continue
    }

    if (!inCommandSection || !trimmed) continue
    if (trimmed.startsWith('-') || trimmed.startsWith('=')) continue

    const parsed = parseCommandLine(trimmed)
    if (parsed) commands.push(parsed)
  }

  return commands
}

export function hasHelpSubcommands(helpText: string): boolean {
  return COMMAND_SECTION_MULTILINE_RE.test(helpText)
}
