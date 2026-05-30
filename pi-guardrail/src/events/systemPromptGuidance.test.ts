import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupRegisterGuardrail } from '../register.harness'
import {
  fakeBeforeAgentStartEvent,
  setupPiHarness,
} from '../testing/pi.harness'

const setup = combineHarnesses(setupPiHarness, setupRegisterGuardrail)

describe('system prompt guidance', () => {
  it('appends hand-hold guidance from the default policy to the system prompt', async () => {
    await using harness = await setup({ getFlag: () => 'hand-hold' })
    const { pi, registerGuardrail, beforeAgentStart } = harness

    await registerGuardrail({ pi })
    const systemPrompt = await beforeAgentStart(
      fakeBeforeAgentStartEvent({ systemPrompt: 'BASE PROMPT' })
    )

    expect(systemPrompt).toMatchInlineSnapshot(`
      "BASE PROMPT

      Guardrail mode: hand-hold.

      Tools allowed without approval:
      - read
      - grep
      - find
      - ls

      Tools that require approval:
      - write
      - edit

      The bash tool runs shell commands. Each command is classified, and its classification decides how guardrail handles it:
      - bash:read (allowed without approval): Local inspection commands that read but do not modify project files: pwd, cat, head, tail, wc, file, stat; the non-mutating git subcommands status, diff, log, and show (their --output flag is excluded because it writes a file) plus rev-parse; and --version checks for git, node, npm, pnpm, yarn, python, python3, and uv. Any of these may redirect stdout/stderr into the system scratch directory (os.tmpdir(), e.g. $TMPDIR) and still count as bash:read; redirecting to any other path is not bash:read.
      - bash:write (requires approval): Package-manager commands that add, remove, or update dependencies or lockfiles: npm install/uninstall/update, pnpm install/add/remove/update, yarn install/add/remove, and uv add/remove/sync.
      - bash:dangerous (requires approval): Shell and system commands that can irreversibly destroy data or alter machine state: rm and rmdir (delete files/directories); sudo (run as another user); chmod, chown, and chgrp (change permissions/ownership); kill, pkill, and killall (terminate processes); shutdown and reboot (power state); and dd, mkfs, mount, and umount (raw disk and filesystem operations).
      - bash:unknown (requires approval by built-in guardrail behavior): any bash command that matches none of the classifications above.

      When a tool call or bash command requires approval, do not issue it in parallel with any other approval-required action. Wait for the result before requesting another. If unsure whether a bash command is bash:read, assume it requires approval."
    `)
  })

  it('appends read-only guidance from the default policy to the system prompt', async () => {
    await using harness = await setup({ getFlag: () => 'read-only' })
    const { pi, registerGuardrail, beforeAgentStart } = harness

    await registerGuardrail({ pi })
    const systemPrompt = await beforeAgentStart(
      fakeBeforeAgentStartEvent({ systemPrompt: 'BASE PROMPT' })
    )

    expect(systemPrompt).toMatchInlineSnapshot(`
      "BASE PROMPT

      Guardrail mode: read-only.

      Tools allowed without approval:
      - read
      - grep
      - find
      - ls

      Tools that are denied:
      - write
      - edit

      The bash tool runs shell commands. Each command is classified, and its classification decides how guardrail handles it:
      - bash:read (allowed without approval): Local inspection commands that read but do not modify project files: pwd, cat, head, tail, wc, file, stat; the non-mutating git subcommands status, diff, log, and show (their --output flag is excluded because it writes a file) plus rev-parse; and --version checks for git, node, npm, pnpm, yarn, python, python3, and uv. Any of these may redirect stdout/stderr into the system scratch directory (os.tmpdir(), e.g. $TMPDIR) and still count as bash:read; redirecting to any other path is not bash:read.
      - bash:write (denied): Package-manager commands that add, remove, or update dependencies or lockfiles: npm install/uninstall/update, pnpm install/add/remove/update, yarn install/add/remove, and uv add/remove/sync.
      - bash:dangerous (denied): Shell and system commands that can irreversibly destroy data or alter machine state: rm and rmdir (delete files/directories); sudo (run as another user); chmod, chown, and chgrp (change permissions/ownership); kill, pkill, and killall (terminate processes); shutdown and reboot (power state); and dd, mkfs, mount, and umount (raw disk and filesystem operations).
      - bash:unknown (denied by built-in guardrail behavior): any bash command that matches none of the classifications above."
    `)
  })

  it('lists capabilities and bash group descriptions without listing the commands', async () => {
    await using harness = await setup({ getFlag: () => 'hand-hold' })
    const { pi, registerGuardrail, beforeAgentStart, writeFile, configPath } =
      harness
    await writeFile(
      configPath,
      `modes:
  read-only: { allow: ["read", "bash:read"], ask: [], deny: ["write", "bash:write"] }
  hand-hold:
    allow: ["read", "grep", "bash:read"]
    ask: ["write", "edit", "bash:write"]
    deny: ["bash:dangerous"]
bash:
  read:
    - name: defaults
      description: Read-only inspection of the working tree.
      commands: [pwd, cat, headupcommand]
  write:
    - name: pkg
      description: Package manager mutations.
      commands: [npm install]
  dangerous:
    - name: destructive
      description: Destructive filesystem operations.
      commands: [rm]
`
    )

    await registerGuardrail({ pi })
    const systemPrompt = await beforeAgentStart(
      fakeBeforeAgentStartEvent({ systemPrompt: 'BASE PROMPT' })
    )

    expect(systemPrompt).toMatchInlineSnapshot(`
      "BASE PROMPT

      Guardrail mode: hand-hold.

      Tools allowed without approval:
      - read
      - grep

      Tools that require approval:
      - write
      - edit

      The bash tool runs shell commands. Each command is classified, and its classification decides how guardrail handles it:
      - bash:read (allowed without approval): Read-only inspection of the working tree.
      - bash:write (requires approval): Package manager mutations.
      - bash:dangerous (denied): Destructive filesystem operations.
      - bash:unknown (requires approval by built-in guardrail behavior): any bash command that matches none of the classifications above.

      When a tool call or bash command requires approval, do not issue it in parallel with any other approval-required action. Wait for the result before requesting another. If unsure whether a bash command is bash:read, assume it requires approval."
    `)
    expect(systemPrompt).not.toContain('headupcommand')
  })

  it('reflects the deny-all state in the guidance when in config-error deny-all mode', async () => {
    await using harness = await setup({
      getFlag: () => 'read-only',
      fileExists: async () => true,
      readFile: async () => {
        throw new Error('EACCES: permission denied')
      },
    })
    const { pi, registerGuardrail, beforeAgentStart } = harness

    await registerGuardrail({ pi })
    const systemPrompt = await beforeAgentStart(
      fakeBeforeAgentStartEvent({ systemPrompt: 'BASE PROMPT' })
    )

    expect(systemPrompt).toMatchInlineSnapshot(`
      "BASE PROMPT

      Guardrail is in config-error deny-all mode. Every model tool call is denied until the configuration is fixed."
    `)
  })

  it('leaves the system prompt unchanged when guardrail is off', async () => {
    await using harness = await setup({ getFlag: () => 'off' })
    const { pi, registerGuardrail, beforeAgentStart } = harness

    await registerGuardrail({ pi })
    const systemPrompt = await beforeAgentStart(
      fakeBeforeAgentStartEvent({ systemPrompt: 'BASE PROMPT ONLY' })
    )

    expect(systemPrompt).toMatchInlineSnapshot(`"BASE PROMPT ONLY"`)
  })
})
