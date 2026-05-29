import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupRegisterGuardrail } from '../register.harness'
import {
  fakeBashToolCallEvent,
  fakeReadToolCallEvent,
  setupPiHarness,
} from '../testing/pi.harness'

const setup = combineHarnesses(setupPiHarness, setupRegisterGuardrail)

describe('commands end to end', () => {
  it.each(['read-only', 'hand-hold', 'off'] as const)(
    'switches the active mode to read-only when /guardrail read-only is run from initial mode %s',
    async (initialMode) => {
      await using harness = await setup({ getFlag: () => initialMode })
      const { pi, registerGuardrail, runCommand, toolCall } = harness

      await registerGuardrail({ pi })
      await runCommand('guardrail', 'read-only')
      const result = await toolCall(
        fakeBashToolCallEvent({ command: 'npm install' })
      )

      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining('read-only'),
        reasonCode: 'policy-deny',
      })
    }
  )

  it.each(['read-only', 'hand-hold', 'off'] as const)(
    'switches the active mode to hand-hold when /guardrail hand-hold is run from initial mode %s',
    async (initialMode) => {
      await using harness = await setup({
        getFlag: () => initialMode,
        respondToSelect: () => 'Abort',
      })
      const { pi, registerGuardrail, runCommand, toolCall, selectPrompts } =
        harness

      await registerGuardrail({ pi })
      await runCommand('guardrail', 'hand-hold')
      await toolCall(fakeBashToolCallEvent({ command: 'npm install' }))

      expect(selectPrompts).toHaveLength(1)
    }
  )

  it('notifies and falls into config-error deny-all when /guardrail read-only is run from --guardrail off with a broken policy', async () => {
    await using harness = await setup({
      fileExists: async () => true,
      readFile: async () => {
        throw new Error('EACCES: permission denied')
      },
      getFlag: () => 'off',
    })
    const {
      pi,
      registerGuardrail,
      runCommand,
      toolCall,
      configPath,
      notifications,
    } = harness

    await registerGuardrail({ pi })
    await runCommand('guardrail', 'read-only')
    const result = await toolCall(fakeReadToolCallEvent())

    expect(notifications).toEqual([
      { message: expect.stringContaining(configPath), level: 'error' },
    ])
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining(configPath),
      reasonCode: 'config-error',
    })
  })

  it('clears session grants when /guardrail switches modes', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Allow exact command for session',
    })
    const {
      pi,
      registerGuardrail,
      runCommand,
      toolCall,
      respondToSelect,
      selectPrompts,
    } = harness

    await registerGuardrail({ pi })
    await toolCall(fakeBashToolCallEvent({ command: 'npm install' }))
    await runCommand('guardrail', 'read-only')
    await runCommand('guardrail', 'hand-hold')
    respondToSelect.mockImplementation(() => 'Abort')
    await toolCall(fakeBashToolCallEvent({ command: 'npm install' }))

    expect(selectPrompts).toHaveLength(2)
  })

  it('retries loading the configuration for the requested mode when /guardrail read-only is run in config-error deny-all mode', async () => {
    await using harness = await setup({ getFlag: () => 'hand-hold' })
    const {
      pi,
      registerGuardrail,
      runCommand,
      toolCall,
      writeFile,
      configPath,
    } = harness
    await writeFile(configPath, ':\nnot: parseable: {{{')

    await registerGuardrail({ pi })
    const before = await toolCall(fakeReadToolCallEvent())

    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["bash:read"], ask: [], deny: ["bash:write"] }
  hand-hold: { allow: ["bash:read"], ask: ["bash:write"], deny: [] }
bash:
  read:
    - name: defaults
      description: read commands
      commands: [pwd]
  write:
    - name: package-managers
      description: package manager writes
      commands: [npm install]
  dangerous: []
`
    )
    await runCommand('guardrail', 'read-only')
    const after = await toolCall(
      fakeBashToolCallEvent({ command: 'npm install' })
    )

    expect(before).toEqual({
      block: true,
      reason: expect.stringContaining(configPath),
      reasonCode: 'config-error',
    })
    expect(after).toEqual({
      block: true,
      reason: expect.stringContaining('read-only'),
      reasonCode: 'policy-deny',
    })
  })

  it('re-reads the configuration and applies it when /guardrail reload is run', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const {
      pi,
      registerGuardrail,
      runCommand,
      toolCall,
      writeFile,
      configPath,
    } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["bash:read"], ask: [], deny: ["bash:write"] }
  hand-hold: { allow: ["bash:read"], ask: ["bash:write"], deny: [] }
bash:
  read: []
  write:
    - name: weird
      description: pwd misclassified as write
      commands: [pwd]
  dangerous: []
`
    )

    await registerGuardrail({ pi })
    const before = await toolCall(
      fakeBashToolCallEvent({ command: 'pwd' })
    )

    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["bash:read"], ask: [], deny: ["bash:write"] }
  hand-hold: { allow: ["bash:read"], ask: ["bash:write"], deny: [] }
bash:
  read:
    - name: normal
      description: pwd is read
      commands: [pwd]
  write: []
  dangerous: []
`
    )
    await runCommand('guardrail', 'reload')
    const after = await toolCall(fakeBashToolCallEvent({ command: 'pwd' }))

    expect(before).toEqual({
      block: true,
      reason: expect.stringContaining('bash:write'),
      reasonCode: 'policy-deny',
    })
    expect(after).toBeUndefined()
  })

  it('clears session grants when /guardrail reload is run', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Allow exact command for session',
    })
    const {
      pi,
      registerGuardrail,
      runCommand,
      toolCall,
      respondToSelect,
      selectPrompts,
    } = harness

    await registerGuardrail({ pi })
    await toolCall(fakeBashToolCallEvent({ command: 'npm install' }))
    await runCommand('guardrail', 'reload')
    respondToSelect.mockImplementation(() => 'Abort')
    await toolCall(fakeBashToolCallEvent({ command: 'npm install' }))

    expect(selectPrompts).toHaveLength(2)
  })

  it('reports ok when /guardrail doctor runs on a valid default config', async () => {
    await using harness = await setup({ getFlag: () => 'hand-hold' })
    const { pi, registerGuardrail, runCommand, notifications } = harness

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'doctor')

    expect(notifications).toEqual([
      { message: expect.stringContaining('ok'), level: 'info' },
    ])
  })

  it('reports ok when /guardrail doctor runs on cross-category parent/child entries with different specificity', async () => {
    await using harness = await setup({ getFlag: () => 'hand-hold' })
    const {
      pi,
      registerGuardrail,
      runCommand,
      notifications,
      writeFile,
      configPath,
    } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["bash:read"], ask: [], deny: ["bash:write", "bash:dangerous"] }
  hand-hold: { allow: ["bash:read"], ask: ["bash:write", "bash:dangerous"], deny: [] }
bash:
  read:
    - name: broad-git
      description: broad git
      commands: [git]
  write: []
  dangerous:
    - name: dangerous-git-rebase
      description: force rebases are dangerous
      commands:
        - command: git rebase
          include: [--force]
`
    )

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'doctor')

    expect(notifications).toEqual([
      { message: expect.stringContaining('ok'), level: 'info' },
    ])
  })

  it('reports ok when an exclude makes equal-specificity cross-category entries non-co-matchable', async () => {
    await using harness = await setup({ getFlag: () => 'hand-hold' })
    const {
      pi,
      registerGuardrail,
      runCommand,
      notifications,
      writeFile,
      configPath,
    } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["bash:read"], ask: [], deny: ["bash:write", "bash:dangerous"] }
  hand-hold: { allow: ["bash:read"], ask: ["bash:write", "bash:dangerous"], deny: [] }
bash:
  read:
    - name: broad-git
      description: broad git except push
      commands:
        - command: git
          exclude: [push]
  write: []
  dangerous:
    - name: dangerous-git-push
      description: pushes are dangerous
      commands: [git push]
`
    )

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'doctor')

    expect(notifications).toEqual([
      { message: expect.stringContaining('ok'), level: 'info' },
    ])
  })

  it('reports cross-category ambiguities with precise YAML paths and reason when /guardrail doctor runs on an unresolvable specificity tie', async () => {
    await using harness = await setup({ getFlag: () => 'hand-hold' })
    const {
      pi,
      registerGuardrail,
      runCommand,
      notifications,
      writeFile,
      configPath,
    } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["bash:read"], ask: [], deny: ["bash:write", "bash:dangerous"] }
  hand-hold: { allow: ["bash:read"], ask: ["bash:write", "bash:dangerous"], deny: [] }
bash:
  read:
    - name: ambiguous-read
      description: read stash
      commands: [git stash]
  write: []
  dangerous:
    - name: ambiguous-dangerous
      description: dangerous stash
      commands: [git stash]
`
    )

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'doctor')

    expect(notifications).toEqual([
      {
        level: 'warning',
        message: expect.stringMatching(
          /bash\.read\[ambiguous-read\]\.commands\[0\].*git stash[\s\S]*bash\.dangerous\[ambiguous-dangerous\]\.commands\[0\].*git stash/
        ),
      },
    ])
  })

  it('reports an ambiguity when the shorter include is satisfied by the longer prefix despite a matching longer exclude', async () => {
    await using harness = await setup({ getFlag: () => 'hand-hold' })
    const {
      pi,
      registerGuardrail,
      runCommand,
      notifications,
      writeFile,
      configPath,
    } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["bash:read"], ask: [], deny: ["bash:write", "bash:dangerous"] }
  hand-hold: { allow: ["bash:read"], ask: ["bash:write", "bash:dangerous"], deny: [] }
bash:
  read:
    - name: ambiguous-read
      description: git with push and not dry-run
      commands:
        - command: git
          include: [push]
          exclude: [--dry-run]
  write: []
  dangerous:
    - name: ambiguous-dangerous
      description: git push without push again
      commands:
        - command: git push
          exclude: [push]
`
    )

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'doctor')

    expect(notifications).toEqual([
      {
        level: 'warning',
        message: expect.stringMatching(
          /bash\.read\[ambiguous-read\]\.commands\[0\][\s\S]*bash\.dangerous\[ambiguous-dangerous\]\.commands\[0\]/
        ),
      },
    ])
  })

  it('reports an ambiguity when an include is satisfied only in the longer entry own remaining window with equal prefixes', async () => {
    await using harness = await setup({ getFlag: () => 'hand-hold' })
    const {
      pi,
      registerGuardrail,
      runCommand,
      notifications,
      writeFile,
      configPath,
    } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["bash:read"], ask: [], deny: ["bash:write", "bash:dangerous"] }
  hand-hold: { allow: ["bash:read"], ask: ["bash:write", "bash:dangerous"], deny: [] }
bash:
  read:
    - name: ambiguous-read
      description: git push without dry-run
      commands:
        - command: git push
          exclude: [--dry-run]
  write: []
  dangerous:
    - name: ambiguous-dangerous
      description: git push with another push
      commands:
        - command: git push
          include: [push]
`
    )

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'doctor')

    expect(notifications).toEqual([
      {
        level: 'warning',
        message: expect.stringMatching(
          /bash\.read\[ambiguous-read\]\.commands\[0\][\s\S]*bash\.dangerous\[ambiguous-dangerous\]\.commands\[0\]/
        ),
      },
    ])
  })

  it('reports the config error when /guardrail doctor runs on an unparseable config', async () => {
    await using harness = await setup({ getFlag: () => 'hand-hold' })
    const {
      pi,
      registerGuardrail,
      runCommand,
      notifications,
      writeFile,
      configPath,
    } = harness
    await writeFile(configPath, ':\nnot: parseable: {{{')

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'doctor')

    expect(notifications).toEqual([
      {
        level: 'error',
        message: expect.stringContaining(configPath),
      },
    ])
  })

  it('does not create guardrail.yaml when /guardrail doctor runs with no config file', async () => {
    await using harness = await setup({ getFlag: () => 'off' })
    const {
      pi,
      registerGuardrail,
      runCommand,
      notifications,
      configPath,
      fileExists,
    } = harness

    await registerGuardrail({ pi })
    expect(await fileExists(configPath)).toBe(false)

    await runCommand('guardrail', 'doctor')

    expect(await fileExists(configPath)).toBe(false)
    expect(notifications).toEqual([
      {
        level: 'info',
        message: expect.stringContaining('no config file'),
      },
    ])
  })

  it('warns and points to /guardrail doctor when /guardrail reload loads a config with cross-category ambiguities', async () => {
    await using harness = await setup({ getFlag: () => 'hand-hold' })
    const {
      pi,
      registerGuardrail,
      runCommand,
      writeFile,
      configPath,
      notifications,
    } = harness

    await registerGuardrail({ pi })
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["bash:read"], ask: [], deny: ["bash:write", "bash:dangerous"] }
  hand-hold: { allow: ["bash:read"], ask: ["bash:write", "bash:dangerous"], deny: [] }
bash:
  read:
    - name: ambiguous-read
      description: read stash
      commands: [git stash]
  write: []
  dangerous:
    - name: ambiguous-dangerous
      description: dangerous stash
      commands: [git stash]
`
    )
    await runCommand('guardrail', 'reload')

    expect(notifications).toEqual([
      {
        level: 'warning',
        message: expect.stringContaining('/guardrail doctor'),
      },
    ])
  })

  it('notifies the user when /guardrail reload loads a config that fails to parse', async () => {
    await using harness = await setup({ getFlag: () => 'hand-hold' })
    const {
      pi,
      registerGuardrail,
      runCommand,
      writeFile,
      configPath,
      notifications,
    } = harness

    await registerGuardrail({ pi })
    await writeFile(configPath, ':\nnot: parseable: {{{')
    await runCommand('guardrail', 'reload')

    expect(notifications).toEqual([
      { message: expect.stringContaining(configPath), level: 'error' },
    ])
  })
})
