// Recursive --help discovery adapted from ~/Projects/assist (MIT-licensed)
// permitCliReads/discoverAll. Walks a CLI's subcommand tree by parsing each
// node's --help output, bounded by depth and concurrency limits.
import { hasHelpSubcommands, parseHelpCommands } from './parseHelpCommands'
import { runCliHelp } from './runCliHelp'

const MAX_DEPTH = 10
const CONCURRENCY = 8

export type DiscoveredCommand = {
  readonly path: readonly string[]
  readonly description: string
}

const defaultDeps = {
  runCliHelp,
}

export async function discoverCliCommands(
  params: { cli: string },
  deps = defaultDeps
): Promise<DiscoveredCommand[]> {
  const { cli } = params

  // A single limiter gates every help process across the whole traversal, so
  // recursive fan-out never exceeds CONCURRENCY simultaneous execFile calls,
  // regardless of how many recursion levels are in flight at once.
  const limiter = createLimiter(CONCURRENCY)
  const help = (path: readonly string[]): Promise<string> =>
    limiter(() => deps.runCliHelp({ cli, path }))

  async function discoverAt({
    parentPath,
    helpText,
  }: {
    parentPath: readonly string[]
    helpText: string
  }): Promise<DiscoveredCommand[]> {
    if (!helpText) return []
    const commands = parseHelpCommands(helpText)
    const resolved = await Promise.all(
      commands.map(async (command) => {
        const path = [...parentPath, command.name]
        if (path.length >= MAX_DEPTH) {
          return [{ path, description: command.description }]
        }
        const subHelp = await help(path)
        if (!subHelp || !hasHelpSubcommands(subHelp)) {
          return [{ path, description: command.description }]
        }
        const children = await discoverAt({
          parentPath: path,
          helpText: subHelp,
        })
        return children.length > 0
          ? children
          : [{ path, description: command.description }]
      })
    )
    return resolved.flat()
  }

  return discoverAt({ parentPath: [], helpText: await help([]) })
}

discoverCliCommands.defaultDeps = defaultDeps

type Limiter = <R>(fn: () => Promise<R>) => Promise<R>

function createLimiter(concurrency: number): Limiter {
  let active = 0
  const queue: (() => void)[] = []

  const release = () => {
    active--
    const next = queue.shift()
    if (next !== undefined) next()
  }

  return async <R>(fn: () => Promise<R>): Promise<R> => {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => {
        queue.push(resolve)
      })
    }
    active++
    try {
      return await fn()
    } finally {
      release()
    }
  }
}
