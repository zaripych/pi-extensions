import { tmpdir } from 'node:os'
import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupRegisterGuardrail } from '../register.harness'
import {
  fakeBashToolCallEvent,
  setupPiHarness,
} from '../testing/pi.harness'

const setup = combineHarnesses(setupPiHarness, setupRegisterGuardrail)

describe('bash end to end', () => {
  it('blocks a bash:write command (npm install) under --guardrail read-only', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'npm install' })
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('read-only'),
      reasonCode: 'policy-deny',
    })
  })

  it('prompts then runs a bash:write command (npm install) under --guardrail hand-hold when the user approves', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Allow once',
    })
    const { pi, registerGuardrail, toolCall, selectPrompts } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'npm install' })
    )

    expect(result).toBeUndefined()
    expect(selectPrompts).toHaveLength(1)
  })

  it('prompts then blocks a bash:write command (npm install) under --guardrail hand-hold when the user aborts', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Abort',
    })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'npm install' })
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('npm install'),
      reasonCode: 'user-declined',
    })
  })

  it('allows a bash:read command (pwd) under --guardrail read-only', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(fakeBashToolCallEvent({ command: 'pwd' }))

    expect(result).toBeUndefined()
  })

  it('blocks a bash:dangerous command (rm -rf foo) under --guardrail read-only', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'rm -rf foo' })
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bash:dangerous'),
      reasonCode: 'policy-deny',
    })
  })

  it('blocks an unknown bash command under --guardrail read-only', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'curl https://example.com' })
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bash:unknown'),
      reasonCode: 'policy-deny',
    })
  })

  it('prompts on an unknown bash command under --guardrail hand-hold', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Allow once',
    })
    const { pi, registerGuardrail, toolCall, selectPrompts } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'curl https://example.com' })
    )

    expect(result).toBeUndefined()
    expect(selectPrompts).toEqual([
      expect.objectContaining({
        title: expect.stringContaining('bash:unknown'),
      }),
    ])
  })

  it('classifies git diff --output=foo.patch as bash:unknown via the exclude clause and denies in read-only', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'git diff --output=foo.patch' })
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bash:unknown'),
      reasonCode: 'policy-deny',
    })
  })

  it('allows a bash:read command to redirect output into the scratch directory under read-only', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness
    const scratchOutput = `${tmpdir().replace(/\/+$/, '')}/guardrail-read-output.txt`

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: `cat package.json > "${scratchOutput}"` })
    )

    expect(result).toBeUndefined()
  })

  it('classifies a bash:read command with a tmp-escaping redirect as bash:unknown and denies in read-only', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness
    const escapingOutput = `${tmpdir().replace(/\/+$/, '')}/../guardrail-escape-output.txt`

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: `cat package.json > "${escapingOutput}"` })
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bash:unknown'),
      reasonCode: 'policy-deny',
    })
  })

  it('classifies a bash:read command with a project redirect as bash:unknown and denies in read-only', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({
        command: 'cat package.json > guardrail-read-output.txt',
      })
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bash:unknown'),
      reasonCode: 'policy-deny',
    })
  })

  it('classifies an unparseable bash command as bash:unknown and denies in read-only', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'echo "unterminated' })
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bash:unknown'),
      reasonCode: 'policy-deny',
    })
  })

  it('blocks a compound bash command in read-only when any simple part is bash:dangerous', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'pwd && rm -rf foo' })
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bash:dangerous'),
      reasonCode: 'policy-deny',
    })
  })

  it('prompts about the one risky simple part of a compound under hand-hold and runs the whole compound on approval', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Allow once',
    })
    const { pi, registerGuardrail, toolCall, selectPrompts } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'pwd && npm install' })
    )

    expect(result).toBeUndefined()
    expect(selectPrompts).toEqual([
      expect.objectContaining({
        title: expect.stringContaining('bash:write'),
      }),
    ])
  })

  it('asks once about the whole compound under hand-hold when multiple simple parts require approval', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Allow once',
    })
    const { pi, registerGuardrail, toolCall, selectPrompts } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({
        command: 'npm install && npm uninstall lodash',
      })
    )

    expect(result).toBeUndefined()
    expect(selectPrompts).toEqual([
      expect.objectContaining({
        title: expect.stringContaining(
          'npm install && npm uninstall lodash'
        ),
        options: ['Abort', 'Allow once'],
      }),
    ])
  })

  it('treats a compound that contains an unsupported shell construct as bash:unknown and denies it in read-only', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'pwd && cat $(echo foo)' })
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bash:unknown'),
      reasonCode: 'policy-deny',
    })
  })

  it('offers exact-command and classification session grants when prompting about a single bash:write command in hand-hold', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Abort',
    })
    const { pi, registerGuardrail, toolCall, selectPrompts } = harness

    await registerGuardrail({ pi })
    await toolCall(fakeBashToolCallEvent({ command: 'npm install' }))

    expect(selectPrompts).toEqual([
      expect.objectContaining({
        options: [
          'Abort',
          'Allow once',
          'Allow exact command for session',
          'Allow bash:write for session',
        ],
      }),
    ])
  })

  it('honors an exact-command session grant on a second matching call without re-prompting', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Allow exact command for session',
    })
    const { pi, registerGuardrail, toolCall, selectPrompts } = harness

    await registerGuardrail({ pi })
    const first = await toolCall(
      fakeBashToolCallEvent({ command: 'npm install' })
    )
    const second = await toolCall(
      fakeBashToolCallEvent({ command: 'npm install' })
    )

    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
    expect(selectPrompts).toHaveLength(1)
  })

  it('honors a classification session grant on a subsequent matching bash:write command', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Allow bash:write for session',
    })
    const { pi, registerGuardrail, toolCall, selectPrompts } = harness

    await registerGuardrail({ pi })
    const first = await toolCall(
      fakeBashToolCallEvent({ command: 'npm install' })
    )
    const second = await toolCall(
      fakeBashToolCallEvent({ command: 'npm uninstall lodash' })
    )

    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
    expect(selectPrompts).toHaveLength(1)
  })

  it('omits the classification-wide grant option when prompting about a bash:unknown command in hand-hold', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Abort',
    })
    const { pi, registerGuardrail, toolCall, selectPrompts } = harness

    await registerGuardrail({ pi })
    await toolCall(
      fakeBashToolCallEvent({ command: 'curl https://example.com' })
    )

    expect(selectPrompts).toEqual([
      expect.objectContaining({
        options: [
          'Abort',
          'Allow once',
          'Allow exact command for session',
        ],
      }),
    ])
  })

  it('omits the exact-command grant option when prompting about an unparseable bash command in hand-hold', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      respondToSelect: () => 'Abort',
    })
    const { pi, registerGuardrail, toolCall, selectPrompts } = harness

    await registerGuardrail({ pi })
    await toolCall(
      fakeBashToolCallEvent({ command: 'cat $(echo foo)' })
    )

    expect(selectPrompts).toEqual([
      expect.objectContaining({
        options: ['Abort', 'Allow once'],
      }),
    ])
  })

  it('classifies a command containing a double-quoted command substitution as bash:unknown and denies it in read-only', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'cat "$(rm -rf foo)"' })
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bash:unknown'),
      reasonCode: 'policy-deny',
    })
  })

  it('denies recognized bash classifications that the active mode does not mention, without prompting', async () => {
    await using harness = await setup({ getFlag: () => 'hand-hold' })
    const {
      pi,
      registerGuardrail,
      toolCall,
      writeFile,
      configPath,
      selectPrompts,
    } = harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["bash:read"], ask: [], deny: [] }
  hand-hold: { allow: ["bash:read"], ask: [], deny: [] }
bash:
  read:
    - name: defaults
      description: read commands
      commands: [pwd]
  write:
    - name: pkg
      description: package managers
      commands: [npm install]
  dangerous: []
`
    )

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'npm install' })
    )

    expect(selectPrompts).toEqual([])
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('denies bash:write'),
      reasonCode: 'policy-deny',
    })
  })

  it('blocks an ask-required bash command when pi has no UI', async () => {
    await using harness = await setup({
      getFlag: () => 'hand-hold',
      hasUI: () => false,
    })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'npm install' })
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('no UI'),
      reasonCode: 'no-ui',
    })
  })
})

const specificityPolicyYaml = `modes:
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

describe('bash specificity-based cross-category matching (Phase 4.1)', () => {
  it('classifies a command matching only a broad cross-category read prefix as bash:read and allows it', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(configPath, specificityPolicyYaml)

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'git status' })
    )

    expect(result).toBeUndefined()
  })

  it('lets a narrower dangerous entry override a broader cross-category read entry by specificity', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(configPath, specificityPolicyYaml)

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'git rebase --force main' })
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bash:dangerous'),
      reasonCode: 'policy-deny',
    })
  })

  it('does not apply a narrower include entry when its include token is absent, falling back to the broader category', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(configPath, specificityPolicyYaml)

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'git rebase main' })
    )

    expect(result).toBeUndefined()
  })

  it('treats a bare include token as not matching a dashed flag (force does not match --force)', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
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
          include: [force]
`
    )

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'git rebase --force main' })
    )

    expect(result).toBeUndefined()
  })

  it('classifies a command as bash:unknown when cross-category entries tie on specificity', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
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
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'git stash' })
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bash:unknown'),
      reasonCode: 'policy-deny',
    })
  })
})

describe('default policy git classification (Phase 4.1)', () => {
  it('classifies git log as bash:read and allows it under --guardrail read-only', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'git log -n 5' })
    )

    expect(result).toBeUndefined()
  })

  it('does not classify a bare git command (git push) as bash:read and denies it under --guardrail read-only', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'git push origin main' })
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bash:unknown'),
      reasonCode: 'policy-deny',
    })
  })

  it('allows git diff with a non-excluded flag (git diff --stat) under --guardrail read-only', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'git diff --stat' })
    )

    expect(result).toBeUndefined()
  })

  it('treats an exclude token as exact (git diff --not-output does not trigger the --output exclusion) and allows it', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'git diff --not-output' })
    )

    expect(result).toBeUndefined()
  })

  it('does not let a quoted token span multiple prefix words to evade the exclude check', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall } = harness

    await registerGuardrail({ pi })
    const result = await toolCall(
      fakeBashToolCallEvent({ command: 'git "diff --output=foo.patch"' })
    )

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bash:unknown'),
      reasonCode: 'policy-deny',
    })
  })
})
