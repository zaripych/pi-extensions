import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { capture } from './capture'
import { setupBrowserSession } from './browser.harness'

export const setupCapture = configureHarnesses(
  setupBrowserSession,
  async (userDeps) => {
    const captureRoot = await mkdtemp(join(tmpdir(), 'capture-harness-'))
    const stageRoot = await mkdtemp(join(tmpdir(), 'capture-harness-stage-'))
    const captureDir = join(captureRoot, 'capture')
    const deps = configureDependencies(
      { inferTypesFrom: { defaultDeps: capture.defaultDeps }, userDeps },
      {
        isInteractiveTerminal: () => true,
        waitForEnter: async () => {},
        createStageDir: () => mkdtemp(join(stageRoot, 'pi-billing-capture-')),
      }
    )
    return {
      ...userDeps,
      ...deps,
      captureDir,
      capture: async (
        params: { port?: number; captureDir?: string; keepOpen?: boolean } = {}
      ) => capture({ captureDir, ...params }, deps),
      async [Symbol.asyncDispose]() {
        await rm(captureRoot, { recursive: true, force: true })
        await rm(stageRoot, { recursive: true, force: true })
      },
    }
  }
)
