import { describe, expect, it } from 'vitest'
import { hasHelpSubcommands, parseHelpCommands } from './parseHelpCommands'

const kubectlHelp = `kubectl controls the Kubernetes cluster manager.

Basic Commands (Beginner):
  create          Create a resource from a file or from stdin
  run             Run a particular image on the cluster

Deploy Commands:
  rollout         Manage the rollout of a resource
  scale           Set a new size for a deployment

Troubleshooting and Debugging Commands:
  describe        Show details of a specific resource
  logs            Print the logs for a container in a pod

Other Commands:
  api-resources   Print the supported API resources on the server
`

describe('parseHelpCommands', () => {
  it('parses grouped command-section headers (kubectl style)', () => {
    const names = parseHelpCommands(kubectlHelp).map((c) => c.name)

    expect(names).toEqual([
      'create',
      'run',
      'rollout',
      'scale',
      'describe',
      'logs',
      'api-resources',
    ])
  })

  it('detects subcommands in grouped command-section headers', () => {
    expect(hasHelpSubcommands(kubectlHelp)).toBe(true)
  })

  it('does not treat a prose line ending in "commands:" as a section header', () => {
    const help =
      'These are common Git commands used in various situations:\n  whatever stuff\n'

    expect(parseHelpCommands(help)).toEqual([])
  })
})
