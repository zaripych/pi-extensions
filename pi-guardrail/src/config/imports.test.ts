import { dirname, join } from 'node:path'
import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupRegisterGuardrail } from '../register.harness'
import {
  fakeBashToolCallEvent,
  fakeBeforeAgentStartEvent,
  fakeReadToolCallEvent,
  fakeSessionStartEvent,
  setupPiHarness,
} from '../testing/pi.harness'

const setup = combineHarnesses(setupPiHarness, setupRegisterGuardrail)

const readOnlyModes = `modes:
  read-only: { allow: ["bash:read"], ask: [], deny: ["bash:write", "bash:dangerous"] }
  hand-hold: { allow: ["bash:read"], ask: ["bash:write", "bash:dangerous"], deny: [] }`

function importDir(configPath: string): string {
  return dirname(configPath)
}

describe('bash import end to end', () => {
  it('classifies an imported command additively to the main policy', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(
      configPath,
      `${readOnlyModes}
bash:
  import:
    - ./policy.aws.yaml
  read:
    - name: defaults
      description: read commands
      commands: [pwd]
  write: []
  dangerous: []
`
    )
    await writeFile(
      join(importDir(configPath), 'policy.aws.yaml'),
      `command: aws
description: AWS CLI commands.
read:
  - aws s3 ls
write:
  - aws s3 cp
dangerous: []
`
    )

    await registerGuardrail({ pi })
    const read = await toolCall(fakeBashToolCallEvent({ command: 'aws s3 ls' }))
    const write = await toolCall(fakeBashToolCallEvent({ command: 'aws s3 cp' }))

    expect(read).toBeUndefined()
    expect(write).toEqual({
      block: true,
      reason: expect.stringContaining('read-only'),
      reasonCode: 'policy-deny',
    })
  })

  it('fails closed when a referenced import file is missing', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(
      configPath,
      `${readOnlyModes}
bash:
  import:
    - ./policy.missing.yaml
  read: []
  write: []
  dangerous: []
`
    )

    await registerGuardrail({ pi })
    const result = await toolCall(fakeReadToolCallEvent())

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('policy.missing.yaml'),
      reasonCode: 'config-error',
    })
  })

  it('fails closed when an import file is structurally invalid', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, toolCall, writeFile, configPath } = harness
    await writeFile(
      configPath,
      `${readOnlyModes}
bash:
  import:
    - ./policy.aws.yaml
  read: []
  write: []
  dangerous: []
`
    )
    await writeFile(
      join(importDir(configPath), 'policy.aws.yaml'),
      `command: aws
read:
  - aws s3 ls
`
    )

    await registerGuardrail({ pi })
    const result = await toolCall(fakeReadToolCallEvent())

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('policy.aws.yaml'),
      reasonCode: 'config-error',
    })
  })

  it('drops an imported entry whose prefix does not start with command and warns', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const {
      pi,
      registerGuardrail,
      sessionStart,
      toolCall,
      notifications,
      writeFile,
      configPath,
    } = harness
    await writeFile(
      configPath,
      `${readOnlyModes}
bash:
  import:
    - ./policy.aws.yaml
  read: []
  write: []
  dangerous: []
`
    )
    await writeFile(
      join(importDir(configPath), 'policy.aws.yaml'),
      `command: aws
description: AWS CLI commands.
read:
  - aws s3 ls
  - kubectl get
write: []
dangerous: []
`
    )

    await registerGuardrail({ pi })
    await sessionStart(fakeSessionStartEvent())
    const valid = await toolCall(fakeBashToolCallEvent({ command: 'aws s3 ls' }))
    const dropped = await toolCall(
      fakeBashToolCallEvent({ command: 'kubectl get' })
    )

    expect(valid).toBeUndefined()
    expect(dropped).toEqual({
      block: true,
      reason: expect.stringContaining('read-only'),
      reasonCode: 'policy-deny',
    })
    expect(notifications).toEqual([
      {
        level: 'warning',
        message: expect.stringContaining('/guardrail doctor'),
      },
    ])
  })

  it('ignores all imports that share the same command and warns', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const {
      pi,
      registerGuardrail,
      sessionStart,
      toolCall,
      notifications,
      writeFile,
      configPath,
    } = harness
    await writeFile(
      configPath,
      `${readOnlyModes}
bash:
  import:
    - ./policy.aws.a.yaml
    - ./policy.aws.b.yaml
  read: []
  write: []
  dangerous: []
`
    )
    await writeFile(
      join(importDir(configPath), 'policy.aws.a.yaml'),
      `command: aws
description: AWS commands A.
read:
  - aws s3 ls
write: []
dangerous: []
`
    )
    await writeFile(
      join(importDir(configPath), 'policy.aws.b.yaml'),
      `command: aws
description: AWS commands B.
read:
  - aws ec2 describe-instances
write: []
dangerous: []
`
    )

    await registerGuardrail({ pi })
    await sessionStart(fakeSessionStartEvent())
    const fromA = await toolCall(fakeBashToolCallEvent({ command: 'aws s3 ls' }))
    const fromB = await toolCall(
      fakeBashToolCallEvent({ command: 'aws ec2 describe-instances' })
    )

    expect(fromA).toEqual({
      block: true,
      reason: expect.stringContaining('read-only'),
      reasonCode: 'policy-deny',
    })
    expect(fromB).toEqual({
      block: true,
      reason: expect.stringContaining('read-only'),
      reasonCode: 'policy-deny',
    })
    expect(notifications).toEqual([
      {
        level: 'warning',
        message: expect.stringContaining('/guardrail doctor'),
      },
    ])
  })

  it('reports a duplicate import command with its file paths when /guardrail doctor runs', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, runCommand, notifications, writeFile, configPath } =
      harness
    await writeFile(
      configPath,
      `${readOnlyModes}
bash:
  import:
    - ./policy.aws.a.yaml
    - ./policy.aws.b.yaml
  read: []
  write: []
  dangerous: []
`
    )
    await writeFile(
      join(importDir(configPath), 'policy.aws.a.yaml'),
      `command: aws
description: AWS A.
read: [aws s3 ls]
write: []
dangerous: []
`
    )
    await writeFile(
      join(importDir(configPath), 'policy.aws.b.yaml'),
      `command: aws
description: AWS B.
read: [aws ec2 describe-instances]
write: []
dangerous: []
`
    )

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'doctor')

    expect(notifications).toEqual([
      {
        level: 'warning',
        message: expect.stringMatching(
          /duplicate[\s\S]*aws[\s\S]*policy\.aws\.a\.yaml[\s\S]*policy\.aws\.b\.yaml/i
        ),
      },
    ])
  })

  it('treats whitespace-variant import commands as duplicates when /guardrail doctor runs', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, runCommand, notifications, writeFile, configPath } =
      harness
    await writeFile(
      configPath,
      `${readOnlyModes}
bash:
  import:
    - ./policy.aws.a.yaml
    - ./policy.aws.b.yaml
  read: []
  write: []
  dangerous: []
`
    )
    await writeFile(
      join(importDir(configPath), 'policy.aws.a.yaml'),
      `command: aws
description: AWS A.
read: [aws s3 ls]
write: []
dangerous: []
`
    )
    await writeFile(
      join(importDir(configPath), 'policy.aws.b.yaml'),
      `command: "aws "
description: AWS B.
read: [aws ec2 describe-instances]
write: []
dangerous: []
`
    )

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'doctor')

    expect(notifications).toEqual([
      {
        level: 'warning',
        message: expect.stringMatching(
          /duplicate[\s\S]*aws[\s\S]*policy\.aws\.a\.yaml[\s\S]*policy\.aws\.b\.yaml/i
        ),
      },
    ])
  })

  it('reports a duplicate when the same import file is listed twice and /guardrail doctor runs', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, runCommand, notifications, writeFile, configPath } =
      harness
    await writeFile(
      configPath,
      `${readOnlyModes}
bash:
  import:
    - ./policy.aws.yaml
    - ./policy.aws.yaml
  read: []
  write: []
  dangerous: []
`
    )
    await writeFile(
      join(importDir(configPath), 'policy.aws.yaml'),
      `command: aws
description: AWS.
read: [aws s3 ls]
write: []
dangerous: []
`
    )

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'doctor')

    expect(notifications).toEqual([
      {
        level: 'warning',
        message: expect.stringMatching(/duplicate[\s\S]*aws[\s\S]*policy\.aws\.yaml/i),
      },
    ])
  })

  it('reports an import prefix violation with the offending command when /guardrail doctor runs', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, runCommand, notifications, writeFile, configPath } =
      harness
    await writeFile(
      configPath,
      `${readOnlyModes}
bash:
  import:
    - ./policy.aws.yaml
  read: []
  write: []
  dangerous: []
`
    )
    await writeFile(
      join(importDir(configPath), 'policy.aws.yaml'),
      `command: aws
description: AWS.
read:
  - aws s3 ls
  - kubectl get
write: []
dangerous: []
`
    )

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'doctor')

    expect(notifications).toEqual([
      {
        level: 'warning',
        message: expect.stringMatching(
          /prefix[\s\S]*policy\.aws\.yaml[\s\S]*kubectl get/i
        ),
      },
    ])
  })

  it('does not advertise ignored duplicate imports in the system prompt', async () => {
    await using harness = await setup({ getFlag: () => 'hand-hold' })
    const {
      pi,
      registerGuardrail,
      beforeAgentStart,
      writeFile,
      configPath,
    } = harness
    await writeFile(
      configPath,
      `${readOnlyModes}
bash:
  import:
    - ./policy.aws.a.yaml
    - ./policy.aws.b.yaml
  read: []
  write: []
  dangerous: []
`
    )
    await writeFile(
      join(importDir(configPath), 'policy.aws.a.yaml'),
      `command: aws
description: AWS-ALPHA-DESCRIPTION.
read: [aws s3 ls]
write: []
dangerous: []
`
    )
    await writeFile(
      join(importDir(configPath), 'policy.aws.b.yaml'),
      `command: aws
description: AWS-BETA-DESCRIPTION.
read: [aws ec2 describe-instances]
write: []
dangerous: []
`
    )

    await registerGuardrail({ pi })
    const systemPrompt = await beforeAgentStart(fakeBeforeAgentStartEvent())

    expect(systemPrompt).not.toContain('AWS-ALPHA-DESCRIPTION')
    expect(systemPrompt).not.toContain('AWS-BETA-DESCRIPTION')
  })

  it('does not advertise an import whose entries were all dropped in the system prompt', async () => {
    await using harness = await setup({ getFlag: () => 'hand-hold' })
    const {
      pi,
      registerGuardrail,
      beforeAgentStart,
      writeFile,
      configPath,
    } = harness
    await writeFile(
      configPath,
      `${readOnlyModes}
bash:
  import:
    - ./policy.aws.yaml
  read: []
  write: []
  dangerous: []
`
    )
    await writeFile(
      join(importDir(configPath), 'policy.aws.yaml'),
      `command: aws
description: AWS-DROPPED-DESCRIPTION.
read:
  - kubectl get
write: []
dangerous: []
`
    )

    await registerGuardrail({ pi })
    const systemPrompt = await beforeAgentStart(fakeBeforeAgentStartEvent())

    expect(systemPrompt).not.toContain('AWS-DROPPED-DESCRIPTION')
  })

  it('reports a cross-category ambiguity between an imported entry and a main entry when /guardrail doctor runs', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, runCommand, notifications, writeFile, configPath } =
      harness
    await writeFile(
      configPath,
      `${readOnlyModes}
bash:
  import:
    - ./policy.git.yaml
  read:
    - name: main-read
      description: main read
      commands: [git stash]
  write: []
  dangerous: []
`
    )
    await writeFile(
      join(importDir(configPath), 'policy.git.yaml'),
      `command: git
description: Git.
read: []
write: []
dangerous: [git stash]
`
    )

    await registerGuardrail({ pi })
    notifications.length = 0
    await runCommand('guardrail', 'doctor')

    expect(notifications).toEqual([
      {
        level: 'warning',
        message: expect.stringMatching(
          /git stash[\s\S]*policy\.git\.yaml/i
        ),
      },
    ])
  })
})
