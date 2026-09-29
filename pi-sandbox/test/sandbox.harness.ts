import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionHandler,
  RegisteredCommand,
  SessionStartEvent,
  ToolCallEvent,
  ToolCallEventResult,
  UserBashEvent,
  UserBashEventResult,
} from "@earendil-works/pi-coding-agent";

import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { promisify } from "node:util";

import { createSandboxManager, SandboxRuntimeConfigSchema } from "@carderne/sandbox-runtime";
import { wrapCommandWithSandboxMacOS } from "@carderne/sandbox-runtime/dist/sandbox/macos-sandbox-utils.js";
import { fromPartial } from "@total-typescript/shoehorn";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { loadConfig, type SandboxConfigFile } from "../src/config.ts";
import extension from "../src/extension.ts";

type Manager = ReturnType<typeof extension.defaultDeps.createSandboxManager>;
type ConfigFile = Omit<SandboxConfigFile, "allowUnsandboxedPs"> & {
  allowUnsandboxedPs?: boolean | string | number | null | boolean[] | { enabled: boolean };
};

function isHandler<E, R = undefined>(value: unknown): value is ExtensionHandler<E, R> {
  return typeof value === "function";
}

export async function setupSandbox({ context }: { context: TestContext }) {
  const directory = await mkdtemp(join(tmpdir(), "pi-sandbox-ps-"));
  const globalDirectory = join(directory, "agent");
  const cwd = join(directory, "project");
  const deniedPath = join(directory, "outside");
  await mkdir(globalDirectory);
  await mkdir(join(cwd, ".pi"), { recursive: true });
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const originalNodeEnvProxy = process.env.NODE_USE_ENV_PROXY;
  process.env.PI_CODING_AGENT_DIR = globalDirectory;
  const runtimeManager = createSandboxManager();
  context.after(async () => {
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    if (originalNodeEnvProxy === undefined) delete process.env.NODE_USE_ENV_PROXY;
    else process.env.NODE_USE_ENV_PROXY = originalNodeEnvProxy;
    await runtimeManager.reset();
    await rm(directory, { recursive: true, force: true });
  });

  const initialize = context.mock.fn<Manager["initialize"]>(async () => {});
  const updateConfig = context.mock.fn<Manager["updateConfig"]>(() => {});
  const reset = context.mock.fn<Manager["reset"]>(async () => {});
  const wrapWithSandbox = context.mock.fn<Manager["wrapWithSandbox"]>(async () => {
    throw new Error("test sandbox wrapper reached");
  });
  const notify = context.mock.fn<ExtensionCommandContext["ui"]["notify"]>();
  const warn = context.mock.method(console, "warn", () => {});
  let sessionStart: ExtensionHandler<SessionStartEvent> | undefined;
  let toolCall: ExtensionHandler<ToolCallEvent, ToolCallEventResult> | undefined;
  let userBash: ExtensionHandler<UserBashEvent, UserBashEventResult> | undefined;
  let bash: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
  const commands = new Map<string, RegisteredCommand>();
  let permissionAction = "abort";
  const ctx = fromPartial<ExtensionCommandContext>({
    cwd,
    hasUI: true,
    ui: {
      notify,
      setStatus() {},
      theme: { fg: (_color: string, text: string) => text },
      custom: async () => ({ action: permissionAction, value: deniedPath }),
    },
  });
  const pi = fromPartial<ExtensionAPI>({
    registerFlag() {},
    registerTool: (tool: NonNullable<typeof bash>) => {
      bash = tool;
    },
    registerShortcut() {},
    events: { emit() {} },
    getFlag: () => false,
    on: (event: string, handler: unknown) => {
      if (event === "session_start" && isHandler<SessionStartEvent>(handler))
        sessionStart = handler;
      if (event === "tool_call" && isHandler<ToolCallEvent, ToolCallEventResult>(handler))
        toolCall = handler;
      if (event === "user_bash" && isHandler<UserBashEvent, UserBashEventResult>(handler))
        userBash = handler;
    },
    registerCommand: (name: string, options: Omit<RegisteredCommand, "name">) =>
      commands.set(name, { name, ...options }),
  });
  extension(pi, {
    createSandboxManager: () => ({
      ...runtimeManager,
      initialize,
      updateConfig,
      reset,
      wrapWithSandbox,
    }),
  });

  async function writeConfig({
    global = {},
    project = {},
  }: {
    global?: ConfigFile;
    project?: ConfigFile;
  }) {
    await writeFile(join(globalDirectory, "sandbox.json"), JSON.stringify(global));
    await writeFile(join(cwd, ".pi", "sandbox.json"), JSON.stringify(project));
  }

  function wrapCommand(params: { command?: string; allowUnsandboxedPs?: boolean } = {}) {
    return wrapCommandWithSandboxMacOS({
      command: "/bin/echo confined",
      binShell: "/bin/sh",
      needsNetworkRestriction: true,
      readConfig: { denyOnly: [join(directory, "denied")] },
      writeConfig: { allowOnly: [], denyWithinAllow: [] },
      ...params,
    });
  }

  async function runMacOSCommand(params: Parameters<typeof wrapCommand>[0]) {
    try {
      const result = await promisify(execFile)("/bin/sh", ["-c", wrapCommand(params)], {
        timeout: 5000,
      });
      return { exitCode: 0, ...result };
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        typeof error.code !== "number" ||
        !("stdout" in error) ||
        typeof error.stdout !== "string" ||
        !("stderr" in error) ||
        typeof error.stderr !== "string"
      )
        throw error;
      return { exitCode: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  }

  return {
    initialize,
    updateConfig,
    reset,
    notify,
    warn,
    cwd,
    directory,
    deniedPath,
    writeConfig,
    createSandboxManager: () => {
      const manager = createSandboxManager();
      context.after(() => manager.reset());
      return manager;
    },
    loadConfig: () => loadConfig(cwd),
    sessionStart: () => {
      assert.ok(sessionStart);
      return sessionStart({ type: "session_start", reason: "startup" }, ctx);
    },
    runCommand: (name: string) => {
      const command = commands.get(name);
      assert.ok(command);
      return command.handler("", ctx);
    },
    toolCall: (event: ToolCallEvent) => {
      assert.ok(toolCall);
      return toolCall(event, ctx);
    },
    grantRead: async () => {
      assert.ok(toolCall);
      permissionAction = "session";
      try {
        return await toolCall(
          { type: "tool_call", toolCallId: "read", toolName: "read", input: { path: deniedPath } },
          ctx,
        );
      } finally {
        permissionAction = "abort";
      }
    },
    bash: async () => {
      assert.ok(bash);
      return bash.execute("test", { command: "exit 0" }, undefined, undefined, ctx);
    },
    userBash: () => {
      assert.ok(userBash);
      return userBash(
        { type: "user_bash", command: "exit 0", cwd, excludeFromContext: false },
        ctx,
      );
    },
    wrapCommand,
    runMacOSCommand,
    SandboxRuntimeConfigSchema,
    initializeRuntime: () =>
      runtimeManager.initialize({
        network: { allowedDomains: [], deniedDomains: [] },
        filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
      }),
    resetRuntime: () => runtimeManager.reset(),
    updateRuntimeConfig: (config: Parameters<Manager["updateConfig"]>[0]) =>
      runtimeManager.updateConfig(config),
    wrapWithSandbox: (params: { command: string; allowUnsandboxedPs?: boolean }) =>
      runtimeManager.wrapWithSandbox(params.command, "/bin/sh", {
        allowUnsandboxedPs: params.allowUnsandboxedPs,
      }),
  };
}
