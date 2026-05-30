import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { inspectPolicy, loadPolicy, resetPolicyToDefault } from './loadPolicy'

export const setupLoadPolicy = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: loadPolicy.defaultDeps },
  },
  async (userDeps) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pi-guardrail-load-policy-'))
    const configPath = join(tempDir, 'guardrail.yaml')
    const deps = configureDependencies(
      { inferTypesFrom: { defaultDeps: loadPolicy.defaultDeps }, userDeps },
      {
        getConfigPath: () => configPath,
        readFile: loadPolicy.defaultDeps.readFile,
        writeFile: loadPolicy.defaultDeps.writeFile,
        mkdir: loadPolicy.defaultDeps.mkdir,
        fileExists: loadPolicy.defaultDeps.fileExists,
      }
    )

    return {
      ...deps,
      configPath,
      loadPolicy: withDeps(loadPolicy, deps),
      inspectPolicy: withDeps(inspectPolicy, deps),
      resetPolicyToDefault: withDeps(resetPolicyToDefault, deps),
      async [Symbol.asyncDispose]() {
        await rm(tempDir, { recursive: true, force: true })
      },
    }
  }
)
