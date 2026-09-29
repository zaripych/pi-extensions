import test from "node:test";

import assert from "node:assert/strict";

import { canRunSandboxExec } from "./canRunSandboxExec.ts";
import { setupSandbox } from "./sandbox.harness.ts";

const psRule = '(allow process-exec (literal "/bin/ps") (with no-sandbox))';

for (const allowUnsandboxedPs of [undefined, false, true]) {
  void test(`forwards allowUnsandboxedPs=${allowUnsandboxedPs} through initialization and updates`, async (context) => {
    const harness = await setupSandbox({ context });
    await harness.writeConfig({ global: { allowUnsandboxedPs } });
    assert.partialDeepStrictEqual(harness.loadConfig(), {
      enabled: true,
      allowUnsandboxedPs: allowUnsandboxedPs ?? false,
    });
    await harness.sessionStart();
    await harness.grantRead();
    await harness.runCommand("sandbox-disable");
    await harness.runCommand("sandbox-enable");
    assert.partialDeepStrictEqual(
      harness.initialize.mock.calls.map((call) => call.arguments),
      Array.from({ length: 2 }, () => [{ allowUnsandboxedPs: allowUnsandboxedPs ?? false }]),
    );
    assert.partialDeepStrictEqual(
      harness.updateConfig.mock.calls.map((call) => call.arguments),
      [[{ allowUnsandboxedPs: allowUnsandboxedPs ?? false }]],
    );
    assert.equal(harness.reset.mock.callCount(), 1);
  });
}

for (const settings of [
  { global: true, project: false },
  { global: false, project: true },
]) {
  void test(`project overrides global: ${JSON.stringify(settings)}`, async (context) => {
    const harness = await setupSandbox({ context });
    await harness.writeConfig({
      global: { allowUnsandboxedPs: settings.global },
      project: { allowUnsandboxedPs: settings.project },
    });
    await harness.sessionStart();
    assert.partialDeepStrictEqual(
      harness.initialize.mock.calls.map((call) => call.arguments),
      [[{ allowUnsandboxedPs: settings.project }]],
    );
  });
}

for (const allowUnsandboxedPs of ["true", 1, null, [], { enabled: true }]) {
  for (const layer of ["global", "project"] as const) {
    for (const midSession of [false, true]) {
      void test(`invalid ${layer} opt-in ${JSON.stringify(allowUnsandboxedPs)} keeps enforcement ${midSession ? "mid-session" : "at startup"}`, async (context) => {
        const harness = await setupSandbox({ context });
        if (midSession) {
          await harness.writeConfig({ global: { allowUnsandboxedPs: true } });
          await harness.sessionStart();
        }
        const filesystem = {
          allowRead: [],
          allowWrite: [],
          denyRead: [harness.directory],
          denyWrite: [],
        };
        await harness.writeConfig(
          layer === "global"
            ? { global: { allowUnsandboxedPs, filesystem } }
            : { global: { allowUnsandboxedPs: true, filesystem }, project: { allowUnsandboxedPs } },
        );
        assert.partialDeepStrictEqual(harness.loadConfig(), {
          enabled: true,
          allowUnsandboxedPs: false,
          filesystem,
        });
        assert.deepEqual(
          harness.warn.mock.calls.map((call) => call.arguments),
          [["Warning: allowUnsandboxedPs must be a boolean; using false."]],
        );
        if (!midSession) await harness.sessionStart();
        await assert.rejects(harness.bash(), /test sandbox wrapper reached/);
        const userBash = await harness.userBash();
        assert.ok(userBash?.operations);
        await assert.rejects(
          userBash.operations.exec("exit 0", harness.cwd, { onData() {} }),
          /test sandbox wrapper reached/,
        );
        for (const toolName of ["read", "write", "edit"] as const) {
          assert.partialDeepStrictEqual(
            await harness.toolCall({
              type: "tool_call",
              toolCallId: toolName,
              toolName,
              input: { path: harness.deniedPath, content: "", oldText: "", newText: "" },
            }),
            { block: true },
          );
        }
        await harness.grantRead();
        assert.partialDeepStrictEqual(
          harness.updateConfig.mock.calls.map((call) => call.arguments),
          [[{ allowUnsandboxedPs: false }]],
        );
        assert.equal(harness.reset.mock.callCount(), 0);
        assert.equal(
          harness.SandboxRuntimeConfigSchema.safeParse({
            network: { allowedDomains: [], deniedDomains: [] },
            filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
            allowUnsandboxedPs,
          }).success,
          false,
        );
      });
    }
  }
}

void test("permission refresh revokes the opt-in without restarting the manager", async (context) => {
  const harness = await setupSandbox({ context });
  await harness.writeConfig({ global: { allowUnsandboxedPs: true } });
  await harness.sessionStart();
  await harness.writeConfig({
    global: { allowUnsandboxedPs: true },
    project: { allowUnsandboxedPs: false },
  });
  await harness.grantRead();
  assert.partialDeepStrictEqual(
    harness.updateConfig.mock.calls.map((call) => call.arguments),
    [[{ allowUnsandboxedPs: false }]],
  );
  assert.equal(harness.initialize.mock.callCount(), 1);
  assert.equal(harness.reset.mock.callCount(), 0);
});

void test("adds only the literal ps exception and preserves the rest of each policy", async (context) => {
  const harness = await setupSandbox({ context });
  assert.partialDeepStrictEqual(
    harness.SandboxRuntimeConfigSchema.parse({
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
      allowUnsandboxedPs: true,
    }),
    { allowUnsandboxedPs: true },
  );
  for (const command of ["/bin/ps -p $$ -o pid=", "/bin/echo confined", "/bin/ps-other"]) {
    const baseline = harness.wrapCommand({ command });
    assert.ok(!baseline.includes("(with no-sandbox)"));
    assert.equal(harness.wrapCommand({ command, allowUnsandboxedPs: false }), baseline);
    const enabled = harness.wrapCommand({ command, allowUnsandboxedPs: true });
    assert.deepEqual(enabled.match(/\(allow process-exec .*\(with no-sandbox\)\)/g), [psRule]);
    assert.equal(enabled.replace(`${psRule}\n`, ""), baseline);
    assert.ok(enabled.includes("(deny default"));
    assert.ok(enabled.includes("(deny file-read*"));
    assert.ok(!enabled.includes("(allow network*)"));
    assert.ok(!enabled.includes("(allow file-write*)"));
  }
});

void test(
  "runtime manager forwards the opt-in to macOS policy generation",
  { skip: process.platform !== "darwin" },
  async (context) => {
    const harness = await setupSandbox({ context });
    const command = "/bin/ps -p $$ -o pid=";
    harness.updateRuntimeConfig({
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
    });
    await assert.rejects(
      harness.wrapWithSandbox({ command }),
      /Sandbox network proxy is not initialized/,
    );
    await harness.initializeRuntime();
    assert.ok(!(await harness.wrapWithSandbox({ command })).includes(psRule));
    assert.ok(
      (await harness.wrapWithSandbox({ command, allowUnsandboxedPs: true })).includes(psRule),
    );
    harness.updateRuntimeConfig({
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
      allowUnsandboxedPs: true,
    });
    assert.ok((await harness.wrapWithSandbox({ command })).includes(psRule));
    assert.ok(
      !(await harness.wrapWithSandbox({ command, allowUnsandboxedPs: false })).includes(psRule),
    );
  },
);

void test(
  "independent managers keep separate ps policies after another manager shuts down",
  { skip: process.platform !== "darwin" },
  async (context) => {
    const parent = await setupSandbox({ context });
    const child = parent.createSandboxManager();
    await parent.initializeRuntime();
    await child.initialize({
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
    });
    parent.updateRuntimeConfig({
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
      allowUnsandboxedPs: true,
    });
    const command = "/bin/ps -p $$ -o pid=";
    assert.ok((await parent.wrapWithSandbox({ command })).includes(psRule));
    assert.ok(!(await child.wrapWithSandbox(command, "/bin/sh")).includes(psRule));
    await child.reset();
    assert.ok((await parent.wrapWithSandbox({ command })).includes(psRule));
  },
);

void test(
  "macOS executes ps with the exception while other commands stay confined",
  {
    skip: process.platform !== "darwin" || process.env.PI_SANDBOX_PS_E2E !== "1",
  },
  async (context) => {
    if (!(await canRunSandboxExec())) {
      context.skip(
        "The enclosing sandbox blocks nested sandbox-exec. Run from an ordinary macOS terminal.",
      );
      return;
    }
    const harness = await setupSandbox({ context });
    const enabled = await harness.runMacOSCommand({
      command: "/bin/ps -p $$ -o pid=",
      allowUnsandboxedPs: true,
    });
    assert.partialDeepStrictEqual(enabled, { exitCode: 0, stderr: "" });
    assert.match(enabled.stdout, /^\s*\d+\s*$/);
    const disabled = await harness.runMacOSCommand({ command: "/bin/ps -p $$ -o pid=" });
    assert.notEqual(disabled.exitCode, 0);
    assert.match(disabled.stderr, /Operation not permitted/);
    for (const allowUnsandboxedPs of [false, true]) {
      assert.deepEqual(
        await harness.runMacOSCommand({ command: "/bin/echo confined", allowUnsandboxedPs }),
        { exitCode: 0, stdout: "confined\n", stderr: "" },
      );
      const denied = await harness.runMacOSCommand({
        command: `printf denied > '${harness.directory}/write-probe'`,
        allowUnsandboxedPs,
      });
      assert.notEqual(denied.exitCode, 0);
      assert.match(denied.stderr, /Operation not permitted/);
    }
  },
);
