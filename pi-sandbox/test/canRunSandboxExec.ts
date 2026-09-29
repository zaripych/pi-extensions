import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { wrapCommandWithSandboxMacOS } from "@carderne/sandbox-runtime/dist/sandbox/macos-sandbox-utils.js";

export async function canRunSandboxExec(): Promise<boolean> {
  const command = wrapCommandWithSandboxMacOS({
    command: "/usr/bin/true",
    binShell: "/bin/sh",
    needsNetworkRestriction: true,
    readConfig: { denyOnly: [] },
    writeConfig: { allowOnly: [], denyWithinAllow: [] },
  });
  try {
    await promisify(execFile)("/bin/sh", ["-c", command], { timeout: 5000 });
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "stderr" in error &&
      typeof error.stderr === "string" &&
      error.stderr.includes("sandbox_apply: Operation not permitted")
    )
      return false;
    throw error;
  }
}
