import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupRegisterGuardrail } from '../register.harness'
import {
  fakeBashToolCallEvent,
  fakeReadToolCallEvent,
  fakeSessionStartEvent,
  setupPiHarness,
} from '../testing/pi.harness'

const setup = combineHarnesses(setupPiHarness, setupRegisterGuardrail)

describe('config end to end', () => {
  it('creates guardrail.yaml from the shipped default when none exists', async () => {
    await using harness = await setup()
    const { pi, registerGuardrail, configPath, readFile } = harness

    await registerGuardrail({ pi })
    const content = await readFile(configPath)

    expect(content).toContain('pi-guardrail policy')
  })

  it('denies every tool call when guardrail.yaml cannot be read', async () => {
    await using harness = await setup({
      fileExists: async () => true,
      readFile: async () => {
        throw new Error('EACCES: permission denied')
      },
      getFlag: () => 'read-only',
    })
    const { pi, registerGuardrail, toolCall, configPath } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(fakeReadToolCallEvent())

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining(configPath),
      reasonCode: 'config-error',
    })
  })

  it('denies every tool call when guardrail.yaml cannot be parsed', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(configPath, ':\nnot: parseable: {{{')

    await registerGuardrail({ pi })
    const result = await toolCall(fakeReadToolCallEvent())

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining(configPath),
      reasonCode: 'config-error',
    })
  })

  it('denies every tool call when a bash group is malformed', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: [], ask: [], deny: [] }
  hand-hold: { allow: [], ask: [], deny: [] }
bash:
  read:
    - name: bad
      commands: [pwd]
`
    )

    await registerGuardrail({ pi })
    const result = await toolCall(fakeReadToolCallEvent())

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining(configPath),
      reasonCode: 'config-error',
    })
  })

  it('denies every tool call when a bash command prefix is whitespace-only', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["bash:read"], ask: [], deny: ["bash:write", "bash:dangerous"] }
  hand-hold: { allow: ["bash:read"], ask: ["bash:write", "bash:dangerous"], deny: [] }
bash:
  read:
    - name: defaults
      description: read commands
      commands: ["   "]
  write: []
  dangerous: []
`
    )

    await registerGuardrail({ pi })
    const result = await toolCall(fakeReadToolCallEvent())

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining(configPath),
      reasonCode: 'config-error',
    })
  })

  it('denies every tool call when an object-form bash command prefix is whitespace-only', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["bash:read"], ask: [], deny: ["bash:write", "bash:dangerous"] }
  hand-hold: { allow: ["bash:read"], ask: ["bash:write", "bash:dangerous"], deny: [] }
bash:
  read:
    - name: defaults
      description: read commands
      commands:
        - command: "  "
          exclude: [--output]
  write: []
  dangerous: []
`
    )

    await registerGuardrail({ pi })
    const result = await toolCall(fakeReadToolCallEvent())

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining(configPath),
      reasonCode: 'config-error',
    })
  })

  it('denies every tool call when a mode lists the bare "bash" capability', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: [bash], ask: [], deny: [] }
  hand-hold: { allow: [], ask: [], deny: [] }
bash:
  read: []
  write: []
  dangerous: []
`
    )

    await registerGuardrail({ pi })
    const result = await toolCall(fakeReadToolCallEvent())

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bash'),
      reasonCode: 'config-error',
    })
  })

  it('denies every tool call when a mode lists an unknown bash:<x> capability', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["bash:sneaky"], ask: [], deny: [] }
  hand-hold: { allow: [], ask: [], deny: [] }
bash:
  read: []
  write: []
  dangerous: []
`
    )

    await registerGuardrail({ pi })
    const result = await toolCall(fakeReadToolCallEvent())

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bash:sneaky'),
      reasonCode: 'config-error',
    })
  })

  it('denies every tool call when a mode lists bash:unknown', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: [], ask: ["bash:unknown"], deny: [] }
  hand-hold: { allow: [], ask: [], deny: [] }
bash:
  read: []
  write: []
  dangerous: []
`
    )

    await registerGuardrail({ pi })
    const result = await toolCall(fakeReadToolCallEvent())

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bash:unknown'),
      reasonCode: 'config-error',
    })
  })

  it('denies every tool call when a mode lists the same capability in two lists', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: [read], ask: [read], deny: [] }
  hand-hold: { allow: [], ask: [], deny: [] }
bash:
  read: []
  write: []
  dangerous: []
`
    )

    await registerGuardrail({ pi })
    const result = await toolCall(fakeReadToolCallEvent())

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('read'),
      reasonCode: 'config-error',
    })
  })

  it('warns once at session start when cross-category bash entries are ambiguous and points to /guardrail doctor', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const {
      pi,
      registerGuardrail,
      sessionStart,
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
    await sessionStart(fakeSessionStartEvent())

    expect(notifications).toEqual([
      {
        level: 'warning',
        message: expect.stringContaining('/guardrail doctor'),
      },
    ])
  })

  it('accepts same-category bash prefix overlaps without entering config-error mode', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["bash:read"], ask: [], deny: ["bash:write", "bash:dangerous"] }
  hand-hold: { allow: ["bash:read"], ask: ["bash:write", "bash:dangerous"], deny: [] }
bash:
  read:
    - name: defaults
      description: read commands
      commands: [git, "git status"]
  write: []
  dangerous: []
`
    )

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'git status' })
    )

    expect(result).toBeUndefined()
  })

  it('denies every tool call when a mode action key is misspelled', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { alow: [read], ask: [], deny: [] }
  hand-hold: { allow: [], ask: [], deny: [] }
bash:
  read: []
  write: []
  dangerous: []
`
    )

    await registerGuardrail({ pi })
    const result = await toolCall(fakeReadToolCallEvent())

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining(configPath),
      reasonCode: 'config-error',
    })
  })

  it('denies every tool call when guardrail.yaml has an unknown top-level key', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: [], ask: [], deny: [] }
  hand-hold: { allow: [], ask: [], deny: [] }
bash:
  read: []
  write: []
  dangerous: []
sneaky: true
`
    )

    await registerGuardrail({ pi })
    const result = await toolCall(fakeReadToolCallEvent())

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining(configPath),
      reasonCode: 'config-error',
    })
  })

  it('denies every tool call when a bash command entry uses the pre-4.1 except key', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["bash:read"], ask: [], deny: [] }
  hand-hold: { allow: ["bash:read"], ask: [], deny: [] }
bash:
  read:
    - name: defaults
      description: read commands
      commands:
        - command: git diff
          except: [--output]
  write: []
  dangerous: []
`
    )

    await registerGuardrail({ pi })
    const result = await toolCall(fakeReadToolCallEvent())

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining(configPath),
      reasonCode: 'config-error',
    })
  })

  it('denies every tool call when guardrail.yaml top-level is not an object', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(configPath, 'just a bare string')

    await registerGuardrail({ pi })
    const result = await toolCall(fakeReadToolCallEvent())

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining(configPath),
      reasonCode: 'config-error',
    })
  })
})
