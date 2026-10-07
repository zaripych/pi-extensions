import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureDependencies } from 'foundation/testing/harness/configureDependencies'
import { configureHarnesses } from 'foundation/testing/harness/configureHarnesses'
import { withDeps } from 'foundation/testing/harness/withDeps'
import { loadAaModels } from './loadAaModels'

export const setupLoadAaModels = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: loadAaModels.defaultDeps },
  },
  async (userDeps) => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'aa-models-harness-'))
    const deps = configureDependencies(
      { inferTypesFrom: { defaultDeps: loadAaModels.defaultDeps }, userDeps },
      {
        fetchAaPages: async () => [],
        getCacheDir: () => cacheDir,
      }
    )
    return {
      ...deps,
      cacheDir,
      loadAaModels: withDeps(loadAaModels, deps),
      async [Symbol.asyncDispose]() {
        await rm(cacheDir, { recursive: true, force: true })
      },
    }
  }
)
