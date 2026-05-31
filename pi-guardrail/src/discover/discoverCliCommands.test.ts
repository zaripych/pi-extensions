import { describe, expect, it } from 'vitest'
import { setupDiscoverCliCommands } from './discoverCliCommands.harness'

describe('discoverCliCommands', () => {
  it('bounds recursion depth when every help output reports more subcommands', async () => {
    let deepestHelpPath = 0
    await using harness = await setupDiscoverCliCommands({
      // Every node claims to have a child subcommand, so an unbounded walk
      // would never terminate.
      runCliHelp: async ({ path }) => {
        deepestHelpPath = Math.max(deepestHelpPath, path.length)
        return 'Commands:\n  deeper   Go deeper\n'
      },
    })
    const { discoverCliCommands } = harness

    const commands = await discoverCliCommands({ cli: 'cyclic' })

    expect(commands).toHaveLength(1)
    expect(commands[0]?.path.length).toBeLessThanOrEqual(10)
    expect(deepestHelpPath).toBeLessThan(10)
  })

  it('probes subcommands in parallel but caps in-flight help invocations', async () => {
    const children = Array.from({ length: 30 }, (_, i) => `cmd${i}`)
    let inFlight = 0
    let maxInFlight = 0
    await using harness = await setupDiscoverCliCommands({
      runCliHelp: async ({ path }) => {
        if (path.length === 0) {
          return `Commands:\n${children.map((c) => `  ${c}   does ${c}`).join('\n')}\n`
        }
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await Promise.resolve()
        inFlight--
        return `usage: tool ${path.join(' ')}`
      },
    })
    const { discoverCliCommands } = harness

    const commands = await discoverCliCommands({ cli: 'tool' })

    expect(commands).toHaveLength(30)
    expect(maxInFlight).toBeGreaterThan(1)
    expect(maxInFlight).toBeLessThanOrEqual(8)
  })

  it('caps in-flight help invocations globally across nested recursion levels', async () => {
    const groups = Array.from({ length: 8 }, (_, i) => `group${i}`)
    const leaves = Array.from({ length: 20 }, (_, i) => `leaf${i}`)
    let inFlight = 0
    let maxInFlight = 0
    await using harness = await setupDiscoverCliCommands({
      runCliHelp: async ({ path }) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        try {
          await Promise.resolve()
          if (path.length === 0) {
            return `Commands:\n${groups.map((g) => `  ${g}   ${g}`).join('\n')}\n`
          }
          if (path.length === 1) {
            return `Commands:\n${leaves.map((l) => `  ${l}   ${l}`).join('\n')}\n`
          }
          return `usage: tool ${path.join(' ')}`
        } finally {
          inFlight--
        }
      },
    })
    const { discoverCliCommands } = harness

    const commands = await discoverCliCommands({ cli: 'tool' })

    expect(commands).toHaveLength(groups.length * leaves.length)
    expect(maxInFlight).toBeGreaterThan(1)
    expect(maxInFlight).toBeLessThanOrEqual(8)
  })
})
