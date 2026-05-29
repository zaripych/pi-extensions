import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupRegisterGuardrail } from '../register.harness'
import {
  fakeBashToolCallEvent,
  fakeReadToolCallEvent,
  fakeSessionStartEvent,
  fakeWriteToolCallEvent,
  setupPiHarness,
} from '../testing/pi.harness'

const setup = combineHarnesses(setupPiHarness, setupRegisterGuardrail)

describe('cli-args end to end', () => {
  it('advertises --guardrail to pi so the user can pass it on the command line', async () => {
    await using harness = await setup()
    const { pi, registerGuardrail, registeredFlags } = harness

    await registerGuardrail({ pi })

    expect(registeredFlags).toEqual([
      {
        name: 'guardrail',
        options: expect.objectContaining({ type: 'string' }),
      },
    ])
  })

  it('allows model tool calls under --guardrail off even when the config cannot be read', async () => {
    await using harness = await setup({
      fileExists: async () => true,
      readFile: async () => {
        throw new Error('EACCES: permission denied')
      },
      getFlag: () => 'off',
    })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(fakeWriteToolCallEvent())

    expect(result).toBeUndefined()
  })

  it('blocks a write tool call when the user starts pi with --guardrail read-only', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(fakeWriteToolCallEvent())

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('read-only'),
      reasonCode: 'policy-deny',
    })
  })

  it('defaults to hand-hold mode when the user passes no --guardrail flag', async () => {
    await using harness = await setup({ respondToSelect: () => 'Abort' })
    const { pi, registerGuardrail, toolCall, selectPrompts } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'npm install' })
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('npm install'),
      reasonCode: 'user-declined',
    })
    expect(selectPrompts).toHaveLength(1)
  })

  it('lets the model use tools when the user passes --guardrail off', async () => {
    await using harness = await setup({ getFlag: () => 'off' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(fakeWriteToolCallEvent())

    expect(result).toBeUndefined()
  })

  it('warns the user at startup when --guardrail has an unrecognised value', async () => {
    await using harness = await setup({ getFlag: () => 'lenient' })
    const { pi, registerGuardrail, sessionStart, notifications } = harness

    await registerGuardrail({ pi })
    await sessionStart(fakeSessionStartEvent())

    expect(notifications).toEqual([
      { message: expect.stringContaining('lenient'), level: 'error' },
    ])
  })

  it('denies every tool call after an unrecognised --guardrail value', async () => {
    await using harness = await setup({ getFlag: () => 'lenient' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(fakeReadToolCallEvent())

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('Invalid'),
      reasonCode: 'config-error',
    })
  })
})
