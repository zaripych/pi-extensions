import { dirname, join } from 'node:path'
import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupRegisterGuardrail } from '../register.harness'
import { fakeBashToolCallEvent, setupPiHarness } from '../testing/pi.harness'

const setup = combineHarnesses(setupPiHarness, setupRegisterGuardrail)

function fakeHelp(map: Record<string, string>): (params: {
  cli: string
  path: readonly string[]
}) => Promise<string> {
  return async ({ path }) => map[path.join(' ')] ?? ''
}

describe('/guardrail discover', () => {
  it('emits an import-file with command and a read entry for a discovered read command', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      runCliHelp: fakeHelp({
        '': 'Commands:\n  list   List things\n',
        list: 'usage: gh list',
      }),
    })
    const { pi, registerGuardrail, runCommand, notifications } = harness

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'discover gh')

    expect(notifications).toEqual([
      {
        level: 'info',
        message: expect.stringMatching(
          /command: gh[\s\S]*read:[\s\S]*- gh list/
        ),
      },
    ])
  })

  it('emits a write entry for a discovered write command', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      runCliHelp: fakeHelp({
        '': 'Commands:\n  create   Create things\n',
        create: 'usage: gh create',
      }),
    })
    const { pi, registerGuardrail, runCommand, notifications } = harness

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'discover gh')

    expect(notifications).toEqual([
      {
        level: 'info',
        message: expect.stringMatching(/write:[\s\S]*- gh create/),
      },
    ])
  })

  it('emits unknown commands as a commented YAML block', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      runCliHelp: fakeHelp({
        '': 'Commands:\n  alias   Manage aliases\n',
        alias: 'usage: gh alias',
      }),
    })
    const { pi, registerGuardrail, runCommand, notifications } = harness

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'discover gh')

    const message = notifications[0]?.message ?? ''
    expect(message).toMatch(/# unknown:/)
    expect(message).toMatch(/#\s+- gh alias/)
    expect(message).not.toMatch(/^\s+- gh alias/m)
  })

  it('recurses into subcommand groups and reports full leaf command paths', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      runCliHelp: fakeHelp({
        '': 'Commands:\n  pr   Manage pull requests\n',
        pr: 'Commands:\n  list     List PRs\n  create   Create a PR\n',
        'pr list': 'usage: gh pr list',
        'pr create': 'usage: gh pr create',
      }),
    })
    const { pi, registerGuardrail, runCommand, notifications } = harness

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'discover gh')

    const message = notifications[0]?.message ?? ''
    expect(message).toMatch(/read:[\s\S]*- gh pr list/)
    expect(message).toMatch(/write:[\s\S]*- gh pr create/)
  })

  it('is available when guardrail is off', async () => {
    await using harness = await setup({
      getFlag: () => 'off',
      runCliHelp: fakeHelp({
        '': 'Commands:\n  list   List things\n',
        list: 'usage: gh list',
      }),
    })
    const { pi, registerGuardrail, runCommand, notifications } = harness

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'discover gh')

    expect(notifications).toEqual([
      { level: 'info', message: expect.stringContaining('gh list') },
    ])
  })

  it('is available in config-error deny-all mode', async () => {
    await using harness = await setup({
      getFlag: () => 'read-only',
      fileExists: async () => true,
      readFile: async () => {
        throw new Error('EACCES: permission denied')
      },
      runCliHelp: fakeHelp({
        '': 'Commands:\n  list   List things\n',
        list: 'usage: gh list',
      }),
    })
    const { pi, registerGuardrail, runCommand, notifications } = harness

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'discover gh')

    expect(notifications).toEqual([
      { level: 'info', message: expect.stringContaining('gh list') },
    ])
  })

  it('never creates or modifies the configuration file during discovery', async () => {
    await using harness = await setup({
      getFlag: () => 'off',
      runCliHelp: fakeHelp({
        '': 'Commands:\n  list   List things\n',
        list: 'usage: gh list',
      }),
    })
    const { pi, registerGuardrail, runCommand, configPath, fileExists } =
      harness

    await registerGuardrail({ pi })
    expect(await fileExists(configPath)).toBe(false)

    await runCommand('guardrail', 'discover gh')

    expect(await fileExists(configPath)).toBe(false)
  })

  it('reports usage when no cli is given', async () => {
    await using harness = await setup({ getFlag: () => 'hand-hold' })
    const { pi, registerGuardrail, runCommand, notifications } = harness

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'discover')

    expect(notifications).toEqual([
      { level: 'error', message: expect.stringContaining('Usage') },
    ])
  })

  it('emits an import-file that loads back as a valid bash import', async () => {
    await using harness = await setup({
      getFlag: () => 'read-only',
      runCliHelp: fakeHelp({
        '': 'Commands:\n  list   List things\n  create  Create things\n',
        list: 'usage: gh list',
        create: 'usage: gh create',
      }),
    })
    const {
      pi,
      registerGuardrail,
      runCommand,
      toolCall,
      notifications,
      writeFile,
      configPath,
    } = harness

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'discover gh')
    const emitted = notifications[0]?.message ?? ''

    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["bash:read"], ask: [], deny: ["bash:write", "bash:dangerous"] }
  hand-hold: { allow: ["bash:read"], ask: ["bash:write", "bash:dangerous"], deny: [] }
bash:
  import:
    - ./policy.gh.yaml
  read: []
  write: []
  dangerous: []
`
    )
    await writeFile(join(dirname(configPath), 'policy.gh.yaml'), emitted)
    await runCommand('guardrail', 'reload')
    const read = await toolCall(fakeBashToolCallEvent({ command: 'gh list' }))

    expect(read).toBeUndefined()
  })

  it('quotes degenerate cli/command names so the import-file loads back valid', async () => {
    await using harness = await setup({
      getFlag: () => 'read-only',
      runCliHelp: fakeHelp({
        '': 'Commands:\n  list   List things\n',
        list: 'usage: false list',
      }),
    })
    const {
      pi,
      registerGuardrail,
      runCommand,
      toolCall,
      notifications,
      writeFile,
      configPath,
    } = harness

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'discover false')
    const emitted = notifications[0]?.message ?? ''

    expect(emitted).toContain('command: "false"')

    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["bash:read"], ask: [], deny: ["bash:write", "bash:dangerous"] }
  hand-hold: { allow: ["bash:read"], ask: ["bash:write", "bash:dangerous"], deny: [] }
bash:
  import:
    - ./policy.false.yaml
  read: []
  write: []
  dangerous: []
`
    )
    await writeFile(join(dirname(configPath), 'policy.false.yaml'), emitted)
    await runCommand('guardrail', 'reload')
    const read = await toolCall(fakeBashToolCallEvent({ command: 'false list' }))

    expect(read).toBeUndefined()
  })

  it('saves the discovered import-file to the agent dir when the user chooses Save', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Save',
      runCliHelp: fakeHelp({
        '': 'Commands:\n  list   List things\n',
        list: 'usage: gh list',
      }),
    })
    const { pi, registerGuardrail, runCommand, readFile, fileExists, configPath } =
      harness

    await registerGuardrail({ pi })
    await runCommand('guardrail', 'discover gh')
    const savedPath = join(dirname(configPath), 'guardrail.bash.gh.yaml')

    expect(await fileExists(savedPath)).toBe(true)
    expect(await readFile(savedPath)).toContain('command: gh')
  })

  it('sanitizes degenerate cli names before saving discovery filenames', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Save',
      runCliHelp: fakeHelp({
        '': 'Commands:\n  list   List things\n',
        list: 'usage: tool list',
      }),
    })
    const { pi, registerGuardrail, runCommand, fileExists, configPath } = harness

    await registerGuardrail({ pi })
    await runCommand('guardrail', 'discover !!!')
    await runCommand('guardrail', 'discover gh!!!cli..')

    expect(
      await Promise.all([
        fileExists(join(dirname(configPath), 'guardrail.bash.cli.yaml')),
        fileExists(join(dirname(configPath), 'guardrail.bash.-.yaml')),
        fileExists(join(dirname(configPath), 'guardrail.bash.gh-cli.yaml')),
        fileExists(join(dirname(configPath), 'guardrail.bash.gh-cli...yaml')),
      ])
    ).toEqual([true, false, true, false])
  })

  it('offers an overwrite option and overwrites when the discovery file already exists', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Save - overwrite existing',
      runCliHelp: fakeHelp({
        '': 'Commands:\n  list   List things\n',
        list: 'usage: gh list',
      }),
    })
    const {
      pi,
      registerGuardrail,
      runCommand,
      writeFile,
      readFile,
      selectPrompts,
      configPath,
    } = harness
    const target = join(dirname(configPath), 'guardrail.bash.gh.yaml')
    await writeFile(target, 'OLD CONTENT\n')

    await registerGuardrail({ pi })
    await runCommand('guardrail', 'discover gh')

    expect(selectPrompts).toEqual([
      {
        title: expect.any(String),
        options: ['Save - overwrite existing', 'Abort'],
      },
    ])
    expect(await readFile(target)).toContain('command: gh')
  })

  it('does not overwrite an existing discovery file when the user aborts', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Abort',
      runCliHelp: fakeHelp({
        '': 'Commands:\n  list   List things\n',
        list: 'usage: gh list',
      }),
    })
    const { pi, registerGuardrail, runCommand, writeFile, readFile, configPath } =
      harness
    const target = join(dirname(configPath), 'guardrail.bash.gh.yaml')
    await writeFile(target, 'OLD CONTENT\n')

    await registerGuardrail({ pi })
    await runCommand('guardrail', 'discover gh')

    expect(await readFile(target)).toBe('OLD CONTENT\n')
  })

  it('does not save when the user chooses Abort', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Abort',
      runCliHelp: fakeHelp({
        '': 'Commands:\n  list   List things\n',
        list: 'usage: gh list',
      }),
    })
    const { pi, registerGuardrail, runCommand, fileExists, configPath } = harness

    await registerGuardrail({ pi })
    await runCommand('guardrail', 'discover gh')

    expect(
      await fileExists(join(dirname(configPath), 'guardrail.bash.gh.yaml'))
    ).toBe(false)
  })

  it('does not prompt or save when there is no UI', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      hasUI: () => false,
      respondToSelect: () => 'Save',
      runCliHelp: fakeHelp({
        '': 'Commands:\n  list   List things\n',
        list: 'usage: gh list',
      }),
    })
    const {
      pi,
      registerGuardrail,
      runCommand,
      selectPrompts,
      fileExists,
      configPath,
    } = harness

    await registerGuardrail({ pi })
    await runCommand('guardrail', 'discover gh')

    expect(selectPrompts).toHaveLength(0)
    expect(
      await fileExists(join(dirname(configPath), 'guardrail.bash.gh.yaml'))
    ).toBe(false)
  })

  it('reports when no commands are discovered for the cli', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      runCliHelp: fakeHelp({ '': 'usage: mystery [options]' }),
    })
    const { pi, registerGuardrail, runCommand, notifications } = harness

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'discover mystery')

    expect(notifications).toEqual([
      {
        level: 'info',
        message: expect.stringContaining('no commands discovered'),
      },
    ])
  })
})
