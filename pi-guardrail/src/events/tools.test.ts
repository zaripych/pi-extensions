import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupRegisterGuardrail } from '../register.harness'
import {
  fakeSessionStartEvent,
  fakeToolCallEvent,
  setupPiHarness,
} from '../testing/pi.harness'

const setup = combineHarnesses(setupPiHarness, setupRegisterGuardrail)

describe('non-bash tool enforcement end to end', () => {
  it('defers active-tool narrowing to session start instead of calling runtime APIs during load', async () => {
    await using harness = await setup({ getFlag: () => 'hand-hold' })
    const {
      pi,
      registerGuardrail,
      sessionStart,
      activeToolsCalls,
      activeTools,
    } = harness

    await registerGuardrail({ pi })

    expect(activeToolsCalls).toHaveLength(0)

    await sessionStart(fakeSessionStartEvent())

    expect(activeTools()).toEqual([
      'read',
      'grep',
      'find',
      'ls',
      'write',
      'edit',
      'bash',
    ])
  })

  it('narrows active tools to the mode allow/ask lists, filtered to registered tools, under --guardrail read-only', async () => {
    await using harness = await setup({
      getFlag: () => 'read-only',
      getAllTools: () => ['read', 'grep', 'find', 'ls', 'write', 'edit'],
    })
    const { pi, registerGuardrail, sessionStart, activeTools } = harness

    await registerGuardrail({ pi })
    await sessionStart(fakeSessionStartEvent())

    expect(activeTools()).toEqual(['read', 'grep', 'find', 'ls'])
  })

  it('keeps bash in the active tools because the default read-only mode allows bash:read', async () => {
    await using harness = await setup({
      getFlag: () => 'read-only',
      getAllTools: () => ['read', 'bash'],
    })
    const { pi, registerGuardrail, sessionStart, activeTools } = harness

    await registerGuardrail({ pi })
    await sessionStart(fakeSessionStartEvent())

    expect(activeTools()).toEqual(['read', 'bash'])
  })

  it('excludes bash from active tools when no bash subset is allowed or asked', async () => {
    await using harness = await setup({
      getFlag: () => 'read-only',
      getAllTools: () => ['read', 'bash'],
    })
    const {
      pi,
      registerGuardrail,
      sessionStart,
      activeTools,
      writeFile,
      configPath,
    } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["read"], ask: [], deny: [] }
  hand-hold: { allow: ["read"], ask: [], deny: [] }
bash:
  read: []
  write: []
  dangerous: []
`
    )

    await registerGuardrail({ pi })
    await sessionStart(fakeSessionStartEvent())

    expect(activeTools()).toEqual(['read'])
  })

  it('denies a tool the active mode does not list under allow or ask when the model calls it', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(fakeToolCallEvent({ toolName: 'edit' }))

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('edit'),
      reasonCode: 'policy-deny',
    })
  })

  it('prompts with Abort / Allow once / Allow this tool for session for a tool in the ask list under hand-hold', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Allow once',
    })
    const { pi, registerGuardrail, toolCall, selectPrompts } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(fakeToolCallEvent({ toolName: 'write' }))

    expect(result).toBeUndefined()
    expect(selectPrompts).toEqual([
      {
        title: expect.stringContaining('write'),
        options: ['Abort', 'Allow once', 'Allow this tool for session'],
      },
    ])
  })

  it('blocks an ask-required tool when the user aborts the prompt under hand-hold', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Abort',
    })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(fakeToolCallEvent({ toolName: 'write' }))

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('write'),
      reasonCode: 'user-declined',
    })
  })

  it('honors a tool session grant on a second call without re-prompting under hand-hold', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Allow this tool for session',
    })
    const { pi, registerGuardrail, toolCall, selectPrompts } = harness

    await registerGuardrail({ pi })
    const first = await toolCall(fakeToolCallEvent({ toolName: 'write' }))
    const second = await toolCall(fakeToolCallEvent({ toolName: 'write' }))

    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
    expect(selectPrompts).toHaveLength(1)
  })

  it('blocks an ask-required tool call with a clear reason when pi has no UI', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      hasUI: () => false,
    })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(fakeToolCallEvent({ toolName: 'write' }))

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('no UI'),
      reasonCode: 'no-ui',
    })
  })

  it('enforces a tool registered after activation at call time without rewriting the active tool set', async () => {
    const registered = ['read']
    await using harness = await setup({
      getFlag: () => 'read-only',
      getAllTools: () => [...registered],
    })
    const { pi, registerGuardrail, sessionStart, toolCall, activeToolsCalls } =
      harness

    await registerGuardrail({ pi })
    await sessionStart(fakeSessionStartEvent())
    const callsAfterActivation = activeToolsCalls.length

    registered.push('edit')
    const result = await toolCall(fakeToolCallEvent({ toolName: 'edit' }))

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('edit'),
      reasonCode: 'policy-deny',
    })
    expect(activeToolsCalls).toHaveLength(callsAfterActivation)
  })

  it('narrows active tools to none in config-error deny-all mode', async () => {
    await using harness = await setup({
      getFlag: () => 'read-only',
      fileExists: async () => true,
      readFile: async () => {
        throw new Error('EACCES: permission denied')
      },
    })
    const { pi, registerGuardrail, sessionStart, activeTools } = harness

    await registerGuardrail({ pi })
    await sessionStart(fakeSessionStartEvent())

    expect(activeTools()).toEqual([])
  })

  it('recomputes active tools when the mode changes at runtime via /guardrail read-only', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      getAllTools: () => ['read', 'grep', 'find', 'ls', 'write', 'edit'],
    })
    const { pi, registerGuardrail, sessionStart, runCommand, activeTools } =
      harness

    await registerGuardrail({ pi })
    await sessionStart(fakeSessionStartEvent())
    await runCommand('guardrail', 'read-only')

    expect(activeTools()).toEqual(['read', 'grep', 'find', 'ls'])
  })

  it('clears a non-bash tool session grant when the active mode changes', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Allow this tool for session',
    })
    const { pi, registerGuardrail, runCommand, toolCall, selectPrompts } =
      harness

    await registerGuardrail({ pi })
    await toolCall(fakeToolCallEvent({ toolName: 'write' }))
    await runCommand('guardrail', 'read-only')
    await runCommand('guardrail', 'hand-hold')
    await toolCall(fakeToolCallEvent({ toolName: 'write' }))

    expect(selectPrompts).toHaveLength(2)
  })

  it('recomputes active tools when /guardrail reload picks up an edited policy', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      getAllTools: () => ['read', 'write', 'edit'],
    })
    const {
      pi,
      registerGuardrail,
      sessionStart,
      runCommand,
      activeTools,
      writeFile,
      configPath,
    } = harness

    await registerGuardrail({ pi })
    await sessionStart(fakeSessionStartEvent())
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["read"], ask: [], deny: ["write", "edit"] }
  hand-hold: { allow: ["read"], ask: [], deny: ["write", "edit"] }
bash:
  read: []
  write: []
  dangerous: []
`
    )
    await runCommand('guardrail', 'reload')

    expect(activeTools()).toEqual(['read'])
  })

  it('narrows active tools to none when /guardrail reload hits a config error', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      getAllTools: () => ['read', 'write', 'edit'],
    })
    const {
      pi,
      registerGuardrail,
      sessionStart,
      runCommand,
      activeTools,
      writeFile,
      configPath,
    } = harness

    await registerGuardrail({ pi })
    await sessionStart(fakeSessionStartEvent())
    await writeFile(configPath, 'modes: [not, a, mapping]\n')
    await runCommand('guardrail', 'reload')

    expect(activeTools()).toEqual([])
  })

  it('clears a non-bash tool session grant on /guardrail reload', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Allow this tool for session',
    })
    const { pi, registerGuardrail, runCommand, toolCall, selectPrompts } =
      harness

    await registerGuardrail({ pi })
    await toolCall(fakeToolCallEvent({ toolName: 'write' }))
    await runCommand('guardrail', 'reload')
    await toolCall(fakeToolCallEvent({ toolName: 'write' }))

    expect(selectPrompts).toHaveLength(2)
  })
})
