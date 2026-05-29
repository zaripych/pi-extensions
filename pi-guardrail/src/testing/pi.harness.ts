import type {
  BashToolCallEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionUIContext,
  ReadToolCallEvent,
  SessionStartEvent,
  ToolCallEvent,
  ToolCallEventResult,
  WriteToolCallEvent,
} from '@earendil-works/pi-coding-agent'
import { faker } from '@faker-js/faker'
import { fromPartial } from '@total-typescript/shoehorn'
import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'

type ToolCallListener = (
  event: ToolCallEvent,
  ctx: ExtensionContext
) =>
  | ToolCallEventResult
  | undefined
  | Promise<ToolCallEventResult | undefined>

type SessionStartListener = (
  event: SessionStartEvent,
  ctx: ExtensionContext
) => undefined | Promise<undefined>

function isToolCallListener(value: unknown): value is ToolCallListener {
  return typeof value === 'function'
}

function isSessionStartListener(
  value: unknown
): value is SessionStartListener {
  return typeof value === 'function'
}

type RegisterFlagOptions = Parameters<ExtensionAPI['registerFlag']>[1]
type RegisteredFlag = { name: string; options: RegisterFlagOptions }
type RegisterCommandOptions = Parameters<ExtensionAPI['registerCommand']>[1]
type RegisteredCommand = {
  name: string
  options: RegisterCommandOptions
}
type Notification = {
  message: string
  level?: 'info' | 'warning' | 'error'
}

type SelectResponder = (
  title: string,
  options: string[]
) => string | undefined

const testDeps: {
  getFlag: ExtensionAPI['getFlag']
  respondToSelect: SelectResponder
  hasUI: () => boolean
} = {
  getFlag: () => undefined,
  respondToSelect: () => undefined,
  hasUI: () => true,
}

export const setupPiHarness = configureHarnesses(
  { inferTypesFrom: { defaultDeps: testDeps } },
  async (userDeps) =>
    configureDependencies(
      { userDeps },
      {
        getFlag: () => undefined,
        respondToSelect: () => undefined,
        hasUI: () => true,
      }
    ),
  async (userDeps) => {
    const { getFlag, respondToSelect, hasUI } = userDeps
    const registeredFlags: RegisteredFlag[] = []
    const registeredCommands = new Map<string, RegisteredCommand>()
    const notifications: Notification[] = []
    const toolCallListeners: ToolCallListener[] = []
    const sessionStartListeners: SessionStartListener[] = []
    const selectPrompts: { title: string; options: string[] }[] = []

    const registerFlag: ExtensionAPI['registerFlag'] = (name, options) => {
      registeredFlags.push({ name, options })
    }

    const registerCommand: ExtensionAPI['registerCommand'] = (
      name,
      options
    ) => {
      registeredCommands.set(name, { name, options })
    }

    const notify: ExtensionContext['ui']['notify'] = (message, level) => {
      notifications.push({ message, level })
    }

    const select: ExtensionUIContext['select'] = async (title, options) => {
      selectPrompts.push({ title, options })
      return respondToSelect(title, options)
    }

    const ctx = fromPartial<ExtensionContext>({
      ui: fromPartial({ notify, select }),
      get hasUI() {
        return hasUI()
      },
      cwd: faker.system.directoryPath(),
    })

    function on(event: 'tool_call', handler: ToolCallListener): void
    function on(event: 'session_start', handler: SessionStartListener): void
    function on(event: string, handler: unknown): void {
      if (event === 'tool_call' && isToolCallListener(handler)) {
        toolCallListeners.push(handler)
        return
      }
      if (event === 'session_start' && isSessionStartListener(handler)) {
        sessionStartListeners.push(handler)
      }
    }

    const pi = fromPartial<ExtensionAPI>({
      registerFlag,
      registerCommand,
      getFlag,
      on,
    })

    async function toolCall(
      event: ToolCallEvent
    ): Promise<ToolCallEventResult | undefined> {
      let last: ToolCallEventResult | undefined
      for (const listener of toolCallListeners) {
        last = await listener(event, ctx)
      }
      return last
    }

    async function sessionStart(event: SessionStartEvent): Promise<void> {
      for (const listener of sessionStartListeners) {
        await listener(event, ctx)
      }
    }

    async function runCommand(name: string, args: string): Promise<void> {
      const command = registeredCommands.get(name)
      if (command === undefined) {
        throw new Error(`No command registered with name "${name}"`)
      }
      const commandCtx = fromPartial<ExtensionCommandContext>({
        ui: ctx.ui,
        get hasUI() {
          return hasUI()
        },
        cwd: ctx.cwd,
      })
      await command.options.handler(args, commandCtx)
    }

    return {
      pi,
      toolCall,
      sessionStart,
      runCommand,
      notifications,
      registeredFlags,
      registeredCommands,
      selectPrompts,
    }
  }
)

export function fakeBashToolCallEvent(params: {
  command: string
}): BashToolCallEvent {
  return {
    type: 'tool_call',
    toolCallId: faker.string.uuid(),
    toolName: 'bash',
    input: { command: params.command },
  }
}

export function fakeWriteToolCallEvent(): WriteToolCallEvent {
  return {
    type: 'tool_call',
    toolCallId: faker.string.uuid(),
    toolName: 'write',
    input: {
      path: faker.system.filePath(),
      content: faker.lorem.paragraph(),
    },
  }
}

export function fakeReadToolCallEvent(): ReadToolCallEvent {
  return {
    type: 'tool_call',
    toolCallId: faker.string.uuid(),
    toolName: 'read',
    input: { path: faker.system.filePath() },
  }
}

export function fakeSessionStartEvent(): SessionStartEvent {
  return { type: 'session_start', reason: 'startup' }
}
