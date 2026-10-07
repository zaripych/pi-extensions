import type {
  BashToolCallEvent,
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionUIContext,
  ReadToolCallEvent,
  SessionStartEvent,
  ThemeColor,
  ToolCallEvent,
  ToolCallEventResult,
  ToolInfo,
  WriteToolCallEvent,
} from '@earendil-works/pi-coding-agent'
import { faker } from '@faker-js/faker'
import { fromPartial } from '@total-typescript/shoehorn'
import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'

type ToolCallListener = (
  event: ToolCallEvent,
  ctx: ExtensionContext
) => ToolCallEventResult | undefined | Promise<ToolCallEventResult | undefined>

type SessionStartListener = (
  event: SessionStartEvent,
  ctx: ExtensionContext
) => undefined | Promise<undefined>

type BeforeAgentStartListener = (
  event: BeforeAgentStartEvent,
  ctx: ExtensionContext
) =>
  | BeforeAgentStartEventResult
  | undefined
  | Promise<BeforeAgentStartEventResult | undefined>

function isToolCallListener(value: unknown): value is ToolCallListener {
  return typeof value === 'function'
}

function isSessionStartListener(value: unknown): value is SessionStartListener {
  return typeof value === 'function'
}

function isBeforeAgentStartListener(
  value: unknown
): value is BeforeAgentStartListener {
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

type SelectResponder = (title: string, options: string[]) => string | undefined

/** Types derived from pi's own custom-component factory signature. */
type CustomFactory = Parameters<ExtensionUIContext['custom']>[0]
type CustomFactoryArgs = Parameters<CustomFactory>
type CustomTui = CustomFactoryArgs[0]
type CustomTheme = CustomFactoryArgs[1]
type CustomKeybindings = CustomFactoryArgs[2]
type CustomDone = CustomFactoryArgs[3]
type CustomComponent = Awaited<ReturnType<CustomFactory>>

type ActiveCustom = {
  component: CustomComponent
  finish: CustomDone
}

const defaultTestDeps: {
  getFlag: ExtensionAPI['getFlag']
  respondToSelect: SelectResponder
  respondToConfirm: () => boolean
  hasUI: () => boolean
  getAllTools: () => string[]
} = {
  getFlag: () => undefined,
  respondToSelect: () => undefined,
  respondToConfirm: () => false,
  hasUI: () => true,
  getAllTools: () => ['read', 'grep', 'find', 'ls', 'write', 'edit', 'bash'],
}

export const setupPiHarness = configureHarnesses(
  { inferTypesFrom: { defaultDeps: defaultTestDeps } },
  async (userDeps) => configureDependencies({ userDeps }, defaultTestDeps),
  async (userDeps) => {
    const { getFlag, respondToSelect, respondToConfirm, hasUI, getAllTools } =
      userDeps
    const registeredFlags: RegisteredFlag[] = []
    const registeredCommands = new Map<string, RegisteredCommand>()
    const notifications: Notification[] = []
    const toolCallListeners: ToolCallListener[] = []
    const sessionStartListeners: SessionStartListener[] = []
    const beforeAgentStartListeners: BeforeAgentStartListener[] = []
    const selectPrompts: { title: string; options: string[] }[] = []
    const activeToolsCalls: string[][] = []

    // Mirrors pi's loader: runtime-bound action methods (getAllTools,
    // setActiveTools, ...) throw during extension loading and only work once
    // the session runtime is bound. Tests enter the runtime phase by invoking
    // a runtime entry point (session_start, tool_call, or a command).
    let runtimeActive = false
    const assertRuntimeActive = () => {
      if (!runtimeActive) {
        throw new Error(
          'Extension runtime not initialized. Action methods cannot be called during extension loading.'
        )
      }
    }

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

    const confirmPrompts: { title: string; message: string }[] = []
    const confirm: ExtensionUIContext['confirm'] = async (title, message) => {
      confirmPrompts.push({ title, message })
      return respondToConfirm()
    }

    // ui.custom: captures the component, strips theme styling, and exposes
    // renderCustom/pressCustom/finishCustom for driving it
    const stubTui = fromPartial<CustomTui>({ requestRender: () => undefined })
    const stubTheme = fromPartial<CustomTheme>({
      fg: (_color: ThemeColor, text: string) => text,
      bold: (text: string) => text,
    })
    const stubKeybindings = fromPartial<CustomKeybindings>({})
    let activeCustom: ActiveCustom | undefined

    const customImpl = (factory: CustomFactory): Promise<unknown> =>
      new Promise((resolve) => {
        let component: CustomComponent | undefined
        const done: CustomDone = (result) => {
          if (activeCustom?.component === component) {
            activeCustom = undefined
          }
          component?.dispose?.()
          resolve(result)
        }
        void Promise.resolve(
          factory(stubTui, stubTheme, stubKeybindings, done)
        ).then((created) => {
          component = created
          activeCustom = { component: created, finish: done }
        })
      })
    // the resolved value is exactly what the factory's typed done callback
    // received, so the unknown-to-T rebrand is safe at runtime
    const custom: ExtensionUIContext['custom'] = fromPartial(customImpl)

    const ctx = fromPartial<ExtensionContext>({
      ui: fromPartial({ notify, select, confirm, custom }),
      get hasUI() {
        return hasUI()
      },
      cwd: faker.system.directoryPath(),
    })

    function on(event: 'tool_call', handler: ToolCallListener): void
    function on(event: 'session_start', handler: SessionStartListener): void
    function on(
      event: 'before_agent_start',
      handler: BeforeAgentStartListener
    ): void
    function on(event: string, handler: unknown): void {
      if (event === 'tool_call' && isToolCallListener(handler)) {
        toolCallListeners.push(handler)
        return
      }
      if (event === 'session_start' && isSessionStartListener(handler)) {
        sessionStartListeners.push(handler)
        return
      }
      if (
        event === 'before_agent_start' &&
        isBeforeAgentStartListener(handler)
      ) {
        beforeAgentStartListeners.push(handler)
      }
    }

    const getAllToolsImpl: ExtensionAPI['getAllTools'] = () => {
      assertRuntimeActive()
      return getAllTools().map((name) => fromPartial<ToolInfo>({ name }))
    }

    const setActiveTools: ExtensionAPI['setActiveTools'] = (toolNames) => {
      assertRuntimeActive()
      activeToolsCalls.push([...toolNames])
    }

    const getActiveTools: ExtensionAPI['getActiveTools'] = () => {
      assertRuntimeActive()
      return activeToolsCalls.at(-1) ?? getAllTools()
    }

    const pi = fromPartial<ExtensionAPI>({
      registerFlag,
      registerCommand,
      getFlag,
      on,
      getAllTools: getAllToolsImpl,
      setActiveTools,
      getActiveTools,
    })

    async function toolCall(
      event: ToolCallEvent
    ): Promise<ToolCallEventResult | undefined> {
      runtimeActive = true
      let last: ToolCallEventResult | undefined
      for (const listener of toolCallListeners) {
        last = await listener(event, ctx)
      }
      return last
    }

    async function sessionStart(event: SessionStartEvent): Promise<void> {
      runtimeActive = true
      for (const listener of sessionStartListeners) {
        await listener(event, ctx)
      }
    }

    // Mirrors pi chaining before_agent_start systemPrompt replacements: each
    // listener that returns a systemPrompt replaces it for the next listener.
    async function beforeAgentStart(
      event: BeforeAgentStartEvent
    ): Promise<string> {
      runtimeActive = true
      let systemPrompt = event.systemPrompt
      for (const listener of beforeAgentStartListeners) {
        const result = await listener({ ...event, systemPrompt }, ctx)
        if (result?.systemPrompt !== undefined) {
          systemPrompt = result.systemPrompt
        }
      }
      return systemPrompt
    }

    async function runCommand(name: string, args: string): Promise<void> {
      runtimeActive = true
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

    async function completeCommand(name: string, prefix: string) {
      const command = registeredCommands.get(name)
      if (command === undefined) {
        throw new Error(`No command registered with name "${name}"`)
      }
      const provider = command.options.getArgumentCompletions
      if (provider === undefined) return undefined
      return provider(prefix)
    }

    /** Renders the active ui.custom component. Do not await runCommand
     * before the component has finished — the command handler blocks on the
     * component's completion promise. */
    function renderCustom(width: number): string[] {
      if (activeCustom === undefined) {
        throw new Error('no active ui.custom component')
      }
      return activeCustom.component.render(width)
    }

    /** Sends a key to the active ui.custom component's handleInput. */
    function pressCustom(key: string): void {
      if (activeCustom === undefined) {
        throw new Error('no active ui.custom component')
      }
      activeCustom.component.handleInput?.(key)
    }

    /** Finishes the active ui.custom component; resolves its promise and
     * disposes the component, unblocking the awaiting command handler. */
    function finishCustom(result?: unknown): void {
      if (activeCustom === undefined) {
        throw new Error('no active ui.custom component')
      }
      activeCustom.finish(result)
    }

    return {
      pi,
      toolCall,
      sessionStart,
      beforeAgentStart,
      runCommand,
      completeCommand,
      notifications,
      registeredFlags,
      registeredCommands,
      selectPrompts,
      confirmPrompts,
      activeToolsCalls,
      activeTools: () => activeToolsCalls.at(-1),
      renderCustom,
      pressCustom,
      finishCustom,
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

export function fakeToolCallEvent(params: {
  toolName: string
  input?: Record<string, unknown>
}): ToolCallEvent {
  return fromPartial<ToolCallEvent>({
    type: 'tool_call',
    toolCallId: faker.string.uuid(),
    toolName: params.toolName,
    input: params.input ?? {},
  })
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

export function fakeBeforeAgentStartEvent(params?: {
  systemPrompt?: string
}): BeforeAgentStartEvent {
  return fromPartial<BeforeAgentStartEvent>({
    type: 'before_agent_start',
    prompt: faker.lorem.sentence(),
    systemPrompt: params?.systemPrompt ?? faker.lorem.paragraph(),
  })
}
