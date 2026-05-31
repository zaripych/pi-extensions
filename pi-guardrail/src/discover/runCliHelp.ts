import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Safe process spawning, not shell interpolation: the cli string is tokenized
// and passed as an argv array to execFile, so discovered command names and
// flags are never re-interpreted by a shell. A per-invocation timeout bounds
// time; concurrency and depth limits live in discoverCliCommands.
const HELP_TIMEOUT_MS = 30_000
const HELP_MAX_BUFFER = 16 * 1024 * 1024

export async function runCliHelp(params: {
  cli: string
  path: readonly string[]
}): Promise<string> {
  const tokens = params.cli.split(/\s+/).filter((token) => token.length > 0)
  const [binary, ...baseArgs] = tokens
  if (binary === undefined) return ''
  const args = [...baseArgs, ...params.path, '--help']
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      encoding: 'utf-8',
      timeout: HELP_TIMEOUT_MS,
      maxBuffer: HELP_MAX_BUFFER,
    })
    return stdout || stderr || ''
  } catch (error) {
    return readStringProp(error, 'stdout') || readStringProp(error, 'stderr')
  }
}

function readStringProp(value: unknown, key: 'stdout' | 'stderr'): string {
  if (typeof value !== 'object' || value === null || !(key in value)) return ''
  const prop = Reflect.get(value, key)
  return typeof prop === 'string' ? prop : ''
}
