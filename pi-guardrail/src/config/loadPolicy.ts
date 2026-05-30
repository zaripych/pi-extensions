import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import {
  type BashEntry,
  type BashGroups,
  entrySpecificity,
  matchesBashEntry,
  prefixTokens,
  tokenPresent,
} from '../bash/bashClassifier'
import type { ActiveGuardrailMode } from '../types'
import { defaultPolicyYaml } from './defaultPolicyYaml'

export { defaultPolicyYaml }

export type ModeAction = 'allow' | 'ask' | 'deny'

export type ModeActions = ReadonlyMap<string, ModeAction>

export type PolicyData = {
  readonly modes: Readonly<Record<'read-only' | 'hand-hold', ModeActions>>
  readonly bashGroups: BashGroups
}

export type BashCategory = 'read' | 'write' | 'dangerous'

export type BashEntryLocation = {
  readonly category: BashCategory
  readonly groupName: string
  readonly groupIndex: number
  readonly commandIndex: number
  readonly prefix: string
  readonly include: readonly string[]
  readonly exclude: readonly string[]
}

export type PolicyDiagnostic = {
  readonly kind: 'cross-category-ambiguity'
  readonly entries: readonly BashEntryLocation[]
}

export type PolicyLoadResult =
  | {
      readonly status: 'ok'
      readonly policy: PolicyData
      readonly diagnostics: readonly PolicyDiagnostic[]
    }
  | { readonly status: 'error'; readonly error: string }

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const defaultDeps = {
  getConfigPath: () => join(getAgentDir(), 'guardrail.yaml'),
  readFile: (path: string) => readFile(path, 'utf-8'),
  writeFile: (path: string, content: string) =>
    writeFile(path, content, 'utf-8'),
  mkdir: (path: string) => mkdir(path, { recursive: true }),
  fileExists,
}

export async function loadPolicy(
  deps = defaultDeps
): Promise<PolicyLoadResult> {
  const configPath = deps.getConfigPath()

  let yamlContent: string
  try {
    if (!(await deps.fileExists(configPath))) {
      await deps.mkdir(dirname(configPath))
      await deps.writeFile(configPath, defaultPolicyYaml)
      yamlContent = defaultPolicyYaml
    } else {
      yamlContent = await deps.readFile(configPath)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      status: 'error',
      error: `Could not read guardrail config at ${configPath}: ${message}`,
    }
  }

  let parsed: unknown
  try {
    parsed = parseYaml(yamlContent)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      status: 'error',
      error: `Could not parse guardrail config at ${configPath}: ${message}`,
    }
  }

  if (!isPolicyObject(parsed)) {
    return {
      status: 'error',
      error: `Invalid guardrail config at ${configPath}: top-level must be a YAML mapping.`,
    }
  }

  const schemaResult = policySchema.safeParse(parsed)
  if (!schemaResult.success) {
    return {
      status: 'error',
      error: `Invalid guardrail config at ${configPath}: ${formatZodError(schemaResult.error)}`,
    }
  }

  const built = buildPolicy({ raw: schemaResult.data, configPath })
  if ('error' in built) {
    return { status: 'error', error: built.error }
  }
  return {
    status: 'ok',
    policy: built.policy,
    diagnostics: built.diagnostics,
  }
}

export async function resetPolicyToDefault(
  deps = defaultDeps
): Promise<{ configPath: string }> {
  const configPath = deps.getConfigPath()
  await deps.mkdir(dirname(configPath))
  await deps.writeFile(configPath, defaultPolicyYaml)
  return { configPath }
}

resetPolicyToDefault.defaultDeps = defaultDeps

export type InspectPolicyResult =
  | { readonly status: 'missing'; readonly configPath: string }
  | {
      readonly status: 'read-error'
      readonly configPath: string
      readonly error: string
    }
  | {
      readonly status: 'ok'
      readonly configPath: string
      readonly policy: PolicyData
      readonly diagnostics: readonly PolicyDiagnostic[]
    }
  | {
      readonly status: 'error'
      readonly configPath: string
      readonly error: string
    }

export async function inspectPolicy(
  deps = defaultDeps
): Promise<InspectPolicyResult> {
  const configPath = deps.getConfigPath()
  if (!(await deps.fileExists(configPath))) {
    return { status: 'missing', configPath }
  }
  let yamlContent: string
  try {
    yamlContent = await deps.readFile(configPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      status: 'read-error',
      configPath,
      error: `Could not read guardrail config at ${configPath}: ${message}`,
    }
  }
  const result = validateAndBuildPolicy({ yamlContent, configPath })
  if (result.status === 'error') {
    return { status: 'error', configPath, error: result.error }
  }
  return {
    status: 'ok',
    configPath,
    policy: result.policy,
    diagnostics: result.diagnostics,
  }
}

function validateAndBuildPolicy(params: {
  yamlContent: string
  configPath: string
}): PolicyLoadResult {
  let parsed: unknown
  try {
    parsed = parseYaml(params.yamlContent)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      status: 'error',
      error: `Could not parse guardrail config at ${params.configPath}: ${message}`,
    }
  }
  if (!isPolicyObject(parsed)) {
    return {
      status: 'error',
      error: `Invalid guardrail config at ${params.configPath}: top-level must be a YAML mapping.`,
    }
  }
  const schemaResult = policySchema.safeParse(parsed)
  if (!schemaResult.success) {
    return {
      status: 'error',
      error: `Invalid guardrail config at ${params.configPath}: ${formatZodError(schemaResult.error)}`,
    }
  }
  const built = buildPolicy({
    raw: schemaResult.data,
    configPath: params.configPath,
  })
  if ('error' in built) {
    return { status: 'error', error: built.error }
  }
  return {
    status: 'ok',
    policy: built.policy,
    diagnostics: built.diagnostics,
  }
}

inspectPolicy.defaultDeps = defaultDeps

function isPolicyObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const VALID_BASH_CAPABILITIES = new Set([
  'bash:read',
  'bash:write',
  'bash:dangerous',
])

const bashCommandPrefixSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: 'bash command prefix must contain a non-whitespace token',
  })

const bashCommandEntrySchema = z.union([
  bashCommandPrefixSchema,
  z
    .object({
      command: bashCommandPrefixSchema,
      include: z.array(z.string().min(1)).optional(),
      exclude: z.array(z.string().min(1)).optional(),
    })
    .strict(),
])

const bashGroupSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    commands: z.array(bashCommandEntrySchema).min(1),
  })
  .strict()

const modeSchema = z
  .object({
    allow: z.array(z.string().min(1)).default([]),
    ask: z.array(z.string().min(1)).default([]),
    deny: z.array(z.string().min(1)).default([]),
  })
  .strict()

const policySchema = z
  .object({
    modes: z
      .object({
        'read-only': modeSchema,
        'hand-hold': modeSchema,
      })
      .strict(),
    bash: z
      .object({
        read: z.array(bashGroupSchema).default([]),
        write: z.array(bashGroupSchema).default([]),
        dangerous: z.array(bashGroupSchema).default([]),
      })
      .strict(),
  })
  .strict()

type RawPolicy = z.infer<typeof policySchema>

function buildPolicy(params: {
  raw: RawPolicy
  configPath: string
}):
  | { policy: PolicyData; diagnostics: readonly PolicyDiagnostic[] }
  | { error: string } {
  const readOnly = buildModeActions({
    modeName: 'read-only',
    raw: params.raw.modes['read-only'],
  })
  if ('error' in readOnly) {
    return {
      error: `Invalid guardrail config at ${params.configPath}: ${readOnly.error}`,
    }
  }
  const handHold = buildModeActions({
    modeName: 'hand-hold',
    raw: params.raw.modes['hand-hold'],
  })
  if ('error' in handHold) {
    return {
      error: `Invalid guardrail config at ${params.configPath}: ${handHold.error}`,
    }
  }
  const bashResult = buildBashClassification({ raw: params.raw.bash })
  return {
    policy: {
      modes: {
        'read-only': readOnly.actions,
        'hand-hold': handHold.actions,
      },
      bashGroups: bashResult.bashGroups,
    },
    diagnostics: bashResult.diagnostics,
  }
}

type LocatedBashEntry = {
  readonly category: BashCategory
  readonly location: BashEntryLocation
  readonly entry: BashEntry
}

function buildBashClassification(params: { raw: RawPolicy['bash'] }): {
  bashGroups: BashGroups
  diagnostics: readonly PolicyDiagnostic[]
} {
  const items: LocatedBashEntry[] = []
  const categories: BashCategory[] = ['read', 'write', 'dangerous']
  for (const category of categories) {
    params.raw[category].forEach((group, groupIndex) => {
      group.commands.forEach((rawEntry, commandIndex) => {
        const entry =
          typeof rawEntry === 'string'
            ? { prefix: rawEntry, include: [], exclude: [] }
            : {
                prefix: rawEntry.command,
                include: rawEntry.include ?? [],
                exclude: rawEntry.exclude ?? [],
              }
        items.push({
          category,
          location: {
            category,
            groupName: group.name,
            groupIndex,
            commandIndex,
            prefix: entry.prefix,
            include: entry.include,
            exclude: entry.exclude,
          },
          entry,
        })
      })
    })
  }

  const diagnostics: PolicyDiagnostic[] = []
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]
      const b = items[j]
      if (a === undefined || b === undefined) continue
      if (a.category === b.category) continue
      if (!isCrossCategoryAmbiguity(a.entry, b.entry)) continue
      diagnostics.push({
        kind: 'cross-category-ambiguity',
        entries: [a.location, b.location],
      })
    }
  }

  const bashGroups: BashGroups = {
    read: toBashEntries({ category: 'read', items }),
    write: toBashEntries({ category: 'write', items }),
    dangerous: toBashEntries({ category: 'dangerous', items }),
  }

  return { bashGroups, diagnostics }
}

// Two cross-category entries are statically ambiguous when their specificity
// is equal (a tie specificity cannot resolve) and they can co-match. Co-match
// detection reuses the runtime matcher instead of re-deriving include/exclude
// semantics: we synthesize the smallest candidate command that could match
// both entries and ask matchesBashEntry whether it does. The candidate is the
// longer entry's prefix plus, per entry, any include token its own remaining
// window does not already carry.
function isCrossCategoryAmbiguity(a: BashEntry, b: BashEntry): boolean {
  if (entrySpecificity(a) !== entrySpecificity(b)) return false
  const ordered = orderByPrefix({
    a: { entry: a, tokens: prefixTokens(a.prefix) },
    b: { entry: b, tokens: prefixTokens(b.prefix) },
  })
  if (ordered === undefined) return false
  const parts = [...ordered.longer.tokens]
  appendMissingIncludes({ parts, entry: a })
  appendMissingIncludes({ parts, entry: b })
  return (
    matchesBashEntry({ parts, entry: a }) &&
    matchesBashEntry({ parts, entry: b })
  )
}

// An include is satisfied only when it appears after that entry's own prefix,
// so missing includes are filled against the entry's own remaining window.
function appendMissingIncludes(params: {
  parts: string[]
  entry: BashEntry
}): void {
  const prefix = prefixTokens(params.entry.prefix)
  for (const include of params.entry.include) {
    if (!tokenPresent(params.parts.slice(prefix.length), include)) {
      params.parts.push(include)
    }
  }
}

type PrefixedEntry = { entry: BashEntry; tokens: readonly string[] }

function orderByPrefix(params: {
  a: PrefixedEntry
  b: PrefixedEntry
}): { shorter: PrefixedEntry; longer: PrefixedEntry } | undefined {
  if (isTokenPrefix(params.a.tokens, params.b.tokens)) {
    return { shorter: params.a, longer: params.b }
  }
  if (isTokenPrefix(params.b.tokens, params.a.tokens)) {
    return { shorter: params.b, longer: params.a }
  }
  return undefined
}

function isTokenPrefix(
  shorter: readonly string[],
  longer: readonly string[]
): boolean {
  if (shorter.length > longer.length) return false
  return shorter.every((token, index) => token === longer[index])
}

function toBashEntries(params: {
  category: BashCategory
  items: readonly LocatedBashEntry[]
}): readonly BashEntry[] {
  return params.items
    .filter((item) => item.category === params.category)
    .map((item) => item.entry)
}

function buildModeActions(params: {
  modeName: ActiveGuardrailMode
  raw: { allow: string[]; ask: string[]; deny: string[] }
}): { actions: ModeActions } | { error: string } {
  const actions = new Map<string, ModeAction>()
  const lists: { list: ModeAction; values: string[] }[] = [
    { list: 'allow', values: params.raw.allow },
    { list: 'ask', values: params.raw.ask },
    { list: 'deny', values: params.raw.deny },
  ]
  for (const { list, values } of lists) {
    for (const capability of values) {
      const validation = validateCapability(capability)
      if (validation !== undefined) {
        return {
          error: `mode "${params.modeName}".${list} contains ${validation}.`,
        }
      }
      if (actions.has(capability)) {
        return {
          error: `mode "${params.modeName}" lists capability "${capability}" in more than one of allow/ask/deny.`,
        }
      }
      actions.set(capability, list)
    }
  }
  return { actions }
}

function validateCapability(capability: string): string | undefined {
  if (capability === 'bash') {
    return 'bare "bash" capability (use bash:read, bash:write, or bash:dangerous)'
  }
  if (capability === 'bash:unknown') {
    return '"bash:unknown" which is reserved and cannot appear in mode lists'
  }
  if (capability.startsWith('bash:') && !VALID_BASH_CAPABILITIES.has(capability)) {
    return `unrecognised bash capability "${capability}"`
  }
  return undefined
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ')
}

loadPolicy.defaultDeps = defaultDeps
