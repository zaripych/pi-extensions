// Bash classification adapted from ~/Projects/assist (MIT-licensed) cliHook /
// splitCompound logic. Tokenizes shell input via shell-quote, rejects unsafe
// redirects and unsupported shell constructs, splits compounds on shell
// connectors (&&, ||, ;, |), and prefix-matches each simple part against the
// effective policy.
import { tmpdir } from 'node:os'
import { posix as posixPath, win32 as win32Path } from 'node:path'
import { parse as parseShell } from 'shell-quote'

export type BashClassification =
  | 'bash:read'
  | 'bash:write'
  | 'bash:dangerous'
  | 'bash:unknown'

export type ClassifiedPart = {
  readonly command: string
  readonly classification: BashClassification
}

export type BashCompoundResult =
  | { readonly kind: 'parts'; readonly parts: readonly ClassifiedPart[] }
  | { readonly kind: 'unparseable' }

export type BashEntry = {
  readonly prefix: string
  readonly include: readonly string[]
  readonly exclude: readonly string[]
}

export type BashGroups = {
  readonly read: readonly BashEntry[]
  readonly write: readonly BashEntry[]
  readonly dangerous: readonly BashEntry[]
}

const FD_REDIRECT_RE = /\d+>&\d+/g
const FD_DEVNULL_RE = /\d*>(?:\/dev\/null|\$null)/g
// Matches escaped characters and single-quoted literals (both inert under
// bash expansion), or captures an unescaped backtick / `$(` (both expand
// even inside double quotes).
const UNSAFE_EXPANSION_RE = /\\.|'[^']*'|(`|\$\()/g

export function classifyBashCompound(params: {
  command: string
  bashGroups: BashGroups
}): BashCompoundResult {
  const groups = splitCompoundParts(params.command)
  if (groups === undefined) return { kind: 'unparseable' }
  const parts: ClassifiedPart[] = groups.map((group) => ({
    command: group.join(' '),
    classification: classifyParts({
      parts: group,
      bashGroups: params.bashGroups,
    }),
  }))
  return { kind: 'parts', parts }
}

// Cross-category overlaps are resolved by specificity (Phase 4.1): the
// matching entry with the highest specificity wins; a tie across different
// categories classifies the part as bash:unknown.
function classifyParts(params: {
  parts: readonly string[]
  bashGroups: BashGroups
}): BashClassification {
  const categories = [
    { name: 'bash:read' as const, entries: params.bashGroups.read },
    { name: 'bash:write' as const, entries: params.bashGroups.write },
    { name: 'bash:dangerous' as const, entries: params.bashGroups.dangerous },
  ]

  let best:
    | { specificity: number; classification: BashClassification; tie: boolean }
    | undefined
  for (const category of categories) {
    for (const entry of category.entries) {
      if (!matchesBashEntry({ parts: params.parts, entry })) continue
      const specificity = entrySpecificity(entry)
      if (best === undefined || specificity > best.specificity) {
        best = { specificity, classification: category.name, tie: false }
      } else if (
        specificity === best.specificity &&
        category.name !== best.classification
      ) {
        best = { ...best, tie: true }
      }
    }
  }

  if (best === undefined) return 'bash:unknown'
  return best.tie ? 'bash:unknown' : best.classification
}

export function entrySpecificity(entry: BashEntry): number {
  return (
    prefixTokens(entry.prefix).length +
    entry.include.length +
    entry.exclude.length
  )
}

export function matchesBashEntry(params: {
  parts: readonly string[]
  entry: BashEntry
}): boolean {
  const prefix = prefixTokens(params.entry.prefix)
  if (!matchesPrefixTokens(params.parts, prefix)) return false
  const remaining = params.parts.slice(prefix.length)
  for (const token of params.entry.include) {
    if (!tokenPresent(remaining, token)) return false
  }
  for (const token of params.entry.exclude) {
    if (tokenPresent(remaining, token)) return false
  }
  return true
}

// The entry's command tokens must match the start of the parsed static tokens
// token-by-token. Matching against parts.join(' ') would let a single quoted
// token (e.g. git "diff --output=foo.patch") satisfy multiple prefix words and
// hide arguments from the include/exclude checks.
function matchesPrefixTokens(
  parts: readonly string[],
  prefix: readonly string[]
): boolean {
  if (prefix.length > parts.length) return false
  return prefix.every((token, index) => token === parts[index])
}

export function prefixTokens(prefix: string): readonly string[] {
  return prefix.split(/\s+/).filter((token) => token.length > 0)
}

// Exact token matching with flag-assignment support: `--output` matches
// `--output` and `--output=patch`, but not `--not-output`; a bare token like
// `force` does not match `--force`.
export function tokenPresent(
  tokens: readonly string[],
  token: string
): boolean {
  return tokens.some((t) => t === token || t.startsWith(`${token}=`))
}

// Splits a (possibly compound) bash command into the static word tokens of
// each simple part, splitting on shell connectors (&&, ||, ;, |). Returns
// undefined when the command contains shell features the splitter cannot
// reason about (subshells, command substitution, unquoted backticks, unsafe
// redirects, glob patterns, etc.).
function splitCompoundParts(command: string): string[][] | undefined {
  const trimmed = command
    .trim()
    .replace(FD_DEVNULL_RE, '')
    .replace(FD_REDIRECT_RE, '')
  if (!trimmed) return undefined
  if (hasUnsafeShellExpansion(trimmed)) return undefined

  let tokens: ReturnType<typeof parseShell>
  try {
    tokens = parseShell(trimmed)
  } catch {
    return undefined
  }

  const groups: string[][] = []
  let current: string[] = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (typeof token === 'string') {
      current.push(token)
      continue
    }
    if (typeof token !== 'object' || token === null || !('op' in token)) {
      return undefined
    }
    const op = token.op
    // Guardrail read-only permits scratch writes under os.tmpdir(); project
    // write isolation remains the responsibility of pi-sandbox.
    if (op === '>' || op === '>>') {
      const next = tokens[i + 1]
      if (typeof next !== 'string') return undefined
      if (!isAllowedReadOnlyRedirectTarget(next)) return undefined
      const last = current[current.length - 1]
      if (last !== undefined && /^\d$/.test(last)) {
        current.pop()
      }
      i++
      continue
    }
    if (op === '&&' || op === '||' || op === ';' || op === '|') {
      if (current.length === 0) return undefined
      groups.push(current)
      current = []
      continue
    }
    // glob, command substitution, anything else — out of scope.
    return undefined
  }
  if (current.length > 0) groups.push(current)

  const result: string[][] = []
  for (const group of groups) {
    let envStart = 0
    while (envStart < group.length) {
      const head = group[envStart]
      if (head === undefined || !/^[A-Za-z_]\w*=/.test(head)) break
      envStart++
    }
    const stripped = envStart > 0 ? group.slice(envStart) : group
    if (stripped.length === 0) return undefined
    result.push(stripped)
  }

  if (result.length === 0) return undefined
  return result
}

function hasUnsafeShellExpansion(command: string): boolean {
  UNSAFE_EXPANSION_RE.lastIndex = 0
  for (
    let m = UNSAFE_EXPANSION_RE.exec(command);
    m !== null;
    m = UNSAFE_EXPANSION_RE.exec(command)
  ) {
    if (m[1] !== undefined) return true
  }
  return false
}

function isAllowedReadOnlyRedirectTarget(target: string): boolean {
  const tmp = tmpdir()
  if (/^[A-Za-z]:[\\/]/.test(tmp)) {
    if (!/^[A-Za-z]:[\\/]/.test(target)) return false
    const nTmp = normalizeWindowsPath(tmp)
    const nTarget = normalizeWindowsPath(target)
    return nTarget === nTmp || nTarget.startsWith(`${nTmp}\\`)
  }
  if (!target.startsWith('/')) return false
  const nTmp = posixPath.normalize(tmp).replace(/\/+$/, '')
  const nTarget = posixPath.normalize(target).replace(/\/+$/, '')
  return nTarget === nTmp || nTarget.startsWith(`${nTmp}/`)
}

function normalizeWindowsPath(p: string): string {
  return win32Path.normalize(p).toLowerCase().replace(/[\\/]+$/, '')
}
